"""发布清单校验、Ed25519 签名验证与版本比较（在线升级的信任边界）。

信任模型：
- 仓库与发布公钥在**部署时固定**（环境变量或 /etc 下文件），绝不从待安装包内接受新公钥。
- 清单签名覆盖清单原始字节；资产逐个校验 SHA-256 与大小。
- 任何一项不符即拒绝，且不启动任何数据变更。
"""
import base64
import hashlib
import json
import re
import urllib.request

MIN_FORMAT = 1
PROJECT = 'website-workspace'
_VERSION = re.compile(r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$')
_SHA256 = re.compile(r'^[0-9a-f]{64}$')


class ManifestError(ValueError):
    """清单/签名/资产不可信。"""


def parse_version(text):
    """返回 (major, minor, patch, prerelease_tuple)，预发布标识按 SemVer 规则可比较。"""
    match = _VERSION.match(str(text).strip())
    if not match:
        raise ManifestError(f'版本号不符合 SemVer: {text!r}')
    major, minor, patch = (int(match.group(i)) for i in (1, 2, 3))
    pre = match.group(4)
    if pre is None:
        identifiers = (1,)  # 正式版高于任何预发布
    else:
        parts = []
        for piece in pre.split('.'):
            if piece.isdigit():
                parts.append((0, int(piece), ''))
            else:
                parts.append((1, 0, piece))
        identifiers = (0, tuple(parts))
    return (major, minor, patch, identifiers)


def is_prerelease(version):
    return '-' in str(version)


def compare_versions(left, right):
    """left < right 返回 -1，相等 0，大于 1。"""
    a, b = parse_version(left), parse_version(right)
    if a[:3] != b[:3]:
        return -1 if a[:3] < b[:3] else 1
    pa, pb = a[3], b[3]
    if pa == pb:
        return 0
    return -1 if pa < pb else 1


def validate_manifest(data):
    """校验清单结构与字段范围，返回规范化字典。"""
    if not isinstance(data, dict):
        raise ManifestError('清单必须是 JSON 对象')
    if data.get('formatVersion') != MIN_FORMAT:
        raise ManifestError(f'不支持的清单格式版本: {data.get("formatVersion")!r}')
    if data.get('project') != PROJECT:
        raise ManifestError(f'项目标识不符: {data.get("project")!r}')
    track = data.get('track')
    if track not in ('stable', 'prerelease'):
        raise ManifestError(f'未知发行轨道: {track!r}')
    version = data.get('version')
    parse_version(version)
    if str(data.get('tag', '')).strip() == '':
        raise ManifestError('缺少 tag')
    if not re.fullmatch(r'[0-9a-f]{40}', str(data.get('commit', ''))):
        raise ManifestError('commit 必须是 40 位十六进制提交 SHA')
    assets = data.get('assets')
    if not isinstance(assets, list) or not assets:
        raise ManifestError('assets 不能为空')
    names = set()
    for asset in assets:
        if not isinstance(asset, dict):
            raise ManifestError('资产必须是对象')
        name = str(asset.get('name', ''))
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,120}', name) or '..' in name or name.startswith('.'):
            raise ManifestError(f'资产名不安全: {name!r}')
        if name in names:
            raise ManifestError(f'资产重复: {name}')
        names.add(name)
        if not isinstance(asset.get('bytes'), int) or asset['bytes'] <= 0:
            raise ManifestError(f'资产大小非法: {name}')
        if not _SHA256.match(str(asset.get('sha256', ''))):
            raise ManifestError(f'资产 SHA-256 非法: {name}')
        if asset.get('kind') not in ('server', 'extension'):
            raise ManifestError(f'未知资产类型: {asset.get("kind")!r}')
    extension = data.get('extension')
    if not isinstance(extension, dict) or not extension.get('version'):
        raise ManifestError('缺少扩展版本信息')
    return data


def verify_signature(manifest_bytes, signature_b64, public_key_pem):
    """用部署时固定的公钥验证清单签名；失败抛 ManifestError。"""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    try:
        key = serialization.load_pem_public_key(public_key_pem)
    except Exception as exc:  # noqa: BLE001 - 任何解析失败都视为不可信
        raise ManifestError(f'发布公钥无法解析: {type(exc).__name__}') from exc
    if not isinstance(key, Ed25519PublicKey):
        raise ManifestError('发布公钥必须是 Ed25519')
    try:
        signature = base64.b64decode(str(signature_b64).strip(), validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ManifestError('签名不是合法 base64') from exc
    try:
        key.verify(signature, manifest_bytes)
    except InvalidSignature as exc:
        raise ManifestError('清单签名验证失败') from exc


def verify_asset(path, asset):
    """校验已下载资产的字节数与 SHA-256。"""
    data = path.read_bytes()
    if len(data) != asset['bytes']:
        raise ManifestError(f'资产大小不符: {asset["name"]} {len(data)} != {asset["bytes"]}')
    digest = hashlib.sha256(data).hexdigest()
    if digest != asset['sha256']:
        raise ManifestError(f'资产 SHA-256 不符: {asset["name"]}')
    return digest


def load_release_manifest(manifest_dir, public_key_pem):
    """读取目录中的清单与签名并完成验签+结构校验。"""
    import pathlib
    directory = pathlib.Path(manifest_dir)
    raw = (directory / 'release-manifest.json').read_bytes()
    signature = (directory / 'release-manifest.json.sig').read_text(encoding='ascii')
    verify_signature(raw, signature, public_key_pem)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ManifestError('清单不是合法 JSON') from exc
    return validate_manifest(data)


def fetch_releases(repo, timeout=10, limit=15):
    """查询 GitHub Releases（只读）。返回 [{'tag','version','prerelease','publishedAt','url'}]。"""
    url = f'https://api.github.com/repos/{repo}/releases?per_page={limit}'
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'website-workspace-updater'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read())
    releases = []
    for item in payload if isinstance(payload, list) else []:
        tag = str(item.get('tag_name', ''))
        version = tag[1:] if tag.startswith('v') else tag
        try:
            parse_version(version)
        except ManifestError:
            continue
        releases.append({
            'tag': tag,
            'version': version,
            'prerelease': bool(item.get('prerelease')) or is_prerelease(version),
            'draft': bool(item.get('draft')),
            'publishedAt': item.get('published_at') or item.get('created_at') or '',
            'url': item.get('html_url', ''),
        })
    return releases


def pick_update(current_version, releases, track='stable'):
    """按轨道选择可升级版本：stable 忽略预发布；返回最新候选或 None。"""
    candidates = []
    for release in releases:
        if release.get('draft'):
            continue
        if track == 'stable' and release.get('prerelease'):
            continue
        if compare_versions(release['version'], current_version) <= 0:
            continue
        candidates.append(release)
    if not candidates:
        return None
    candidates.sort(key=lambda item: parse_version(item['version']))
    return candidates[-1]
