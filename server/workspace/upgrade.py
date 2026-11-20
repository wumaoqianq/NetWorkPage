"""自建服务在线升级引擎：预检、维护窗口、备份验证、迁移、原子切换、健康检查与分阶段回退。

原则（对应 docs/github-release-and-online-upgrade.md §2）：
- 仓库与发布公钥在部署时固定；不从待安装包接受新公钥。
- 预检不动线上数据或服务；只有预检通过才进入维护窗口。
- 升级前创建**并实际试恢复**加密备份，确认数据库与媒体可还原。
- 停写后迁移、切换、健康检查都通过才恢复流量与定时器。
- 失败按阶段回退；恢复写入后绝不自动用旧备份覆盖新数据。
- 不轮换密钥、不重置账号或配对、不清浏览器 Outbox。
"""
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from django.conf import settings
from django.http import JsonResponse

from workspace import release_manifest

TIMERS = tuple(f'website-workspace-{name}.timer' for name in
               ('jobs', 'backup', 'media-cleanup', 'update-check'))


def release_repo():
    return os.environ.get('RELEASE_REPO', 'wumaoqianq/NetWorkPage')


def release_track():
    return os.environ.get('RELEASE_TRACK', 'stable')


def public_key_pem():
    inline = os.environ.get('RELEASE_PUBLIC_KEY', '').strip()
    if inline:
        return inline.encode('utf-8')
    path = Path(os.environ.get('RELEASE_PUBLIC_KEY_FILE', '/etc/website-workspace-release.pem'))
    if not path.is_file():
        raise release_manifest.ManifestError(f'缺少发布公钥: {path}（部署时固定安装，不从安装包读取）')
    return path.read_bytes()


def app_root():
    return Path(os.environ.get('APP_ROOT', '/opt/website-workspace'))


def current_release():
    link = app_root() / 'current'
    if link.exists():
        return link.resolve()
    return None


def current_version():
    release = current_release()
    if not release:
        return 'unknown'
    return release.name


def data_dir():
    return Path(settings.DATA_DIR)


def maintenance_flag():
    return data_dir() / 'maintenance.on'


def state_path():
    return data_dir() / 'upgrade-state.json'


def is_maintenance():
    return maintenance_flag().exists()


def set_maintenance(reason):
    atomic_json(maintenance_flag(), {'since': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                     'reason': reason})


def clear_maintenance():
    maintenance_flag().unlink(missing_ok=True)


