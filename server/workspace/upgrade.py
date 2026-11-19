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
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse

from workspace import release_manifest

STAGES_BEFORE_MIGRATION = {'verified', 'backed_up'}
ENV_FILE = '/etc/website-workspace.env'


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
    flag = maintenance_flag()
    flag.write_text(json.dumps({'since': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                'reason': reason}, ensure_ascii=False), encoding='utf-8')
    flag.chmod(0o644)


def clear_maintenance():
    maintenance_flag().unlink(missing_ok=True)


def read_state():
    try:
        return json.loads(state_path().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def write_state(**updates):
    state = read_state()
    state.update(updates)
    state['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    state_path().write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    return state


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


def _download(url, dest, timeout=120):
    request = urllib.request.Request(url, headers={'User-Agent': 'website-workspace-updater'})
    with urllib.request.urlopen(request, timeout=timeout) as response, open(dest, 'wb') as handle:
        shutil.copyfileobj(response, handle)
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
    _download(assets['release-manifest.json'], workdir / 'release-manifest.json', timeout=60)
    _download(assets['release-manifest.json.sig'], workdir / 'release-manifest.json.sig', timeout=60)
    manifest = release_manifest.load_release_manifest(workdir, public_key_pem())
    server_assets = [a for a in manifest['assets'] if a['kind'] == 'server']
    extension_assets = [a for a in manifest['assets'] if a['kind'] == 'extension']
    if not server_assets or not extension_assets:
        raise release_manifest.ManifestError('清单必须同时包含 server 与 extension 资产')
    # 只下载服务包；扩展 ZIP 在服务包内，解包后按清单哈希校验同字节，避免多一次易失败的跨境下载
    server_asset = server_assets[0]
    if server_asset['name'] not in assets:
        raise release_manifest.ManifestError(f'Release 缺少资产 {server_asset["name"]}')
    _download(assets[server_asset['name']], workdir / server_asset['name'], timeout=900)
    release_manifest.verify_asset(workdir / server_asset['name'], server_asset)
    return manifest, {'dir': workdir, 'server': workdir / server_asset['name'],
                      'extensionAsset': extension_assets[0], 'manifest': manifest}


def safe_extract(archive, destination, max_members=4000, max_bytes=256 * 1024 * 1024):
    """安全解包：拒绝绝对路径、路径逃逸、链接、设备等特殊成员、重复成员与超展开。"""
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    seen = set()
    total = 0
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        if len(members) > max_members:
            raise release_manifest.ManifestError(f'归档成员过多: {len(members)}')
        for member in members:
            name = member.name
            if member.issym() or member.islnk() or member.ischr() or member.isblk() or member.isfifo():
                raise release_manifest.ManifestError(f'归档含不允许的特殊成员: {name}')
            if name.startswith('/') or '..' in Path(name).parts or name.startswith('~'):
                raise release_manifest.ManifestError(f'归档成员路径不安全: {name}')
            if name in seen:
                raise release_manifest.ManifestError(f'归档含重复成员: {name}')
            seen.add(name)
            if member.isfile():
                total += member.size
                if total > max_bytes:
                    raise release_manifest.ManifestError('归档展开超过限制')
        for member in members:
            if not member.isfile():
                continue
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination):
                raise release_manifest.ManifestError(f'归档成员逃逸目标目录: {member.name}')
            target.parent.mkdir(parents=True, exist_ok=True)
            source = bundle.extractfile(member)
            if source is None:
                raise release_manifest.ManifestError(f'无法读取成员: {member.name}')
            with open(target, 'wb') as handle:
                shutil.copyfileobj(source, handle)
    return destination


def precheck(version, workdir=None):
    """预检：下载、验签、校验资产、安全解包到释放暂存目录；不改线上数据或服务。"""
    workdir = Path(workdir or tempfile.mkdtemp(prefix='ww-precheck-'))
    manifest, paths = fetch_release_assets(version, workdir)
    if manifest['version'] != version:
        raise release_manifest.ManifestError(f'清单版本 {manifest["version"]} 与请求 {version} 不一致')
    staging = app_root() / 'releases' / f'.staging-{version}'
    if staging.exists():
        shutil.rmtree(staging)
    safe_extract(paths['server'], staging)
    for required in ('server/manage.py', 'prototype/dist/client/index.html', 'requirements.lock',
                     'extension/release.json', 'scripts/backup.py'):
        if not (staging / required).exists():
            raise release_manifest.ManifestError(f'服务包缺少运行期文件: {required}')
    # 服务包内嵌扩展 ZIP 必须与清单登记的扩展资产同字节
    extension_asset = paths['extensionAsset']
    embedded = staging / 'extension' / 'dist' / extension_asset['name']
    if not embedded.is_file():
        raise release_manifest.ManifestError(f'服务包缺少内嵌扩展 ZIP: {extension_asset["name"]}')
    release_manifest.verify_asset(embedded, extension_asset)
    notes = {
        'version': version,
        'tag': manifest['tag'],
        'commit': manifest['commit'],
        'track': manifest['track'],
        'staging': str(staging),
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
    if target.exists():
        shutil.rmtree(target)
    staging.rename(target)
    if not _venv_ready(target):
        _run(['python3', '-m', 'venv', str(target / '.venv')], timeout=600)
    _run([str(target / '.venv' / 'bin' / 'pip'), 'install', '--no-cache-dir', '-q',
          '-r', str(target / 'requirements.lock')], timeout=3600)
    _run(['chown', '-R', 'website-workspace:website-workspace', str(target)], timeout=300)
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
    if 'ok' not in output:
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
    _run([python, str(current_release() / 'scripts' / 'backup.py'), 'create'],
         timeout=1800, as_user='website-workspace')
    backups = sorted((data_dir() / 'backups').glob('*.wwb'), key=lambda p: p.stat().st_mtime)
    if not backups:
        raise RuntimeError('备份未生成')
    return backups[-1]


def _enabled_timers():
    _, output = _run(['systemctl', 'list-timers', '--all', '--no-pager', '--no-legend'], timeout=60, check=False)
    return [line.split()[-1] for line in output.splitlines()
            if 'website-workspace' in line and line.split()]


def _health_ok(expected_version, attempts=30):
    python = _venv_python(current_release())
    for _ in range(attempts):
        time.sleep(2)
        code, _ = _run(['systemctl', 'is-active', 'website-workspace'], check=False)
        if code != 0:
            continue
        code, output = _run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                             'http://127.0.0.1:8000/api/auth/session'], timeout=30, check=False)
        if '200' in output and current_version() == expected_version:
            return True
    return False


