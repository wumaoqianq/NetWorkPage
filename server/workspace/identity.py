"""身份建立和恢复：使用 Django 密码校验、会话轮换与一次性散列令牌。"""
import secrets
from datetime import timedelta
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.sessions.models import Session
from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from workspace.models import SetupState, Invite, Device, PairingCode, RecoveryToken, AuditEvent
from workspace.http import api, body, user_dto, digest, ApiError
from workspace.validation import text, password_value
from workspace.library import defaults


def setup_required():
    return settings.SETUP_ENABLED and not User.objects.exists() and not SetupState.objects.filter(pk=1, completed=True).exists()


def local_setup_allowed(request):
    # 此调试便利模式同时要求显式开关、DEBUG 与真实回环来源，绝不相信转发头。
    return settings.DEBUG and settings.ALLOW_LOCAL_SETUP and request.META.get('REMOTE_ADDR') in ('127.0.0.1', '::1')


def create_user(data, admin=False):
    email = text(data.get('email', ''), 254, True).lower()
    validate_email(email)
    user = User(username=email, email=email, first_name=text(data.get('name', ''), 100), is_staff=admin, is_superuser=admin)
    password = password_value(data.get('password', ''))
    validate_password(password, user)
    user.set_password(password)
    user.save()
    defaults(user)
    return user


@api(['GET'], public=True)
def session(request):
    return {'user': user_dto(request.user), 'setupRequired': setup_required(),
            'setupTokenRequired': not local_setup_allowed(request), 'csrfToken': get_token(request)}


@api(['POST'], public=True, rate=10)
def setup(request):
    data = body(request)
    if not local_setup_allowed(request) and (not settings.SETUP_TOKEN or not constant_time_compare(str(data.get('setupToken', '')), settings.SETUP_TOKEN)):
        raise ApiError('初始化凭证无效，请联系服务器管理员', 'setup_token_invalid', 403)
    # SQLite IMMEDIATE 事务在检查前获得写锁，第二个初始化请求只能看到已完成状态。
    with transaction.atomic():
        state, _ = SetupState.objects.get_or_create(pk=1)
        if not setup_required() or state.completed:
            raise ApiError('初始化已关闭或已经完成', 'setup_closed', 409)
        user = create_user(data, admin=True)
        state.completed = True
        state.save(update_fields=['completed'])
        AuditEvent.objects.create(event='setup_completed', actor_id=user.pk)
    login(request, user)
    return {'user': user_dto(user)}


@api(['POST'], public=True, rate=10)
def signin(request):
    data = body(request)
    email = text(data.get('email', ''), 254).lower()
    user = authenticate(request, username=email, password=password_value(data.get('password', '')))
    if not user:
        raise ApiError('邮箱或密码不正确，或账号已停用', 'invalid_credentials', 401)
    login(request, user)
    return {'user': user_dto(user)}


@api(['POST'])
def signout(request):
    logout(request)
    return {'user': None}


@api(['POST'], admin=True, rate=20)
def invites(request):
    data = body(request)
    email = text(data.get('email', ''), 254).lower()
    if email:
        validate_email(email)
    token = secrets.token_urlsafe(32)
    invite = Invite.objects.create(token_hash=digest(token), email=email, created_by=request.user,
                                   expires_at=timezone.now()+timedelta(days=7))
    return {'token': token, 'email': email, 'expiresAt': invite.expires_at.isoformat(),
            'url': settings.PUBLIC_URL.rstrip('/') + '/?invite=' + token}


def valid_invite(token):
    invite = Invite.objects.filter(token_hash=digest(text(token, 200)), used_at=None, expires_at__gt=timezone.now()).first()
    if not invite:
        raise ApiError('邀请不存在、已使用或已过期', 'invite_invalid', 400)
    return invite


@api(['GET'], public=True, rate=30)
def invite_detail(request, token):
    invite = valid_invite(token)
    return {'email': invite.email, 'expiresAt': invite.expires_at.isoformat()}


@api(['POST'], public=True, rate=10)
def register(request):
    data = body(request)
    with transaction.atomic():
        invite = valid_invite(data.get('token', data.get('inviteToken', '')))
        if invite.email and invite.email != str(data.get('email', '')).strip().lower():
            raise ApiError('邮箱与邀请不符')
        user = create_user(data)
        invite.used_at = timezone.now()
        invite.save(update_fields=['used_at'])
    login(request, user)
    return {'user': user_dto(user)}