def read_state():
    try:
        value = json.loads(state_path().read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(*, reset=False, **updates):
    state = {} if reset else read_state()
    state.update(updates)
    state['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    atomic_json(state_path(), state)
    return state


def atomic_json(path, payload):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            handle.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.chmod(0o644)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def upgrade_lock():
    if os.name != 'posix' or os.geteuid() != 0:
        raise RuntimeError('执行升级需要 Debian 上的管理员权限')
    import fcntl
    with (app_root() / '.upgrade.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError('另一个升级正在执行') from exc
        yield


class MaintenanceMiddleware:
    """维护期：写请求返回可重试 503（保留 Retry-After），读请求放行以便查看状态。"""

    SAFE = {'GET', 'HEAD', 'OPTIONS'}
    EXEMPT_PREFIX = ('/api/update', '/static/', '/api/auth/session')

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method not in self.SAFE and is_maintenance():
            path = request.path_info or ''
            if not path.startswith(self.EXEMPT_PREFIX):
                detail = {'error': '系统正在升级维护，请稍后重试；已保存的本地任务不会丢失',
                          'code': 'maintenance', 'retryAfter': 60}
                response = JsonResponse(detail, status=503)
                response['Retry-After'] = '60'
                response['Cache-Control'] = 'no-store'
                return response
        return self.get_response(request)


def _run(command, *, timeout=1800, as_user=None, check=True, env_extra=None):
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    if as_user:
        # sudo -u 默认丢弃环境变量（BACKUP_KEY/SECRET_KEY/DATA_DIR 等），
        # 改用 runuser 保留当前 root 进程已加载的 env-file 环境。
        command = ['runuser', '-u', as_user, '--'] + command
    proc = subprocess.run(command, capture_output=True, text=True, timeout=timeout, env=env)
    output = (proc.stdout or '') + (proc.stderr or '')
    if check and proc.returncode != 0:
        raise RuntimeError(f'命令失败({proc.returncode}): {" ".join(command)[:160]}\n{output[-1200:]}')
    return proc.returncode, output


def _systemctl(action, unit):
    return _run(['systemctl', action, unit], timeout=180)


def _venv_python(release):
    return str(Path(release) / '.venv' / 'bin' / 'python')


def _download(url, dest, max_bytes, timeout=120):
    request = urllib.request.Request(url, headers={'User-Agent': 'website-workspace-updater'})
    with urllib.request.urlopen(request, timeout=timeout) as response, open(dest, 'wb') as handle:
        remaining = max_bytes
        while chunk := response.read(min(1024 * 1024, remaining + 1)):
            remaining -= len(chunk)
            if remaining < 0:
                raise release_manifest.ManifestError('下载超过资产大小限制')
            handle.write(chunk)
    return dest


def fetch_release_assets(version, workdir):
    """按版本定位 GitHub Release，下载清单、签名与服务包；返回 (manifest, paths)。"""
    tag = version if version.startswith('v') else f'v{version}'
    api = f'https://api.github.com/repos/{release_repo()}/releases/tags/{tag}'
    request = urllib.request.Request(api, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'website-workspace-updater'})
    with urllib.request.urlopen(request, timeout=20) as response:
        release = json.loads(response.read())
    assets = {item['name']: item['browser_download_url'] for item in release.get('assets', [])}
    required = ('release-manifest.json', 'release-manifest.json.sig')
    for name in required:
        if name not in assets:
            raise release_manifest.ManifestError(f'Release 缺少 {name}')
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    _download(assets['release-manifest.json'], workdir / 'release-manifest.json', 128 * 1024, timeout=60)
    _download(assets['release-manifest.json.sig'], workdir / 'release-manifest.json.sig', 1024, timeout=60)
    manifest = release_manifest.load_release_manifest(workdir, public_key_pem())
    server_asset, _ = release_assets(manifest, version)
    # 只下载服务包；扩展 ZIP 在服务包内，解包后按清单哈希校验同字节，避免多一次易失败的跨境下载
    if server_asset['name'] not in assets:
        raise release_manifest.ManifestError(f'Release 缺少资产 {server_asset["name"]}')
    _download(assets[server_asset['name']], workdir / server_asset['name'], server_asset['bytes'], timeout=900)


def release_assets(manifest, version):
    if manifest['version'] != version or manifest['tag'] != f'v{version}':
        raise release_manifest.ManifestError('清单版本或 tag 与请求不一致')
    servers = [asset for asset in manifest['assets'] if asset['kind'] == 'server']
    extensions = [asset for asset in manifest['assets'] if asset['kind'] == 'extension']
    if len(servers) != 1 or len(extensions) != 1 or servers[0]['bytes'] > 128 * 1024 * 1024:
        raise release_manifest.ManifestError('清单必须包含一个有界服务包及一个扩展包')
    return servers[0], extensions[0]


def safe_extract(archive, destination, max_members=4000, max_bytes=256 * 1024 * 1024, *, wrapped=False):
    """安全解包：拒绝绝对路径、路径逃逸、链接、设备等特殊成员、重复成员与超展开。"""
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    seen = set()
    total = 0
    with tarfile.open(archive, 'r:gz') as bundle:
        for index, member in enumerate(bundle, 1):
            if index > max_members:
                raise release_manifest.ManifestError('归档成员过多')
            name = member.name
            if not (member.isfile() or member.isdir()) or '\\' in name or ':' in name:
                raise release_manifest.ManifestError(f'归档含不允许的特殊成员: {name}')
            if name.startswith('/') or '..' in Path(name).parts or name.startswith('~'):
                raise release_manifest.ManifestError(f'归档成员路径不安全: {name}')
            normalized = Path(name).as_posix()
            if normalized in seen:
                raise release_manifest.ManifestError(f'归档含重复成员: {name}')
            seen.add(normalized)
            if member.isfile():
                total += member.size
                if total > max_bytes:
                    raise release_manifest.ManifestError('归档展开超过限制')
            if not member.isfile():
                continue
            if wrapped:
                prefix, _, normalized = normalized.partition('/')
                if prefix != release_manifest.PROJECT or not normalized:
                    raise release_manifest.ManifestError('归档必须以 website-workspace 为根目录')
            target = (destination / normalized).resolve()
            if not target.is_relative_to(destination):
                raise release_manifest.ManifestError(f'归档成员逃逸目标目录: {member.name}')
            target.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                raise release_manifest.ManifestError(f'无法读取成员: {member.name}')
            with open(target, 'wb') as handle:
                shutil.copyfileobj(source, handle)
    return destination


def precheck(version, asset_dir=None, *, staging=None):
    with tempfile.TemporaryDirectory(prefix='ww-upgrade-assets-') as scratch:
        directory = Path(scratch)
        if asset_dir is None:
            fetch_release_assets(version, directory)
        else:
            source = Path(asset_dir)
            for name, limit in (('release-manifest.json', 128 * 1024), ('release-manifest.json.sig', 1024)):
                _copy_asset(source / name, directory / name, limit)
        manifest = release_manifest.load_release_manifest(directory, public_key_pem())
        server_asset, extension_asset = release_assets(manifest, version)
        _check_compatibility(manifest)
        archive = directory / server_asset['name']
        if asset_dir is not None:
            _copy_asset(source / archive.name, archive, server_asset['bytes'])
        release_manifest.verify_asset(archive, server_asset)
        safe_extract(archive, staging or directory / 'expanded', wrapped=True)
        return _check_staging(staging or directory / 'expanded', manifest, extension_asset)


def _copy_asset(source, destination, limit):
    with source.open('rb') as reader, destination.open('xb') as writer:
        while chunk := reader.read(min(1024 * 1024, limit + 1)):
            limit -= len(chunk)
            if limit < 0:
                raise release_manifest.ManifestError('本地资产超过大小限制')
            writer.write(chunk)


def _check_compatibility(manifest):
    current = current_version()
    if current != 'unknown':
        target = manifest['version']
        if release_manifest.compare_versions(target, current) <= 0:
            raise release_manifest.ManifestError('升级目标必须高于当前版本')
        minimum = manifest.get('minUpgradeFrom')
        if minimum and release_manifest.compare_versions(current, minimum) < 0:
            raise release_manifest.ManifestError(f'当前版本过旧，请先升级到 {minimum}')


def _check_staging(staging, manifest, extension_asset):
    for required in ('server/manage.py', 'prototype/dist/client/index.html', 'requirements.lock',
                     'extension/release.json', 'scripts/backup.py'):
        if not (staging / required).exists():
            raise release_manifest.ManifestError(f'服务包缺少运行期文件: {required}')
    # 服务包内嵌扩展 ZIP 必须与清单登记的扩展资产同字节
    embedded = staging / 'extension' / 'dist' / extension_asset['name']
    if not embedded.is_file():
        raise release_manifest.ManifestError(f'服务包缺少内嵌扩展 ZIP: {extension_asset["name"]}')
    release_manifest.verify_asset(embedded, extension_asset)
    notes = {
        'version': manifest['version'],
        'tag': manifest['tag'],
        'commit': manifest['commit'],
        'track': manifest['track'],
        'assets': [{'name': a['name'], 'bytes': a['bytes'], 'sha256': a['sha256']}
                   for a in manifest['assets']],
        'extensionVersion': manifest['extension']['version'],
        'currentVersion': current_version(),
    }
    return notes


def _venv_ready(release):
    python = Path(release) / '.venv' / 'bin' / 'python'
    return python.exists()


def install_release(staging, version):
    """把暂存目录变成正式版本目录：建 venv、装锁定依赖。"""
    target = app_root() / 'releases' / version
    if target.exists() or target.is_symlink():
        raise RuntimeError(f'目标版本目录已存在，请先检查并归档：{target}')
    staging.rename(target)
    if not _venv_ready(target):
        _run(['python3', '-m', 'venv', str(target / '.venv')], timeout=600)
    _run([str(target / '.venv' / 'bin' / 'pip'), 'install', '--only-binary=:all:', '--no-cache-dir', '-q',
          '-r', str(target / 'requirements.lock')], timeout=3600)
    return target


def _prepare_workdir(path):
    """创建应用用户可写的恢复工作目录（/tmp 下 root 700 目录不可写）。"""
    path = Path(path)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    _run(['chown', '-R', 'website-workspace:website-workspace', str(path)], timeout=120)
    return path


def _restore_into(backup_file, workdir, release=None):
    """用备份脚本把数据库恢复到 <workdir>/workspace.sqlite3；媒体到 <dir>/workspace.sqlite3.media。"""
    release = release or current_release()
    workdir = _prepare_workdir(workdir)
    target_db = workdir / 'workspace.sqlite3'
    media_root = Path(str(target_db) + '.media')
    _run([_venv_python(release), str(Path(release) / 'scripts' / 'backup.py'),
          'restore', str(backup_file), str(target_db)],
         timeout=1800, as_user='website-workspace')
    if not target_db.is_file():
        raise RuntimeError('恢复未得到数据库文件')
    code, output = _run(['sqlite3', str(target_db), 'pragma integrity_check;'], timeout=120, check=False)
    if code != 0 or output.strip() != 'ok' or not media_root.is_dir():
        raise RuntimeError(f'恢复数据库完整性检查失败: {output[-300:]}')
    media_files = sum(1 for _ in media_root.rglob('*') if _.is_file()) if media_root.exists() else 0
    return {'workdir': workdir, 'database': target_db, 'media': media_root, 'mediaFiles': media_files}


def verify_backup(backup_file):
    """实际试恢复一次加密备份，确认数据库与媒体均可还原（在 DATA_DIR 下进行，结束后清理）。"""
    workdir = data_dir() / '.verify-restore'
    try:
        result = _restore_into(backup_file, workdir)
        return {'database': str(result['database']), 'mediaFiles': result['mediaFiles'],
                'integrity': 'ok'}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        shutil.rmtree(Path(str(workdir / 'workspace.sqlite3') + '.media'), ignore_errors=True)


def create_backup():
    python = _venv_python(current_release())
    # 不传 --env-file：该文件为 600 root-only，应用用户不可读；
    # runuser 会保留调用进程已从同一文件加载的环境变量（含 BACKUP_KEY/DATA_DIR）。
    directory = data_dir() / 'backups'
    existing = set(directory.glob('*.wwb'))
    _run([python, str(current_release() / 'scripts' / 'backup.py'), 'create',
          '--database', str(settings.DATABASES['default']['NAME']), '--media-directory', str(settings.MEDIA_ROOT),
          '--directory', str(directory)],
         timeout=1800, as_user='website-workspace')
    backups = set(directory.glob('*.wwb')) - existing
    if len(backups) != 1:
        raise RuntimeError('备份未生成')
    return backups.pop()


def _enabled_timers():
    return [timer for timer in TIMERS if _run(['systemctl', 'is-active', timer], timeout=10, check=False)[0] == 0]


def _resume_timers(timers):
    problems = []
    for timer in timers:
        try:
            _systemctl('start', timer)
        except Exception:
            problems.append(timer)
    if problems:
        write_state(timerFailures=problems)
    return problems


def _health_ok(expected_version, attempts=30):
    host = urlsplit(settings.PUBLIC_URL).netloc or '127.0.0.1'
    for _ in range(attempts):
        time.sleep(2)
        code, _ = _run(['systemctl', 'is-active', 'website-workspace'], check=False)
        if code != 0:
            continue
        code, output = _run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                             '-H', f'Host: {host}', '-H', 'X-Forwarded-Proto: https',
                             'http://127.0.0.1:8000/api/auth/session'], timeout=30, check=False)
        if code == 0 and output.strip() == '200' and current_version() == expected_version:
            return True
    return False


