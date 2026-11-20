"""从固定提交构建可发布的服务器包、扩展 ZIP、签名清单与校验文件。

设计要点（对应 docs/github-release-and-online-upgrade.md）：
- 只从干净 checkout 的明确提交构建；工作区有未提交改动时默认拒绝（--allow-dirty 仅本机调试）。
- 服务包内含**同一次构建**的单个扩展 ZIP（同字节），前端产物预构建，服务器无需 Node。
- 不递归纳入 docs/；排除 .local、data、release、数据库、媒体、密钥、旧 ZIP。
- 清单签名用 Ed25519；私钥只在 .local/release-keys/（gitignored），绝不进入仓库或发布包。

用法：
  python scripts/build_release.py --version 1.10.0-rc.1 --tag v1.10.0-rc.1 \
      --extension-version 1.10.0 --track prerelease --output release
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
import re
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from .build_extension import build_extension
else:
    from build_extension import build_extension

PROJECT_ID = 'website-workspace'
MANIFEST_FORMAT = 1
API_COMPAT = {'minExtension': '1.0.0', 'currentExtension': '1.10.0'}

INCLUDE_DIRS = ('server', 'scripts', 'deploy')
INCLUDE_FILES = ('requirements.txt', 'requirements.lock', 'README.md', 'LICENSE', 'LICENSE.md')
FRONTEND_DIR = 'prototype/dist/client'
# 服务端运行时读取：extension/release.json + 它指向的单个 ZIP（同一次构建的字节）
EXTENSION_FILES = ('extension/release.json',)
EXTENSION_ZIP = 'extension/dist/website-workspace-extension-{version}.zip'

EXCLUDED_PARTS = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache',
                  'tests', 'qa', 'reference', '.mypy_cache', '.ruff_cache', 'dist', 'data', 'release'}
EXCLUDED_SUFFIXES = {'.sqlite', '.sqlite3', '.db', '.pyc', '.pyo', '.pem', '.key',
                     '.fernet', '.wwb', '.log', '.bak', '.map'}
SECRET_ASSIGNMENT = re.compile(
    r'''(?im)^\s*(?:SECRET_KEY|SETUP_TOKEN|BACKUP_KEY|[A-Z_]*API_KEY|DATABASE_PASSWORD)\s*=\s*["']([^"'\r\n]{16,})["']\s*$'''
)
TOKEN_PATTERN = re.compile(rb"(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)")
KEY_DIR = Path('.local/release-keys')


def git_head(root):
    return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True,
                          text=True, check=True).stdout.strip()


def git_clean(root):
    out = subprocess.run(['git', 'status', '--porcelain'], cwd=root, capture_output=True,
                         text=True, check=True).stdout.strip()
    return not out


def allowed_file(path, root, ignore_parts=()):
    relative = path.relative_to(root)
    if path.is_symlink() or not path.is_file():
        return False
    if any((part in EXCLUDED_PARTS and part not in ignore_parts) or part.startswith('.env')
           for part in relative.parts):
        return False
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if path.name.endswith(('-wal', '-shm')) or 'credential' in path.name.lower():
        return False
    return path.resolve().is_relative_to(root.resolve())


def inspect_content(path, content, known_secrets):
    """检查已知本机秘密与常见硬编码；拒绝时只报路径，不回显内容。"""
    if TOKEN_PATTERN.search(content):
        raise ValueError(f'Possible credential in release input: {path}')
    if any(secret in content for secret in known_secrets):
        raise ValueError(f'Local secret found in release input: {path}')
    if path.suffix in {'.py', '.js', '.mjs', '.jsx', '.ts', '.tsx', '.yaml', '.yml', '.toml', '.sh'}:
        for match in SECRET_ASSIGNMENT.finditer(content.decode('utf-8', errors='replace')):
            if not any(word in match[1].lower() for word in ('example', 'placeholder', 'change-me', 'replace')):
                raise ValueError(f'Literal secret assignment in release input: {path}')


def local_secret_values(root):
    values = []
    for path in root.glob('.env*'):
        if not path.is_file():
            continue
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            name, separator, value = line.partition('=')
            if separator and any(marker in name.upper() for marker in ('KEY', 'TOKEN', 'PASSWORD', 'SECRET')):
                value = value.strip().strip('"\'')
                if len(value) >= 16:
                    values.append(value.encode('utf-8'))
    return values


def release_files(root, extension_zip):
    files = set()
    for directory in INCLUDE_DIRS:
        base = root / directory
        if base.exists():
            files.update(p for p in base.rglob('*') if allowed_file(p, root))
    frontend = root / FRONTEND_DIR
    if frontend.exists():
        files.update(p for p in frontend.rglob('*') if allowed_file(p, root, ignore_parts={'dist'}))
    for name in INCLUDE_FILES:
        path = root / name
        if path.is_file() and allowed_file(path, root):
            files.add(path)
    for name in EXTENSION_FILES:
        path = root / name
        if path.is_file() and allowed_file(path, root):
            files.add(path)
    files.add(extension_zip)
    return sorted(files)


def archive_bytes(files, root):
    """固定 mtime/属主/权限的可复现 tar.gz；路径一律 POSIX。"""
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', mtime=0) as compressed, \
            tarfile.open(fileobj=compressed, mode='w', format=tarfile.GNU_FORMAT) as bundle:
        for path, content in files:
            relative = path.relative_to(root).as_posix()
            info = tarfile.TarInfo(f'{PROJECT_ID}/{relative}')
            info.size = len(content)
            info.mode = 0o644
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            bundle.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def load_signing_key(create=False):
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    private = KEY_DIR / 'release-ed25519.pem'
    public = KEY_DIR / 'release-ed25519.pub.pem'
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    if private.exists():
        key = serialization.load_pem_private_key(private.read_bytes(), password=None)
    elif create:
        key = Ed25519PrivateKey.generate()
        private.write_bytes(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()))
        private.chmod(0o600)
    else:
        raise FileNotFoundError(
            f'缺少发布私钥 {private}；请在可信环境生成一次并离线保管（私钥不得入库）')
    public.write_bytes(key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo))
    return key


def sign_manifest(manifest_bytes, key):
    signature = key.sign(manifest_bytes)
    return base64.b64encode(signature).decode('ascii')


def build_release(root, output, version, tag, track, extension_version,
                  commit=None, allow_dirty=False, now=None):
    root, output = Path(root).resolve(), Path(output).resolve()
    if not allow_dirty:
        head = git_head(root)
        if (commit and commit != head) or not git_clean(root):
            raise RuntimeError('发布必须从标记的干净提交构建（调试可用 --allow-dirty）')
    commit = commit or git_head(root)
    for required in ('server/manage.py', 'prototype/dist/client/index.html', 'requirements.lock'):
        if not (root / required).is_file():
            raise FileNotFoundError(f'缺少发布输入：{required}')

    # 1) 用源码构建扩展 ZIP，保证与服务包内 ZIP 同字节、版本一致
    manifest_path = root / 'extension' / 'manifest.json'
    declared = json.loads(manifest_path.read_text(encoding='utf-8'))['version']
    if declared != extension_version:
        raise RuntimeError(f'扩展 manifest 版本 {declared} 与 --extension-version {extension_version} 不一致')
    build_extension(root, run_checks=True)
    extension_zip = root / EXTENSION_ZIP.format(version=extension_version)
    if not extension_zip.is_file():
        raise FileNotFoundError(f'扩展 ZIP 未生成：{extension_zip}')

    # 2) 收集并逐个审查输入字节
    secrets = local_secret_values(root)
    files = release_files(root, extension_zip)
    reviewed = []
    for path in files:
        content = path.read_bytes()
        inspect_content(path.relative_to(root), content, secrets)
        reviewed.append((path, content))

    # 3) 生成服务包；扩展 ZIP 同时作为发布资产复制到输出目录（同字节）
    payload = archive_bytes(reviewed, root)
    output.mkdir(parents=True, exist_ok=True)
    server_name = f'{PROJECT_ID}-{tag}.tar.gz'
    (output / server_name).write_bytes(payload)
    server_sha = hashlib.sha256(payload).hexdigest()
    ext_bytes = dict(reviewed)[extension_zip]
    (output / extension_zip.name).write_bytes(ext_bytes)

    # 4) 清单（同一候选构建的版本/tag/资产）
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()
    manifest = {
        'formatVersion': MANIFEST_FORMAT,
        'project': PROJECT_ID,
        'track': track,
        'version': version,
        'tag': tag,
        'commit': commit,
        'builtAt': stamp,
        'releaseNotesUrl': f'https://github.com/wumaoqianq/NetWorkPage/releases/tag/{tag}',
        'minUpgradeFrom': '1.0.0',
        'platform': {'os': 'linux', 'arch': ['x86_64', 'aarch64'], 'python': '>=3.11'},
        'extension': {'version': extension_version, 'api': API_COMPAT},
        'assets': [],
        'notes': '预发布候选；稳定轨道默认忽略预发布。' if track == 'prerelease' else '稳定版本。',
    }
    manifest['assets'].append({
        'name': server_name, 'kind': 'server', 'bytes': len(payload), 'sha256': server_sha})
    manifest['assets'].append({
        'name': extension_zip.name, 'kind': 'extension', 'bytes': len(ext_bytes),
        'sha256': hashlib.sha256(ext_bytes).hexdigest()})
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True).encode('utf-8')
    (output / 'release-manifest.json').write_bytes(manifest_bytes)

    # 5) 签名（离线私钥，仅本机）
    key = load_signing_key()
    (output / 'release-manifest.json.sig').write_text(
        sign_manifest(manifest_bytes, key) + '\n', encoding='ascii')
    (output / 'release-public-key.pem').write_text(
        (KEY_DIR / 'release-ed25519.pub.pem').read_text(encoding='ascii'), encoding='ascii')

    # 6) 校验文件
    lines = []
    for name in (server_name, extension_zip.name, 'release-manifest.json', 'release-manifest.json.sig'):
        digest = hashlib.sha256((output / name).read_bytes()).hexdigest()
        lines.append(f'{digest}  {name}')
    (output / 'SHA256SUMS').write_text('\n'.join(lines) + '\n', encoding='ascii')
    return manifest, output / server_name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--version', required=True, help='服务端版本，如 1.10.0-rc.1')
    parser.add_argument('--tag', required=True, help='GitHub tag，如 v1.10.0-rc.1')
    parser.add_argument('--extension-version', required=True, help='浏览器数字版本，如 1.10.0')
    parser.add_argument('--track', default='prerelease', choices=('prerelease', 'stable'))
    parser.add_argument('--commit')
    parser.add_argument('--allow-dirty', action='store_true')
    arguments = parser.parse_args()
    output = arguments.output or (arguments.root / 'release')
    manifest, archive = build_release(
        arguments.root, output, arguments.version, arguments.tag, arguments.track,
        arguments.extension_version, arguments.commit, arguments.allow_dirty)
    print(f'Release built: {archive.name} ({archive.stat().st_size} bytes)')
    print(f'commit: {manifest["commit"]}')
    for asset in manifest['assets']:
        print(f'  {asset["name"]}  {asset["bytes"]}  {asset["sha256"]}')
    print(f'manifest + signature + SHA256SUMS -> {archive.parent}')


if __name__ == '__main__':
    main()