@api(['GET'], admin=True)
def users(request):
    return {'users': [{**user_dto(user), 'isActive': user.is_active} for user in User.objects.order_by('id')[:1000]]}


@api(['PATCH'], admin=True, rate=30)
def user_detail(request, pk):
    data = body(request)
    with transaction.atomic():
        user = User.objects.filter(pk=pk).first()
        if not user:
            raise ApiError('账号不存在', 'not_found', 404)
        active, admin = data.get('isActive', user.is_active), data.get('isAdmin', user.is_staff)
        if not isinstance(active, bool) or not isinstance(admin, bool):
            raise ApiError('账号状态格式不正确')
        if user.pk == request.user.pk and (not active or not admin):
            raise ApiError('不能停用或移除自己的管理员身份', 'self_lockout', 409)
        if user.is_staff and user.is_active and (not active or not admin) and User.objects.filter(is_active=True, is_staff=True).count() <= 1:
            raise ApiError('至少保留一个启用的管理员', 'last_admin', 409)
        user.is_active, user.is_staff, user.is_superuser = active, admin, admin
        user.save(update_fields=['is_active', 'is_staff', 'is_superuser'])
        if not active:
            Device.objects.filter(owner=user, revoked_at=None).update(revoked_at=timezone.now())
            PairingCode.objects.filter(owner=user, used_at=None).update(used_at=timezone.now())
            revoke_sessions(user)
        AuditEvent.objects.create(event='user_status_changed', actor_id=request.user.pk, subject_id=user.pk)
    return {'user': {**user_dto(user), 'isActive': user.is_active}}


def revoke_sessions(user):
    # 停用不能仅依赖 is_active；删除数据库会话，避免账号恢复后旧 cookie 重新生效。
    keys = []
    for session_record in Session.objects.filter(expire_date__gt=timezone.now()).iterator(chunk_size=200):
        if str(session_record.get_decoded().get('_auth_user_id')) == str(user.pk):
            keys.append(session_record.session_key)
        if len(keys) >= 200:
            Session.objects.filter(session_key__in=keys).delete()
            keys = []
    if keys:
        Session.objects.filter(session_key__in=keys).delete()


def change_password(user, password):
    password = password_value(password)
    validate_password(password, user)
    user.set_password(password)
    user.save(update_fields=['password'])
    Device.objects.filter(owner=user, revoked_at=None).update(revoked_at=timezone.now())
    PairingCode.objects.filter(owner=user, used_at=None).update(used_at=timezone.now())
    RecoveryToken.objects.filter(owner=user, used_at=None).update(used_at=timezone.now())
    AuditEvent.objects.create(event='password_changed', subject_id=user.pk)


@api(['POST'], rate=10)
def password(request):
    data = body(request)
    if not request.user.check_password(password_value(data.get('currentPassword', ''))):
        raise ApiError('当前密码不正确', 'invalid_credentials', 400)
    with transaction.atomic():
        change_password(request.user, data.get('password', ''))
    logout(request)
    return {'user': None}


def issue_recovery(user, actor_id=None):
    token = secrets.token_urlsafe(32)
    RecoveryToken.objects.filter(owner=user, used_at=None).update(used_at=timezone.now())
    record = RecoveryToken.objects.create(owner=user, token_hash=digest(token), expires_at=timezone.now()+timedelta(minutes=15))
    AuditEvent.objects.create(event='recovery_issued', actor_id=actor_id, subject_id=user.pk)
    return {'token': token, 'expiresAt': record.expires_at.isoformat(),
            'url': settings.PUBLIC_URL.rstrip('/') + '/?recover=' + token}


@api(['POST'], admin=True, rate=10)
def recovery_issue(request, pk):
    user = User.objects.filter(pk=pk).first()
    if not user:
        raise ApiError('账号不存在', 'not_found', 404)
    with transaction.atomic():
        return issue_recovery(user, request.user.pk)


@api(['POST'], public=True, rate=10)
def recover(request):
    data = body(request)
    with transaction.atomic():
        record = RecoveryToken.objects.select_related('owner').filter(token_hash=digest(text(data.get('token', ''), 200)),
            used_at=None, expires_at__gt=timezone.now(), owner__is_active=True).first()
        if not record:
            raise ApiError('恢复令牌不存在、已使用或已过期', 'recovery_invalid', 400)
        change_password(record.owner, data.get('password', ''))
    logout(request)
    return {'user': None}
