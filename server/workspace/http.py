from django.http import JsonResponse
from django.core.exceptions import ValidationError, RequestDataTooBig
from django.db import IntegrityError, OperationalError
from django.core.cache import cache
from django.conf import settings
from django.utils.crypto import constant_time_compare
from django.utils import timezone
from functools import wraps
import hashlib
import json
from ipaddress import ip_address


class ApiError(Exception):
    def __init__(self, message, code='validation_error', status=400):
        self.message, self.code, self.status = message, code, status


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def body(request):
    try:
        value = json.loads(request.body or b'{}')
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise ApiError('JSON 格式不正确')
    if not isinstance(value, dict):
        raise ApiError('请求必须是 JSON 对象')
    return value


def user_dto(user):
    return {'id': user.pk, 'email': user.email, 'name': user.first_name or user.email,
            'isAdmin': user.is_staff} if user and user.is_authenticated else None


def client_address(request):
    address = request.META.get('REMOTE_ADDR', '')
    # 仅显式启用且实际连接来自回环代理时采用其覆盖后的真实 IP；公网客户端不能伪造限流身份。
    if settings.SECURE_PROXY_SSL_HEADER and address in ('127.0.0.1', '::1'):
        try:
            return str(ip_address(request.META.get('HTTP_X_REAL_IP', '')))
        except ValueError:
            pass
    return address


def api(methods, public=False, admin=False, bearer=False, rate=None):
    """所有业务入口统一处理身份及错误，不把异常和私人请求体写入响应。"""
    def decorate(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            try:
                if request.method not in methods:
                    raise ApiError('请求方法不支持', 'method_not_allowed', 405)
                if bearer:
                    from workspace.models import Device
                    header = request.headers.get('Authorization', '')
                    if bearer == 'optional' and not header:
                        if not request.user.is_authenticated or not request.user.is_active:
                            raise ApiError('请先登录或配对扩展', 'auth_required', 401)
                    else:
                        if not header.startswith('Bearer '):
                            raise ApiError('请重新配对扩展', 'auth_required', 401)
                        device = Device.objects.select_related('owner').filter(token_hash=digest(header[7:]),
                            revoked_at=None, expires_at__gt=timezone.now(), owner__is_active=True).first()
                        if not device or not constant_time_compare(device.auth_hash, device.owner.get_session_auth_hash()):
                            raise ApiError('设备凭证已失效，请重新配对', 'auth_required', 401)
                        request.user, request.device = device.owner, device
                elif not public and (not request.user.is_authenticated or not request.user.is_active):
                    raise ApiError('请先登录', 'auth_required', 401)
                if admin and not request.user.is_staff:
                    raise ApiError('需要管理员权限', 'forbidden', 403)
                if rate and settings.RATE_LIMIT_ENABLED:
                    identity = str(request.user.pk) if request.user.is_authenticated else client_address(request)
                    key = 'rate:' + digest(view.__name__ + identity)
                    if cache.add(key, 1, 60):
                        count = 1
                    else:
                        count = cache.incr(key)
                    if count > rate:
                        raise ApiError('操作过于频繁，请稍后重试', 'rate_limited', 429)
                result = view(request, *args, **kwargs)
                response = result if hasattr(result, 'status_code') else JsonResponse(result, safe=not isinstance(result, list))
            except ApiError as exc:
                response = JsonResponse({'error': exc.message, 'code': exc.code}, status=exc.status)
            except ValidationError as exc:
                response = JsonResponse({'error': '；'.join(exc.messages), 'code': 'validation_error'}, status=400)
            except RequestDataTooBig:
                response = JsonResponse({'error': '请求内容过大', 'code': 'payload_too_large'}, status=413)
            except (ValueError, TypeError, KeyError, RecursionError):
                response = JsonResponse({'error': '请求数据格式不正确', 'code': 'validation_error'}, status=400)
            except IntegrityError:
                response = JsonResponse({'error': '资料重复或已被其他操作修改', 'code': 'conflict'}, status=409)
            except OperationalError:
                response = JsonResponse({'error': '数据库正忙，请稍后重试', 'code': 'database_busy'}, status=503)
            if 'Cache-Control' not in response:
                response['Cache-Control'] = 'no-store'
            return response
        return wrapped
    return decorate


def owned(model, user, pk):
    try:
        obj = model.objects.filter(owner=user, pk=pk).first()
    except (ValidationError, ValueError):
        obj = None
    if obj is None:
        raise ApiError('资料不存在', 'not_found', 404)
    return obj


def csrf_failure(request, reason=''):
    return JsonResponse({'error': '请求安全校验失败，请刷新页面重试', 'code': 'csrf_failed'}, status=403)
