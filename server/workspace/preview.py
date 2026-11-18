"""附件只能沿同账号收藏回执上传；网站和附件分别确认、分别重试。"""
import hashlib
import json
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt

from workspace.asset_baseline import record_tombstone
from workspace.http import ApiError, api, body, digest, owned
from workspace.library import preview_dto
from workspace.media import MAX_INPUT_BYTES, media_path, process_image, publish_images, quota_used
from workspace.models import CaptureReceipt, PreviewAsset, PreviewReceipt, Site
from workspace.validation import safe_url, text


def integer(value, label):
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise ApiError(f'{label}格式不正确')
    if result < 1:
        raise ApiError(f'{label}格式不正确')
    return result


def attachment_context(request, capture_id, expected_version=None):
    capture = CaptureReceipt.objects.select_related('site').filter(
        owner=request.user, client_capture_id=capture_id).first()
    if not capture or not capture.site or not capture.can_attach_preview:
        raise ApiError('此收藏回执没有上传图片的许可，请重新确认', 'forbidden', 403)
    site = capture.site
    if site.payload.get('deleted') or site.payload.get('archived'):
        raise ApiError('网站已删除或归档，请在工作台复核', 'preview_source_changed', 409)
    if expected_version is not None and site.version != expected_version:
        raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
    return capture, site


def source_metadata(request, site):
    source_url = safe_url(request.POST.get('sourceUrl', ''))
    endpoint_id = text(request.POST.get('sourceEndpointId', ''), 100)
    endpoint = next((entry for entry in site.payload.get('endpoints', [])
                     if entry['url'] == source_url and (not endpoint_id or entry['id'] == endpoint_id)), None)
    if not endpoint:
        raise ApiError('截图来源地址已变化，请重新收藏或复核', 'preview_source_changed', 409)
    endpoint_id = endpoint['id']
    page_kind = request.POST.get('pageKind', 'current')
    confirmed = request.POST.get('userConfirmedHomepage') == 'true'
    homepage = safe_url(request.POST.get('homepageUrl', '')) if request.POST.get('homepageUrl') else ''
    if page_kind not in {'current', 'home'}:
        raise ApiError('截图来源类型不正确', 'preview_invalid')
    if page_kind == 'home' and (not confirmed or not homepage or homepage != source_url
                                or site.payload.get('homepageUrl') != homepage):
        raise ApiError('首页截图需要地址一致并由用户明确确认', 'preview_source_changed', 409)
    captured_at = parse_datetime(request.POST.get('capturedAt', ''))
    if not captured_at or not timezone.is_aware(captured_at) or captured_at > timezone.now() + timedelta(minutes=5):
        raise ApiError('截图时间不正确', 'preview_invalid')
    return {'source_endpoint_id': endpoint_id, 'source_url': source_url, 'homepage_url': homepage,
            'page_kind': page_kind, 'user_confirmed_homepage': confirmed, 'captured_at': captured_at,
            'source_fingerprint': digest('|'.join((endpoint_id, source_url, homepage, page_kind)))}


