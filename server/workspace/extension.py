"""配对兑换仅返回一次原始凭证；数据库只保存散列。"""
import secrets
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from workspace.asset_baseline import baseline_dto
from workspace.models import PairingCode, Device, Endpoint, CaptureReceipt
from workspace.http import api, body, digest, user_dto, owned, ApiError
from workspace.validation import text, safe_url
from workspace.library import save_site


def device_dto(device):
    return {'id': str(device.pk), 'name': device.name, 'expiresAt': device.expires_at.isoformat(),
            'revoked': device.revoked_at is not None, 'extensionVersion': device.extension_version or None,
            'protocolVersion': device.protocol_version,
            'lastActiveAt': device.last_active_at.isoformat() if device.last_active_at else None}


def capture_site_dto(site):
    from workspace.icon_jobs import icon_job_dto
    # 收藏扩展只读取整理所需摘要，不授予账号说明、个人备注或图片内容。
    preview = getattr(site, 'preview_asset', None)
    icon = getattr(site, 'site_icon_asset', None)
    return {'id': str(site.pk), 'name': site.payload['name'], 'purpose': site.payload.get('purpose', ''),
            'description': site.payload.get('description', ''), 'category': site.payload.get('category', ''),
            'tags': site.payload.get('tags', []), 'collectionIds': site.payload.get('collections', []),
            'version': site.version, 'deleted': site.payload.get('deleted', False),
            'archived': site.payload.get('archived', False),
            'previewPresent': preview is not None, 'iconPresent': icon is not None,
            'previewRevision': str(preview.revision) if preview else None,
            'iconRevision': str(icon.revision) if icon else None,
            'previewSourceUrl': preview.source_url if preview else '',
            'iconSourceUrl': icon.source_url if icon else '',
            'previewBaseline': baseline_dto(site, 'preview'),
            'iconBaseline': baseline_dto(site, 'icon'),
             'iconJob': icon_job_dto(site)}


@api(['POST'], rate=10)
def pairing_code(request):
    code = secrets.token_urlsafe(12)
    record = PairingCode.objects.create(owner=request.user, token_hash=digest(code),
                                       expires_at=timezone.now()+timedelta(minutes=5))
    return {'code': code, 'expiresAt': record.expires_at.isoformat()}


@csrf_exempt
@api(['POST'], public=True, rate=10)
def pair(request):
    data = body(request)
    protocol = data.get('protocolVersion', 1)
    if type(protocol) is not int or protocol not in (1, 2):
        raise ApiError('扩展协议不受支持，请下载兼容版本', 'extension_upgrade_required', 426)
    version = text(data.get('extensionVersion', ''), 20)
    with transaction.atomic():
        record = PairingCode.objects.select_related('owner').filter(token_hash=digest(text(data.get('code', ''), 200)),
            expires_at__gt=timezone.now(), used_at=None, owner__is_active=True).first()
        if not record:
            raise ApiError('配对码不存在、已使用或已过期', 'pairing_invalid', 400)
        token = secrets.token_urlsafe(40)
        device = Device.objects.create(owner=record.owner, name=text(data.get('name', '浏览器扩展'), 100, True),
            token_hash=digest(token), auth_hash=record.owner.get_session_auth_hash(),
            expires_at=timezone.now()+timedelta(days=30), extension_version=version,
            protocol_version=protocol, last_active_at=timezone.now())
        record.used_at = timezone.now()
        record.save(update_fields=['used_at'])
    return {'token': token, 'user': user_dto(record.owner), 'device': device_dto(device),
            'expiresAt': device.expires_at.isoformat(), 'protocolRange': {'min': 1, 'max': 2}}


@api(['GET', 'DELETE'])
def devices(request, pk=None):
    if request.method == 'GET':
        return {'devices': [device_dto(d) for d in Device.objects.filter(owner=request.user, revoked_at=None)]}
    device = owned(Device, request.user, pk)
    device.revoked_at = timezone.now()
    device.save(update_fields=['revoked_at'])
    return {'deleted': True}


@csrf_exempt
@api(['GET'], bearer=True, rate=180)
def lookup(request):
    url = safe_url(request.GET.get('url', ''))
    entry = Endpoint.objects.select_related('site', 'site__preview_asset', 'site__site_icon_asset').filter(owner=request.user, url=url).first()
    Device.objects.filter(pk=request.device.pk).update(last_active_at=timezone.now())
    return {'site': capture_site_dto(entry.site) if entry else None, 'duplicate': entry is not None}


@csrf_exempt
@api(['POST'], bearer=True, rate=120)
def captures(request):
    data = body(request)
    capture_id = text(data.get('clientCaptureId', ''), 128, True)
    url = safe_url(data.get('url', ''))
    title = text(data.get('title', ''), 100) or url
    purpose = text(data.get('purpose', ''), 1000)
    if 'updateExisting' in data and not isinstance(data['updateExisting'], bool):
        raise ApiError('更新选项格式不正确')
    with transaction.atomic():
        # 回执按原用户而非设备去重，原用户重新配对后仍可确认断网重试。
        receipt = CaptureReceipt.objects.select_related('site').filter(owner=request.user, client_capture_id=capture_id).first()
        if receipt:
            if receipt.site is None:
                raise ApiError('该收藏已处理且网站已删除', 'capture_gone', 410)
            return {'site': capture_site_dto(receipt.site), 'duplicate': True}
        endpoint = Endpoint.objects.select_related('site').filter(owner=request.user, url=url).first()
        duplicate = endpoint is not None
        if endpoint:
            site = endpoint.site
            if data.get('updateExisting'):
                site = save_site(request.user, {'version': site.version, 'name': title, 'purpose': purpose}, site)
        else:
            site = save_site(request.user, {'name': title, 'purpose': purpose, 'inbox': True,
                'endpoints': [{'url': url, 'label': '默认入口', 'scope': '公网'}]})
        CaptureReceipt.objects.create(owner=request.user, device=request.device, client_capture_id=capture_id, site=site)
    return {'site': capture_site_dto(site), 'duplicate': duplicate}
