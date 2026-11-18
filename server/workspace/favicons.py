"""抓取页面声明的图标候选（含跨域公共 CDN）；每个候选与每次跳转都校验公网地址并真实解码。"""
import io
import http.client
import ipaddress
import re
import socket
import ssl
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_HTML_BYTES = 256 * 1024
MAX_ICON_FILE_BYTES = 1024 * 1024
MAX_ICON_TOTAL_BYTES = 2 * 1024 * 1024
# 候选上限保持 4 个：与扩展端 ICON_LIMITS.candidates 一致，单文件 1MiB/累计 2MiB/总 5 秒预算按 4 个候选制定；
# 提高上限会同时放大最坏请求数与字节预算，故不在本轮放宽。
MAX_CANDIDATES = 4
MAX_REDIRECTS = 3
REQUEST_SECONDS = 4.0
TOTAL_SECONDS = 5.0
MAX_PIXELS = 2_000_000
MAX_OUTPUT_BYTES = 32 * 1024
ALLOWED_FORMATS = frozenset({'PNG', 'WEBP', 'JPEG', 'GIF', 'BMP', 'ICO'})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
# 页面声明的常见栅格 MIME；没有 type 时按扩展名推断，最终仍由 Pillow 真实解码判定。
RASTER_TYPES = frozenset({'image/png', 'image/webp', 'image/jpeg', 'image/jpg', 'image/gif',
                          'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico'})
EXTENSION_TYPES = {'png': 'image/png', 'webp': 'image/webp', 'jpg': 'image/jpeg',
                   'jpeg': 'image/jpeg', 'gif': 'image/gif', 'bmp': 'image/bmp',
                   'ico': 'image/x-icon', 'svg': 'image/svg+xml'}
# 页面声明的跨域候选不允许把服务器带到常见非 Web 服务端口；同源默认候选仍按原行为校验。
DANGEROUS_PORTS = frozenset({21, 22, 23, 25, 53, 69, 110, 111, 135, 137, 138, 139, 143, 161, 162,
    389, 445, 465, 512, 513, 514, 587, 636, 873, 993, 995, 1080, 1433, 1521, 2049, 2181, 2375,
    2376, 2377, 3306, 3389, 5432, 5601, 5672, 5900, 6379, 7001, 7002, 8009, 8161, 9042, 9200,
    9300, 11211, 27017, 27018, 50000})
SIZE_TARGETS = (128, 64)
PRIVATE_MESSAGE = '本机/局域网站点需在浏览器扩展中打开该站并更新图标'
USER_AGENT = 'PrivateWorkspace/1.0 (favicon-refresh)'
FATAL_CODES = frozenset({'icon_refresh_private', 'icon_refresh_timeout', 'icon_refresh_too_large'})
TRANSITION_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    '64:ff9b::/96', '64:ff9b:1::/48', '2002::/16', '2001::/32'))

_resolver_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='favicon-dns')
_resolver_slots = threading.BoundedSemaphore(2)


class FaviconError(Exception):
    """带稳定中文错误码的图标获取异常；diagnostics 只含候选摘要，不含页面正文或完整 URL。"""

    def __init__(self, message, code='icon_refresh_failed', status=502, diagnostics=None):
        self.message, self.code, self.status = message, code, status
        self.diagnostics = list(diagnostics or [])

    def with_diagnostics(self, diagnostics):
        self.diagnostics = list(diagnostics or [])
        return self


def public_address(value):
    """只有真正的公网单播地址才允许服务器连接。"""
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if address.version == 6:
        if getattr(address, 'ipv4_mapped', None) is not None or address.is_site_local:
            return False
        if any(address in network for network in TRANSITION_NETWORKS):
            return False
    return address.is_global and not address.is_multicast


def literal_address(hostname):
    try:
        return ipaddress.ip_address(hostname)
    except ValueError:
        return None