def _migrate(release):
    _run([_venv_python(release), str(release / 'server' / 'manage.py'), 'migrate', '--noinput'],
         timeout=1800, as_user='website-workspace')


def _switch(version):
    link = app_root() / 'current'
    target = app_root() / 'releases' / version
    temporary = app_root() / f'.current-{version}'
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    os.symlink(target, temporary)
    os.replace(temporary, link)


def _unique_path(path):
    """失败现场路径：已存在时追加序号，避免同一时间戳多次回退冲突。"""
    path = Path(path)
    if not path.exists():
        return path
    index = 1
    while True:
        candidate = path.with_name(f'{path.name}-{index}')
        if not candidate.exists():
            return candidate
        index += 1


def rollback(reason, previous_release, backup_file):
    """按阶段回退：迁移前只需恢复服务；迁移后成对恢复数据库与媒体再切回旧版。

    任何一步失败都记录并继续尽力恢复可用性；成功恢复旧版后清除维护标记并禁止自动再次回退。
    """
    state = read_state()
    write_state(rollbackAttempted=True, rollbackReason=reason[:300])
    problems = []
    data = data_dir()

    try:
        _systemctl('stop', 'website-workspace')
        # 新版崩溃循环会让 systemd 进入 start-limit，必须先清除失败计数
        _run(['systemctl', 'reset-failed', 'website-workspace'], timeout=120, check=False)
    except Exception as exc:  # noqa: BLE001
        problems.append(f'停止服务失败: {exc}')

    needs_restore = bool(state.get('migrationStarted') or state.get('migrated'))
    if needs_restore and not backup_file:
        problems.append('找不到本次已验证的备份')
    if needs_restore and backup_file and not problems:
        try:
            stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
            restored = _restore_into(backup_file, data / f'.rollback-restore-{stamp}',
                                     release=previous_release)
            database = Path(settings.DATABASES['default']['NAME'])
            for suffix in ('-wal', '-shm', '-journal'):
                sidecar = database.with_name(database.name + suffix)
                if sidecar.exists():
                    os.replace(sidecar, _unique_path(data / f'{sidecar.name}.failed-{stamp}'))
            if database.exists():
                os.replace(database, _unique_path(data / f'workspace.sqlite3.failed-{stamp}'))
            os.replace(restored['database'], database)
            media = Path(settings.MEDIA_ROOT)
            if media.exists():
                os.replace(media, _unique_path(data / f'media.failed-{stamp}'))
            os.replace(restored['media'], media)
            shutil.rmtree(restored['workdir'], ignore_errors=True)
            write_state(stage='rollback_restored', rollbackStamp=stamp,
                        rollbackMediaFiles=restored['mediaFiles'])
        except Exception as exc:  # noqa: BLE001
            problems.append(f'恢复备份失败: {exc}')

    if previous_release and not problems:
        try:
            _switch(Path(previous_release).name)
        except Exception as exc:  # noqa: BLE001
            problems.append(f'切回旧版失败: {exc}')

    if not problems:
        try:
            _run(['systemctl', 'reset-failed', 'website-workspace'], timeout=120, check=False)
            _systemctl('start', 'website-workspace')
        except Exception as exc:  # noqa: BLE001
            problems.append(f'启动旧版失败: {exc}')

    healthy = not problems and previous_release and _health_ok(Path(previous_release).name)
    if healthy:
        write_state(stage='rolled_back', reason=reason[:300], problems=problems,
                    writesReopened=True, rollbackRestoredData=needs_restore)
        clear_maintenance()
        _resume_timers(state.get('timers', []))
        message = f'升级失败已回退到 {Path(previous_release).name}：{reason}'
        raise RuntimeError(message)

    # 旧版也起不来：保持维护状态（写请求 503）但保证服务进程已尝试启动，等待人工处理
    write_state(stage='rollback_failed', reason=reason[:300], problems=problems)
    problem_text = '; '.join(problems)[:300]
    raise RuntimeError(f'回退后健康检查仍失败，保持维护状态待人工处理：{reason}；问题: {problem_text}')

