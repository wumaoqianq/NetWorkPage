"""固定目标 IP 的 HTTP 连接；TLS 仍对原域名检查证书，避免 DNS 重绑定。"""
import http.client
import socket
import ssl
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout

MAX_BYTES = 512 * 1024
_resolver_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='safe-dns')
_resolver_slots = threading.BoundedSemaphore(2)


class FetchError(Exception):
    def __init__(self, message, code='fetch_failed'):
        self.message, self.code = message, code


def resolve(hostname, port, timeout=5):
    # 限制解析线程与排队数量；系统 DNS 即使卡住也不阻塞请求超过五秒。
    if not _resolver_slots.acquire(blocking=False):
        raise FetchError('域名解析繁忙，请稍后重试')
    task = _resolver_pool.submit(socket.getaddrinfo, hostname, port, 0, socket.SOCK_STREAM)
    task.add_done_callback(lambda _: _resolver_slots.release())
    try:
        return list(dict.fromkeys(answer[4][0] for answer in task.result(timeout=timeout)))
    except (OSError, FutureTimeout) as exc:
        raise FetchError('域名解析失败或超时') from exc


class DeadlineReads:
    """每次底层读取都扣除总预算，防止缓慢响应逐字节延长超时。"""
    deadline = None

    def recv_into(self, *args, **kwargs):
        if self.deadline is not None:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise socket.timeout('request deadline exceeded')
            self.settimeout(remaining)
        return super().recv_into(*args, **kwargs)


class DeadlineSocket(DeadlineReads, socket.socket):
    pass


class DeadlineSSL(DeadlineReads, ssl.SSLSocket):
    pass


class BudgetReader:
    """响应头、分块控制行和正文共用字节预算，避免仅限制解码后正文。"""
    def __init__(self, reader):
        self.reader, self.total = reader, 0

    def _read(self, method, size=-1):
        remaining = MAX_BYTES + 1 - self.total
        size = min(size, remaining) if size >= 0 else remaining
        value = getattr(self.reader, method)(size)
        self.total += len(value)
        if self.total > MAX_BYTES:
            raise FetchError('网页响应超过 512 KiB 限制', 'response_too_large')
        return value

    def read(self, size=-1):
        return self._read('read', size)

    def read1(self, size=-1):
        return self._read('read1', size)

    def readline(self, size=-1):
        return self._read('readline', size)

    def readinto(self, buffer):
        value = self.read(len(buffer))
        buffer[:len(value)] = value
        return len(value)

    def close(self):
        return self.reader.close()


class BoundedResponse(http.client.HTTPResponse):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fp = BudgetReader(self.fp)


class PinnedHTTP(http.client.HTTPConnection):
    response_class = BoundedResponse

    def __init__(self, hostname, ip, port, deadline, secure):
        super().__init__(hostname, port, timeout=max(0.01, deadline - time.monotonic()))
        self.ip, self.deadline, self.secure = ip, deadline, secure

    def connect(self):
        family = socket.AF_INET6 if ':' in self.ip else socket.AF_INET
        sock = DeadlineSocket(family, socket.SOCK_STREAM)
        sock.deadline = self.deadline
        try:
            sock.settimeout(max(0.01, self.deadline - time.monotonic()))
            sock.connect((self.ip, self.port))
            if self.secure:
                sock.settimeout(max(0.01, self.deadline - time.monotonic()))
                context = ssl.create_default_context()
                context.sslsocket_class = DeadlineSSL
                sock = context.wrap_socket(sock, server_hostname=self.host)
                sock.deadline = self.deadline
            self.sock = sock
        except Exception:
            sock.close()
            raise


def transport(parts, ip, deadline):
    connection = PinnedHTTP(parts.hostname, ip, parts.port or (443 if parts.scheme == 'https' else 80), deadline, parts.scheme == 'https')
    response = None
    try:
        path = parts.path or '/'
        if parts.query:
            path += '?' + parts.query
        connection.request('GET', path, headers={'User-Agent': 'PrivateWorkspace/1.0',
                           'Accept': 'text/html', 'Accept-Encoding': 'identity', 'Connection': 'close'})
        live_socket = connection.sock
        live_socket.settimeout(max(0.01, deadline - time.monotonic()))
        response = connection.getresponse()
        headers = {name.lower(): value for name, value in response.getheaders()}
        length = headers.get('content-length')
        if length and (not length.isdigit() or int(length) > MAX_BYTES):
            raise FetchError('网页超过 512 KiB 限制', 'response_too_large')
        chunks, size = [], 0
        while size <= MAX_BYTES:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise FetchError('请求超时')
            live_socket.settimeout(remaining)
            chunk = response.read1(min(16384, MAX_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        if size > MAX_BYTES:
            raise FetchError('网页超过 512 KiB 限制', 'response_too_large')
        return response.status, headers, b''.join(chunks)
    except (OSError, http.client.HTTPException, ValueError) as exc:
        raise FetchError('连接失败或超时') from exc
    finally:
        if response is not None:
            response.close()
        connection.close()