def parse_target_url(url):
    """校验 scheme/host/port 形式并拒绝本机、内网与保留地址字面量；不做 DNS。"""
    if not isinstance(url, str) or not 1 <= len(url) <= 2048:
        raise FaviconError('网址格式不受支持', 'icon_refresh_failed', 502)
    if any(ord(char) <= 32 or ord(char) == 127 for char in url) or '\\' in url:
        raise FaviconError('网址格式不受支持', 'icon_refresh_failed', 502)
    try:
        parts = urlsplit(url)
        scheme = parts.scheme.lower()
        if scheme not in ('http', 'https') or not parts.hostname:
            raise ValueError()
        if parts.username is not None or parts.password is not None or '%' in parts.netloc:
            raise ValueError()
        port = parts.port
        if port == 0:
            raise ValueError()
        raw_host = parts.hostname
    except (ValueError, UnicodeError):
        raise FaviconError('网址或端口不受支持', 'icon_refresh_failed', 502)
    address = literal_address(raw_host)
    if address is not None:
        if not public_address(str(address)):
            raise FaviconError(PRIVATE_MESSAGE, 'icon_refresh_private', 400)
        hostname = str(address)
    else:
        try:
            hostname = raw_host.encode('idna').decode('ascii').lower().rstrip('.')
        except (UnicodeError, ValueError):
            raise FaviconError('网址格式不受支持', 'icon_refresh_failed', 502)
        if not hostname or ':' in hostname or any(char in hostname for char in '/@'):
            raise FaviconError('网址格式不受支持', 'icon_refresh_failed', 502)
        if hostname == 'localhost' or hostname.endswith('.localhost') or hostname.endswith('.local'):
            raise FaviconError(PRIVATE_MESSAGE, 'icon_refresh_private', 400)
        if '.' not in hostname:
            # 单标签主机名只可能解析到局域网，不交给服务器请求。
            raise FaviconError(PRIVATE_MESSAGE, 'icon_refresh_private', 400)
    return parts, hostname, port or (443 if scheme == 'https' else 80)


def resolve_public(hostname, port, deadline):
    """并发受限的域名解析；任一解析结果不是公网地址就拒绝整次请求。"""
    timeout = max(0.01, deadline - time.monotonic())
    if not _resolver_slots.acquire(blocking=False):
        raise FaviconError('域名解析繁忙，请稍后重试', 'icon_refresh_failed', 502)
    task = _resolver_pool.submit(socket.getaddrinfo, hostname, port, 0, socket.SOCK_STREAM)
    task.add_done_callback(lambda _: _resolver_slots.release())
    try:
        answers = task.result(timeout=timeout)
    except (OSError, FutureTimeout) as exc:
        raise FaviconError('域名解析失败或超时', 'icon_refresh_failed', 502) from exc
    addresses = list(dict.fromkeys(answer[4][0] for answer in answers))
    if not addresses:
        raise FaviconError('域名没有可用地址', 'icon_refresh_failed', 502)
    for value in addresses:
        if not public_address(value):
            raise FaviconError(PRIVATE_MESSAGE, 'icon_refresh_private', 400)
    return addresses


def check_target(url, deadline):
    """解析目标 URL 并固定连接地址，避免 DNS 重绑定把请求带到内网。"""
    parts, hostname, port = parse_target_url(url)
    address = literal_address(hostname)
    if address is not None:
        return parts, hostname, port, str(address)
    if time.monotonic() >= deadline:
        raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)
    return parts, hostname, port, resolve_public(hostname, port, deadline)[0]


class PinnedConnection(http.client.HTTPConnection):
    """按已校验 IP 建连；TLS 仍对原域名验证证书，HTTP 解析交给 stdlib。"""

    def __init__(self, hostname, port, ip, secure, deadline):
        super().__init__(hostname, port, timeout=max(0.01, deadline - time.monotonic()))
        self.hostname, self.ip = hostname, ip
        self.secure, self.deadline = secure, deadline

    def remaining(self):
        return max(0.01, self.deadline - time.monotonic())

    def connect(self):
        family = socket.AF_INET6 if ':' in self.ip else socket.AF_INET
        sock = socket.socket(family, socket.SOCK_STREAM)
        try:
            sock.settimeout(self.remaining())
            sock.connect((self.ip, self.port))
            if self.secure:
                sock.settimeout(self.remaining())
                context = ssl.create_default_context()
                sock = context.wrap_socket(sock, server_hostname=self.hostname)
                sock.settimeout(self.remaining())
            self.sock = sock
        except Exception:
            try:
                sock.close()
            except OSError:
                pass
            raise