def apply(version, asset_dir=None):
    with upgrade_lock():
        return _apply(version, asset_dir)


def _apply(version, asset_dir):
    previous = current_release()
    if not previous or previous.parent != app_root() / 'releases':
        raise RuntimeError('请先完成现有部署的版本目录迁移')
    if is_maintenance():
        raise RuntimeError('存在未结束的维护；请先检查升级状态与数据库，不能直接重跑')
    if Path(settings.DATABASES['default']['NAME']).resolve().parent != data_dir().resolve():
        raise RuntimeError('自动升级要求生产 SQLite 数据库直接位于 DATA_DIR 内')
    timers = _enabled_timers()
    with tempfile.TemporaryDirectory(dir=previous.parent, prefix='.upgrade-') as scratch:
        staging = Path(scratch) / 'expanded'
        precheck(version, asset_dir, staging=staging)
        target = install_release(staging, version)

    write_state(reset=True, stage='verified', target=version, previous=previous.name, timers=timers)
    set_maintenance('upgrading')
    backup_file = None
    try:
        write_state(stage='maintenance_on')
        for timer in timers:
            _systemctl('stop', timer)
            _systemctl('stop', timer.removesuffix('.timer') + '.service')
        _systemctl('stop', 'website-workspace')
        backup_file = create_backup()
        write_state(stage='backed_up', backup=str(backup_file))
        restore_probe = verify_backup(backup_file)
        write_state(stage='backup_verified', restoreProbe=restore_probe)

        write_state(stage='migrating', migrationStarted=True)
        _migrate(target)
        write_state(stage='migrated', migrated=True)
        _switch(version)
        write_state(stage='switched', switched=True)

        _run(['systemctl', 'reset-failed', 'website-workspace'], timeout=120, check=False)
        _systemctl('start', 'website-workspace')
        if not _health_ok(version):
            raise RuntimeError('新版启动或健康检查失败')
        write_state(stage='complete', completedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    writesReopened=True, health='ok')
    except Exception as exc:  # noqa: BLE001
        write_state(stage='failed', error=str(exc)[:400])
        rollback(str(exc)[:300], previous, backup_file)
        raise
    clear_maintenance()
    failed_timers = _resume_timers(timers)
    return {'version': version, 'previous': previous.name, 'backup': str(backup_file),
            'restoreProbe': restore_probe, 'timers': [timer for timer in timers if timer not in failed_timers],
            'timerFailures': failed_timers}