def _migrate(release):
    _run([_venv_python(release), 'manage.py', 'migrate', '--noinput'],
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
    print(f'[rollback] 原因: {reason}')
    write_state(rollbackAttempted=True, rollbackReason=reason[:300])
    problems = []
    data = data_dir()

    try:
        _systemctl('stop', 'website-workspace')
        # 新版崩溃循环会让 systemd 进入 start-limit，必须先清除失败计数
        _run(['systemctl', 'reset-failed', 'website-workspace'], timeout=120, check=False)
    except Exception as exc:  # noqa: BLE001
        problems.append(f'停止服务失败: {exc}')

    if state.get('migrated') and backup_file:
        try:
            stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
            restored = _restore_into(backup_file, data / f'.rollback-restore-{stamp}',
                                     release=previous_release)
            for name in ('workspace.sqlite3-wal', 'workspace.sqlite3-shm'):
                (data / name).unlink(missing_ok=True)
            database = data / 'workspace.sqlite3'
            if database.exists():
                os.replace(database, _unique_path(data / f'workspace.sqlite3.failed-{stamp}'))
            os.replace(restored['database'], database)
            media = data / 'media'
            if media.exists():
                os.replace(media, _unique_path(data / f'media.failed-{stamp}'))
            if restored['media'].exists():
                os.replace(restored['media'], media)
            shutil.rmtree(restored['workdir'], ignore_errors=True)
            _run(['chown', '-R', 'website-workspace:website-workspace', str(data)],
                 timeout=600, check=False)
            write_state(stage='rollback_restored', rollbackStamp=stamp,
                        rollbackMediaFiles=restored['mediaFiles'])
        except Exception as exc:  # noqa: BLE001
            problems.append(f'恢复备份失败: {exc}')

    if previous_release:
        try:
            _switch(Path(previous_release).name)
        except Exception as exc:  # noqa: BLE001
            problems.append(f'切回旧版失败: {exc}')

    try:
        _run(['systemctl', 'reset-failed', 'website-workspace'], timeout=120, check=False)
        _systemctl('start', 'website-workspace')
    except Exception as exc:  # noqa: BLE001
        problems.append(f'启动旧版失败: {exc}')

    healthy = bool(previous_release) and _health_ok(Path(previous_release).name)
    if healthy:
        clear_maintenance()
        write_state(stage='rolled_back', reason=reason[:300], problems=problems,
                    writesReopened=bool(state.get('migrated')),
                    rollbackRestoredData=bool(state.get('migrated')))
        message = f'升级失败已回退到 {Path(previous_release).name}：{reason}'
        if problems:
            message += '；回退过程问题: ' + '; '.join(problems)[:300]
        raise RuntimeError(message)

    # 旧版也起不来：保持维护状态（写请求 503）但保证服务进程已尝试启动，等待人工处理
    write_state(stage='rollback_failed', reason=reason[:300], problems=problems)
    problem_text = '; '.join(problems)[:300]
    raise RuntimeError(f'回退后健康检查仍失败，保持维护状态待人工处理：{reason}；问题: {problem_text}')

def apply(version, backup_file=None):
    """执行升级；任何阶段失败都按阶段回退并在状态文件记录。"""
    previous = current_release()
    previous_version = previous.name if previous else ''
    state = read_state()
    if state.get('writesReopened') and state.get('rollbackRestoredData'):
        raise RuntimeError('上次回退已从备份恢复数据并重新开放写入；'
                           '如需再次回退必须人工确认，禁止自动用旧备份覆盖新数据')

    staging = app_root() / 'releases' / f'.staging-{version}'
    if not staging.exists():
        notes = precheck(version)
        staging = Path(notes['staging'])
    write_state(stage='verified', target=version, previous=previous_version)
    set_maintenance('upgrading')
    timers = _enabled_timers()
    write_state(stage='maintenance_on', timers=timers)
    try:
        if backup_file is None:
            backup_file = create_backup()
        write_state(stage='backed_up', backup=str(backup_file))
        restore_probe = verify_backup(backup_file)
        write_state(stage='backup_verified', restoreProbe=restore_probe)

        _systemctl('stop', 'website-workspace')
        target = install_release(staging, version)
        write_state(stage='installed', release=str(target))

        _migrate(target)
        write_state(stage='migrated', migrated=True)
        _switch(version)
        write_state(stage='switched', switched=True)

        _run(['systemctl', 'reset-failed', 'website-workspace'], timeout=120, check=False)
        _systemctl('start', 'website-workspace')
        if not _health_ok(version):
            rollback('新版启动或健康检查失败', previous, backup_file)
        for timer in timers:
            _systemctl('start', timer)
        clear_maintenance()
        final = read_state()
        for stale in ('error', 'reason', 'problems', 'rollbackReason'):
            final.pop(stale, None)
        state_path().write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding='utf-8')
        write_state(stage='complete', completedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                    writesReopened=True, health='ok')
        return {'version': version, 'previous': previous_version, 'backup': str(backup_file),
                'restoreProbe': restore_probe, 'timers': timers}
    except Exception as exc:  # noqa: BLE001 - 统一走回退并记录
        current_state = read_state()
        if current_state.get('rollbackAttempted'):
            # 回退已经执行过：不再重复回退，避免二次破坏现场。
            # 若回退本身成功（stage=rolled_back），保留该阶段，只记录失败原因。
            if current_state.get('stage') == 'rolled_back':
                write_state(error=str(exc)[:400])
            else:
                write_state(stage='failed', error=str(exc)[:400])
            raise
        write_state(stage='failed', error=str(exc)[:400])
        rollback(str(exc)[:300], previous, backup_file)
        raise