def request_once(url, hostname, port, ip, max_bytes, deadline, truncate=False):
    """单跳请求；流式读取超限立即中止，测试通过替换本函数模拟网络。"""
    parts = urlsplit(url)
    path = parts.path or '/'
    if parts.query:
        path += '?' + parts.query
    connection = PinnedConnection(hostname, port, ip, parts.scheme.lower() == 'https', deadline)
    response = None
    try:
        connection.request('GET', path, headers={'User-Agent': USER_AGENT,
            'Accept': 'text/html,image/*', 'Accept-Encoding': 'identity', 'Connection': 'close'})
        response = connection.getresponse()
        headers = {name.lower(): value for name, value in response.getheaders()}
        length = headers.get('content-length', '')
        if length and (not length.isdigit() or int(length) > max_bytes):
            if truncate:
                # 大页面只读取有界前缀：图标声明在 <head> 前部，截断解析比整页丢弃更准确。
                max_bytes = min(max_bytes, 64 * 1024) if int(length or 0) > max_bytes else max_bytes
            else:
                raise FaviconError(f'响应内容超过 {max_bytes // 1024}KiB 限制', 'icon_refresh_too_large', 413)
        chunks, size = [], 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)
            if connection.sock is not None:
                connection.sock.settimeout(remaining)
            chunk = response.read1(min(16384, max_bytes + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > max_bytes:
                if truncate:
                    chunks[-1] = chunks[-1][:max(0, len(chunks[-1]) - (size - max_bytes))]
                    break
                raise FaviconError(f'响应内容超过 {max_bytes // 1024}KiB 限制', 'icon_refresh_too_large', 413)
        return response.status, headers, b''.join(chunks)
    except FaviconError:
        raise
    except (socket.timeout, TimeoutError):
        raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)
    except (OSError, http.client.HTTPException, ValueError):
        raise FaviconError('连接网站失败', 'icon_refresh_failed', 502)
    finally:
        if response is not None:
            response.close()
        connection.close()


def get(url, max_bytes, deadline, origin=None, port_guard=None, truncate=False):
    """手动跟随最多 3 次重定向；每一跳都重新校验公网地址，可按候选额外收紧端口。"""
    current = url
    for hop in range(MAX_REDIRECTS + 1):
        if time.monotonic() >= deadline:
            raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)
        hop_deadline = min(deadline, time.monotonic() + REQUEST_SECONDS)
        parts, hostname, port, ip = check_target(current, hop_deadline)
        if origin is not None and (parts.scheme.lower(), hostname, port) != origin:
            raise FaviconError('图标地址跳转到了站点以外', 'icon_refresh_failed', 502)
        if port_guard is not None and not port_guard(port):
            raise FaviconError('图标地址端口不在允许范围', 'icon_refresh_failed', 502)
        status, headers, body = request_once(current, hostname, port, ip, max_bytes, hop_deadline, truncate=truncate)
        if headers.get('content-encoding', 'identity').lower() not in ('', 'identity'):
            raise FaviconError('网站返回了不支持的压缩内容', 'icon_refresh_failed', 502)
        length = headers.get('content-length', '')
        if not truncate and ((length.isdigit() and int(length) > max_bytes) or len(body) > max_bytes):
            raise FaviconError(f'响应内容超过 {max_bytes // 1024}KiB 限制', 'icon_refresh_too_large', 413)
        if status in REDIRECT_STATUSES:
            location = headers.get('location', '').strip()
            if not location or hop >= MAX_REDIRECTS:
                raise FaviconError('重定向次数过多或目标无效', 'icon_refresh_failed', 502)
            try:
                current = urljoin(current, location)
            except ValueError:
                raise FaviconError('重定向目标无效', 'icon_refresh_failed', 502)
            continue
        if status != 200:
            raise FaviconError(f'网站返回 HTTP {status}', 'icon_refresh_failed', 502)
        return current, headers, body
    raise FaviconError('重定向次数过多', 'icon_refresh_failed', 502)


