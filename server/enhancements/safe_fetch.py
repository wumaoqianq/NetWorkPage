"""仅抓取已校验公网地址，输出纯文本；不执行网页、不使用代理或浏览器状态。"""
import ipaddress
import time
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin
from django.utils import timezone
from enhancements.network import FetchError, resolve, transport, MAX_BYTES

TRANSITION_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    '64:ff9b::/96', '64:ff9b:1::/48', '2002::/16', '2001::/32'))


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.description, self.parts = [], '', []
        self.in_title = False
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'template'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'title':
            self.in_title = True
        attrs = dict(attrs)
        if tag == 'meta' and attrs.get('name', '').lower() == 'description':
            self.description = attrs.get('content', '')[:2000]

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript', 'template'):
            self.skip = max(0, self.skip - 1)
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self.in_title:
                self.title.append(data)


def target(url, deadline):
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) <= 32 or ord(c) == 127 for c in url) or '\\' in url:
        raise FetchError('网址格式不受支持', 'unsupported')
    try:
        parts = urlsplit(url)
        if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError()
        if parts.port not in (None, 80, 443) or '%' in parts.netloc:
            raise ValueError()
        hostname = parts.hostname.encode('idna').decode('ascii')
        addresses = resolve(hostname, parts.port or (443 if parts.scheme == 'https' else 80), max(0.01, deadline - time.monotonic()))
        if not addresses:
            raise FetchError('域名没有可用公网地址', 'unsupported')
        for value in addresses:
            address = ipaddress.ip_address(value)
            # 禁止 IPv6 转换隧道和站点本地地址，避免公网外观隐藏 IPv4 内网目标。
            transition = address.version == 6 and any(address in network for network in TRANSITION_NETWORKS)
            special = getattr(address, 'ipv4_mapped', None) or getattr(address, 'is_site_local', False)
            if not address.is_global or address.is_multicast or special or transition:
                raise FetchError('内部、保留或特殊网络入口暂不支持服务器检查', 'unsupported')
        return parts, addresses[0]
    except (ValueError, UnicodeError) as exc:
        raise FetchError('网址或端口不受支持', 'unsupported') from exc


def fetch(url):
    deadline = time.monotonic() + 5
    for hop in range(4):
        parts, ip = target(url, deadline)
        if time.monotonic() >= deadline:
            raise FetchError('请求超时')
        status, headers, content = transport(parts, ip, deadline)
        if len(content) > MAX_BYTES:
            raise FetchError('网页超过 512 KiB 限制', 'response_too_large')
        if status in (301, 302, 303, 307, 308):
            if hop == 3 or not headers.get('location'):
                raise FetchError('重定向次数过多或目标无效')
            try:
                url = urljoin(url, headers['location'])
            except ValueError as exc:
                raise FetchError('重定向目标无效', 'unsupported') from exc
            continue
        if headers.get('content-encoding', 'identity').lower() not in ('', 'identity'):
            raise FetchError('不支持压缩网页响应', 'unsupported')
        parser = TextParser()
        if 'text/html' in headers.get('content-type', '').lower():
            parser.feed(content.decode('utf-8', errors='replace'))
        text = ' '.join(' '.join(parser.parts).split())
        text = text.encode('utf-8')[:128 * 1024].decode('utf-8', errors='ignore')
        return {'title': ' '.join(' '.join(parser.title).split())[:500], 'description': parser.description,
                'text': text, 'url': url, 'checkedAt': timezone.now().isoformat(), 'source': 'server',
                'httpStatus': status, 'status': 'available' if 200 <= status < 400 else 'http_error'}