@csrf_exempt
@api(['POST'], bearer=True, rate=60)
def upload(request, capture_id):
    client_asset_id = text(request.POST.get('clientAssetId', ''), 128, True)
    expected_version = integer(request.POST.get('expectedVersion'), 'expectedVersion')
    capture, site = attachment_context(request, capture_id)
    upload_file = request.FILES.get('file')
    if not upload_file:
        raise ApiError('请选择截图文件', 'preview_invalid')
    raw = upload_file.read(MAX_INPUT_BYTES + 1)
    metadata = source_metadata(request, site)
    fingerprint_source = json.dumps({'captureId': capture_id, 'assetId': client_asset_id,
        'metadata': {key: value.isoformat() if key == 'captured_at' else value for key, value in metadata.items()}},
        sort_keys=True).encode() + b'\n' + raw
    fingerprint = hashlib.sha256(fingerprint_source).hexdigest()
    existing = PreviewReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
    if existing:
        if existing.content_fingerprint != fingerprint:
            raise ApiError('同一附件编号对应了不同内容', 'idempotency_conflict', 409)
        return existing.result
    variants = process_image(raw)
    keys = publish_images(request.user.pk, variants)
    with transaction.atomic():
        capture, site = attachment_context(request, capture_id, expected_version)
        source_metadata(request, site)
        repeated = PreviewReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
        if repeated:
            if repeated.content_fingerprint != fingerprint:
                raise ApiError('同一附件编号对应了不同内容', 'idempotency_conflict', 409)
            return repeated.result
        previous = PreviewAsset.objects.filter(site=site).first()
        old_bytes = (previous.bytes + previous.thumbnail_bytes) if previous else 0
        new_bytes = len(variants['full']['content']) + len(variants['thumb']['content'])
        if quota_used(request.user) - old_bytes + new_bytes > settings.PREVIEW_QUOTA_BYTES:
            raise ApiError('账号图片空间已满，请移除旧图或只保存文字', 'preview_quota_exceeded', 413)
        values = {'owner': request.user, 'storage_key': keys['full'], 'thumbnail_key': keys['thumb'],
            'mime': 'image/webp', 'width': variants['full']['width'], 'height': variants['full']['height'],
            'bytes': len(variants['full']['content']), 'thumbnail_bytes': len(variants['thumb']['content']),
            'revision': uuid.uuid4(), 'stale': False, **metadata}
        if previous:
            for key, value in values.items():
                if key != 'owner':
                    setattr(previous, key, value)
            previous.save()
            asset = previous
        else:
            asset = PreviewAsset.objects.create(site=site, **values)
        updated = Site.objects.filter(pk=site.pk, owner=request.user, version=expected_version).update(
            version=expected_version + 1, updated_at=timezone.now())
        if not updated:
            raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
        result = {'assetId': str(asset.pk), 'siteVersion': expected_version + 1,
                  'status': 'complete', 'revision': str(asset.revision)}
        PreviewReceipt.objects.create(owner=request.user, capture=capture, site=site, asset=asset,
            client_asset_id=client_asset_id, content_fingerprint=fingerprint, result=result,
            expires_at=timezone.now() + timedelta(days=30))
    return result


@api(['GET', 'DELETE'])
def detail(request, pk):
    site = owned(Site, request.user, pk)
    if request.method == 'GET':
        return {'preview': preview_dto(getattr(site, 'preview_asset', None)), 'siteVersion': site.version}
    data = body(request)
    with transaction.atomic():
        site = owned(Site, request.user, pk)
        if data.get('version') != site.version:
            raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
        asset = getattr(site, 'preview_asset', None)
        if not asset:
            return {'removed': True, 'siteVersion': site.version}
        updated = Site.objects.filter(pk=site.pk, owner=request.user, version=site.version).update(
            version=site.version + 1, updated_at=timezone.now())
        if not updated:
            raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
        record_tombstone(request.user, site, 'preview', str(asset.revision))
        asset.delete()
    return {'removed': True, 'siteVersion': site.version + 1}


@api(['GET'], rate=180)
def image(request, pk):
    site = owned(Site, request.user, pk)
    asset = getattr(site, 'preview_asset', None)
    size = request.GET.get('size', 'thumb')
    if not asset or size not in {'thumb', 'full'}:
        raise ApiError('预览图不存在', 'not_found', 404)
    if request.GET.get('rev') and request.GET['rev'] != str(asset.revision):
        raise ApiError('预览图已更新', 'not_found', 404)
    key = asset.thumbnail_key if size == 'thumb' else asset.storage_key
    path = media_path(Path(settings.MEDIA_ROOT), key)
    if not path.is_file() or path.is_symlink():
        raise ApiError('预览文件暂不可用', 'preview_missing', 404)
    response = FileResponse(path.open('rb'), content_type='image/webp')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Disposition'] = 'inline'
    return response