def origin_of(url):
    parts, hostname, port = parse_target_url(url)
    return parts.scheme.lower(), hostname, port


class IconLinkParser(HTMLParser):
    """按文档顺序收集 link 图标的原始属性（href/rel/type/sizes/media）。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.base = ''

    def handle_starttag(self, tag, attrs):
        values = {}
        for key, value in attrs:
            key = key.lower()
            if key not in values:
                values[key] = (value or '').strip()
        if tag == 'base' and not self.base and values.get('href'):
            self.base = values['href']
        elif tag == 'link':
            rel = set(values.get('rel', '').lower().split())
            if 'mask-icon' in rel:
                return
            if rel & {'icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'}:
                self.links.append(values)


def _html_charset(headers):
    match = re.search(r'charset=([\w.-]+)', headers.get('content-type', ''), re.IGNORECASE)
    return match.group(1) if match else 'utf-8'


def _page_url(base, page_url):
    if not base:
        return page_url
    try:
        resolved = urljoin(page_url, base)
        if urlsplit(resolved).scheme.lower() not in ('http', 'https'):
            return page_url
        return resolved
    except ValueError:
        return page_url


def _declared_type(content_type, address):
    mime = (content_type or '').split(';')[0].strip().lower()
    if mime:
        return mime
    name = urlsplit(address).path.rsplit('/', 1)[-1]
    return EXTENSION_TYPES.get(name.rsplit('.', 1)[-1].lower(), '') if '.' in name else ''


def _theme_of(media):
    """media 属性里的主题偏好；工作台默认浅色，dark 只在没有更好候选时使用。"""
    value = (media or '').lower()
    if re.search(r'prefers-color-scheme\s*:\s*dark', value):
        return 'dark'
    if re.search(r'prefers-color-scheme\s*:\s*light', value):
        return 'light'
    return None


def _sizes_of(value):
    raw = (value or '').strip().lower()
    pairs = [(int(width), int(height)) for width, height in
             re.findall(r'(\d{1,4})\s*[x×]\s*(\d{1,4})', raw)]
    pixels = sorted({min(width, height) for width, height in pairs if min(width, height) >= 1})
    if pairs:
        display = ' '.join(f'{width}x{height}' for width, height in pairs)
    else:
        display = 'any' if 'any' in raw else ''
    return display, pixels


def _raster_rank(mime):
    if not mime:
        return 1
    return 0 if mime in RASTER_TYPES else 2


def _size_rank(pixels):
    if not pixels:
        return 16
    return min(min(abs(value - target) for target in SIZE_TARGETS) for value in pixels)


def _port_allowed(port):
    """声明候选只允许常规 Web 端口，避免借图标请求探测数据库/管理端口。"""
    return port in (80, 443) or (port >= 1024 and port not in DANGEROUS_PORTS)


KIND_RANK = {'link': 0, 'apple-touch': 1, 'favicon': 0}


def _candidate_rank(candidate):
    """排序：页面声明优先，主题/栅格/sizes/rel 依次加权，最后才默认同源路径。"""
    return (0 if candidate.get('declared') else 1,
            0 if candidate.get('theme') != 'dark' else 1,
            _raster_rank(candidate.get('type', '')),
            _size_rank(candidate.get('sizeValues') or []),
            KIND_RANK.get(candidate.get('kind'), 3),
            candidate.get('order', 0))


def discover_icon_candidates(html, page_url, endpoint_url):
    """解析页面声明的图标候选（允许跨域公共 CDN），排序后追加站点默认候选；返回 (候选, 统计)。

    这里只做便宜的形式/端口预筛；完整 DNS 公网校验与逐跳重定向复验仍由 fetch_icon 的每次请求完成。
    """
    if isinstance(html, (bytes, bytearray)):
        html = bytes(html).decode('utf-8', errors='replace')
    parser = IconLinkParser()
    try:
        parser.feed(html)
    except (ValueError, AssertionError):
        pass
    reference = _page_url(parser.base, page_url)
    try:
        scheme = urlsplit(reference).scheme.lower()
        page_origin = (scheme, parse_target_url(reference)[1],
                       urlsplit(reference).port or (443 if scheme == 'https' else 80))
    except (ValueError, FaviconError):
        page_origin = None
    declared, seen = [], set()
    stats = {'declared': 0, 'svg': 0, 'rejected': 0}
    for order, values in enumerate(parser.links):
        href = values.get('href', '')
        lowered = href.lower()
        if not href or href.startswith('#') or lowered.startswith(('javascript:', 'data:', 'mailto:', 'tel:')):
            continue
        stats['declared'] += 1
        rel = set(values.get('rel', '').lower().split())
        kind = 'apple-touch' if rel & {'apple-touch-icon', 'apple-touch-icon-precomposed'} else 'link'
        try:
            address = urljoin(reference, href)
            parts = urlsplit(address)
            if parts.scheme.lower() not in ('http', 'https') or not parts.hostname:
                stats['rejected'] += 1
                continue
            mime = _declared_type(values.get('type', ''), address)
            if 'svg' in mime or parts.path.lower().endswith('.svg'):
                stats['svg'] += 1
                continue
            _, hostname, port = parse_target_url(address)
        except (ValueError, UnicodeError, FaviconError):
            stats['rejected'] += 1
            continue
        if not _port_allowed(port):
            stats['rejected'] += 1
            continue
        if address in seen:
            continue
        seen.add(address)
        sizes, size_values = _sizes_of(values.get('sizes', ''))
        declared.append({'url': address, 'kind': kind, 'type': mime, 'sizes': sizes,
            'sizeValues': size_values, 'theme': _theme_of(values.get('media', '')),
            'crossOrigin': page_origin is not None and (parts.scheme.lower(), hostname, port) != page_origin,
            'declared': True, 'order': order})
    parts = urlsplit(endpoint_url)
    defaults = []
    for index, (path, kind) in enumerate((('/favicon.ico', 'favicon'), ('/apple-touch-icon.png', 'apple-touch'))):
        address = urlunsplit((parts.scheme.lower(), parts.netloc, path, '', ''))
        if address in seen:
            continue
        seen.add(address)
        defaults.append({'url': address, 'kind': kind,
            'type': 'image/x-icon' if kind == 'favicon' else 'image/png',
            'sizes': '', 'sizeValues': [], 'theme': None, 'crossOrigin': False,
            'declared': False, 'order': len(parser.links) + index})
    candidates = sorted(declared + defaults, key=_candidate_rank)
    info = {'declared': stats['declared'], 'raster': len(declared), 'svg': stats['svg'],
            'rejected': stats['rejected'],
            'svgOnly': stats['declared'] > 0 and stats['svg'] > 0 and not declared}
    return candidates[:MAX_CANDIDATES], info


def icon_candidates(html, page_url, endpoint_url):
    """兼容入口：返回排序后的候选列表（最多 MAX_CANDIDATES 个）。"""
    return discover_icon_candidates(html, page_url, endpoint_url)[0]


class _LimitedBomb:
    """临时收紧 Pillow 的像素上限：ICO 打开即解码默认帧，需要提前拒绝超大帧。"""

    def __enter__(self):
        self.previous = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = max(1, MAX_PIXELS // 2)

    def __exit__(self, *exc_info):
        Image.MAX_IMAGE_PIXELS = self.previous
        return False


def _invalid(message='网站图标损坏或格式不受支持'):
    return FaviconError(message, 'icon_refresh_invalid', 400)


def select_ico_frame(image):
    """ICO 优先取 ≤128 且最接近 128 的较大帧；全部 >128 时取最小帧再缩放。"""
    sizes = set()
    for size in (image.info.get('sizes') or set()) | {tuple(image.size)}:
        try:
            pair = (int(size[0]), int(size[1]))
        except (TypeError, IndexError, ValueError):
            continue
        if min(pair) >= 1:
            sizes.add(pair)
    if not sizes:
        raise _invalid()
    small = [size for size in sizes if max(size) <= 128]
    target = max(small, key=lambda size: max(size)) if small else min(sizes, key=lambda size: max(size))
    try:
        if tuple(image.size) != target:
            image.size = target
        image.load()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise _invalid()
    if min(image.size) < 1 or image.width * image.height > MAX_PIXELS:
        raise _invalid('网站图标像素过多')
    return ImageOps.exif_transpose(image).convert('RGBA'), max(image.size)


def encode_icon(image):
    """剥离元数据后重编码为 ≤128 的私有 WebP；质量与尺寸逐步退让到 32KiB 以内。"""
    image = image.convert('RGBA')
    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
    for longest in (128, 96, 64):
        if max(image.size) > longest:
            image.thumbnail((longest, longest), Image.Resampling.LANCZOS)
        for quality in (85, 75, 65, 55, 45, 35):
            output = io.BytesIO()
            image.save(output, 'WEBP', quality=quality, method=4)
            if output.tell() <= MAX_OUTPUT_BYTES:
                return {'content': output.getvalue(), 'width': image.width, 'height': image.height}
    raise FaviconError('网站图标无法压缩到允许大小', 'icon_refresh_too_large', 413)


def decode_icon(raw):
    """Pillow 真实解码；不信任 Content-Type 或文件扩展名。"""
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise _invalid()
    if len(raw) > MAX_ICON_FILE_BYTES:
        raise FaviconError('单个图标文件超过 1MiB 限制', 'icon_refresh_too_large', 413)
    try:
        if raw.startswith(b'\x00\x00\x01\x00'):
            with _LimitedBomb():
                probe = Image.open(io.BytesIO(raw))
                if probe.format != 'ICO':
                    raise _invalid()
                image, frame = select_ico_frame(probe)
        else:
            probe = Image.open(io.BytesIO(raw))
            if probe.format not in ALLOWED_FORMATS:
                raise _invalid()
            if min(probe.size) < 1 or probe.width * probe.height > MAX_PIXELS:
                raise _invalid('网站图标像素过多')
            probe.load()
            image = ImageOps.exif_transpose(probe).convert('RGBA')
            frame = None
    except FaviconError:
        raise
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError,
            Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _invalid()
    variant = encode_icon(image)
    variant['frame'] = frame
    return variant


def candidate_endpoints(payload):
    """便宜预筛：只保留 scope 为公网、URL 形式合法且主机字面量不是内网的入口。"""
    entries = payload.get('endpoints') if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return []
    result = []
    for entry in entries:
        if not isinstance(entry, dict) or entry.get('scope') != '公网':
            continue
        try:
            parse_target_url(entry.get('url'))
        except FaviconError:
            continue
        result.append(entry)
    result.sort(key=lambda entry: 0 if entry.get('id') == payload.get('defaultEndpointId') else 1)
    return result


def has_public_candidate(payload):
    return bool(candidate_endpoints(payload))


def public_endpoint(payload, deadline=None):
    """返回第一个通过公网解析校验的入口；没有则提示改用扩展。"""
    overall = deadline if deadline is not None else time.monotonic() + REQUEST_SECONDS
    failures = []
    for entry in candidate_endpoints(payload):
        if time.monotonic() >= overall:
            raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)
        try:
            check_target(entry['url'], overall)
        except FaviconError as exc:
            if exc.code == 'icon_refresh_private':
                continue
            failures.append(exc)
            continue
        return entry
    if failures:
        raise failures[0]
    raise FaviconError(PRIVATE_MESSAGE, 'icon_refresh_private', 400)


def _icon_content_headers(headers):
    # 内容类型只用于诊断；是否接受完全由 Pillow 真实解码决定。
    return headers.get('content-type', '')[:100]


def _candidate_host(url):
    try:
        return (urlsplit(url).hostname or '').lower()
    except ValueError:
        return ''


def _diagnostic_entry(candidate, byte_count=0, elapsed=0.0, ok=False, code=None):
    """单个候选的诊断摘要：只保留 host/类型/主题/尺寸/字节/耗时，不含页面正文或完整敏感 URL。"""
    entry = {'host': _candidate_host(candidate['url']), 'kind': candidate.get('kind', ''),
             'type': candidate.get('type', ''), 'theme': candidate.get('theme'),
             'sizes': candidate.get('sizes', ''), 'crossOrigin': bool(candidate.get('crossOrigin')),
             'bytes': byte_count, 'elapsedMs': int(max(0.0, elapsed) * 1000), 'ok': bool(ok)}
    if code:
        entry['code'] = code
    return entry


def fetch_icon(url, deadline=None):
    """抓取首页→页面声明候选（含跨域公共 CDN）→同源默认 favicon；首页读取失败不影响默认候选。"""
    overall = deadline if deadline is not None else time.monotonic() + TOTAL_SECONDS
    if time.monotonic() >= overall:
        raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)
    diagnostics, html_error, info = [], None, {}
    candidates = []
    try:
        page_url, headers, body = get(url, MAX_HTML_BYTES, overall, truncate=True)
        try:
            html = body.decode(_html_charset(headers), errors='replace')
        except LookupError:
            html = body.decode('utf-8', errors='replace')
        candidates, info = discover_icon_candidates(html, page_url, url)
    except FaviconError as exc:
        # 首页 HTML 超限、HTTP 错误或超时只记录原因；站点自身默认 favicon 仍可能可用，
        # 不判死整次刷新。
        html_error = exc
        candidates, info = discover_icon_candidates('', url, url)
    total, received, last_error, private_error = 0, 0, None, None
    for candidate in candidates[:MAX_CANDIDATES]:
        if time.monotonic() >= overall:
            raise FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504).with_diagnostics(diagnostics)
        started = time.monotonic()
        guard = _port_allowed if candidate.get('declared') else None
        try:
            final_url, headers, raw = get(candidate['url'], MAX_ICON_FILE_BYTES, overall, port_guard=guard)
        except FaviconError as exc:
            diagnostics.append(_diagnostic_entry(candidate, elapsed=time.monotonic() - started,
                                                 code=exc.code))
            if exc.code == 'icon_refresh_private' and candidate.get('declared'):
                # 页面声明的跨域候选解析/重定向到内网：拒绝该候选，继续尝试其余候选。
                private_error = exc
                continue
            if exc.code in FATAL_CODES:
                raise exc.with_diagnostics(diagnostics)
            last_error = exc
            continue
        total += len(raw)
        if total > MAX_ICON_TOTAL_BYTES:
            raise FaviconError('图标候选累计超过 2MiB 限制', 'icon_refresh_too_large',
                               413).with_diagnostics(diagnostics)
        received += 1
        try:
            variant = decode_icon(raw)
        except FaviconError as exc:
            diagnostics.append(_diagnostic_entry(candidate, byte_count=len(raw),
                                                 elapsed=time.monotonic() - started, code=exc.code))
            last_error = exc
            continue
        diagnostics.append(_diagnostic_entry(candidate, byte_count=len(raw),
                                             elapsed=time.monotonic() - started, ok=True))
        parts, hostname, _ = parse_target_url(final_url)
        variant.update({'source_url': final_url, 'source_host': hostname,
                        'source_type': candidate['kind'],
                        'content_type': _icon_content_headers(headers),
                        'theme': candidate.get('theme'), 'sizes': candidate.get('sizes', ''),
                        'crossOrigin': bool(candidate.get('crossOrigin')),
                        'diagnostics': diagnostics})
        return variant
    if private_error is not None:
        raise private_error.with_diagnostics(diagnostics)
    if info.get('svgOnly'):
        raise FaviconError('页面仅提供 SVG 图标，服务器不会执行 SVG', 'icon_svg_only',
                           415).with_diagnostics(diagnostics)
    if received == 0:
        if last_error is not None:
            raise last_error.with_diagnostics(diagnostics)
        if html_error is not None:
            raise FaviconError(f'{html_error.message}；且未能获取网站图标', 'icon_refresh_failed',
                               502).with_diagnostics(diagnostics)
        raise FaviconError('未能获取网站图标', 'icon_refresh_failed', 502).with_diagnostics(diagnostics)
    raise (last_error if last_error is not None else _invalid()).with_diagnostics(diagnostics)
