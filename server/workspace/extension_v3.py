"""协议 3 素材条件写入层：客户端带素材基线（revision + 入口来源指纹）上传，
服务端在事务内复核基线后再发布，防止并发覆盖与 ABA（删图后又无图）。

- 幂等优先：相同 clientAssetId + 相同内容直接返回首次结果，绝不重新挂素材。
- 基线校验：入口集合变化 -> asset_source_changed；素材 revision/墓碑不符 -> asset_conflict。
- 发布在事务外先做，任何失败按已发布的 storage_key 删除文件，不留孤立媒体。
"""
import hashlib
import json
import re
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from workspace import icons, preview
from workspace.asset_baseline import (check_baseline, site_source_fingerprint, source_url_fingerprint)
from workspace.http import ApiError, api
from workspace.media import MAX_INPUT_BYTES, media_path, process_image, publish_images, quota_used
from workspace.models import IconReceipt, PreviewAsset, PreviewReceipt, Site, SiteIconAsset
from workspace.validation import text


def _remove_media(keys):
    root = Path(settings.MEDIA_ROOT)
    for key in keys:
        media_path(root, key).unlink(missing_ok=True)


def _baseline_fields(request):
    expected_revision = text(request.POST.get('expectedAssetRevision', ''), 36, True)
    expected_source_fingerprint = text(request.POST.get('expectedSourceFingerprint', ''), 64, True)
    if not re.fullmatch(r'[0-9a-f]{64}', expected_source_fingerprint):
        raise ApiError('素材来源指纹格式不正确')
    return expected_revision, expected_source_fingerprint


def _preview_fingerprint(capture_id, client_asset_id, metadata, raw):
    source = json.dumps({'captureId': capture_id, 'assetId': client_asset_id,
        'metadata': {key: value.isoformat() if key == 'captured_at' else value
                     for key, value in metadata.items()}}, sort_keys=True).encode() + b'\n' + raw
    return hashlib.sha256(source).hexdigest()


def _icon_fingerprint(capture_id, client_asset_id, source_url, raw):
    return hashlib.sha256(b'\n'.join((capture_id.encode(), client_asset_id.encode(),
        source_url.encode(), raw))).hexdigest()


def _result(asset, site_version, source_fingerprint):
    return {'assetId': str(asset.pk), 'siteVersion': site_version, 'status': 'complete',
            'revision': str(asset.revision), 'assetRevision': str(asset.revision),
            'sourceFingerprint': source_fingerprint}


@csrf_exempt
@api(['POST'], bearer=True, rate=60)
def preview_upload(request, capture_id):
    client_asset_id = text(request.POST.get('clientAssetId', ''), 128, True)
    expected_revision, expected_source_fingerprint = _baseline_fields(request)
    capture, site = preview.attachment_context(request, capture_id)
    upload_file = request.FILES.get('file')
    if not upload_file:
        raise ApiError('请选择截图文件', 'preview_invalid')
    raw = upload_file.read(MAX_INPUT_BYTES + 1)
    metadata = preview.source_metadata(request, site)
    fingerprint = _preview_fingerprint(capture_id, client_asset_id, metadata, raw)
    # 幂等优先：必须在 check_baseline 之前，保证「相同请求已完成优先返回原幂等结果」。
    existing = PreviewReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
    if existing:
        if existing.content_fingerprint != fingerprint:
            raise ApiError('同一素材编号对应了不同内容', 'idempotency_conflict', 409)
        return existing.result
    check_baseline(site, 'preview', expected_revision, expected_source_fingerprint)
    variants = process_image(raw)
    keys = publish_images(request.user.pk, variants)
    try:
        with transaction.atomic():
            capture, site = preview.attachment_context(request, capture_id)
            preview.source_metadata(request, site)
            repeated = PreviewReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
            if repeated:
                if repeated.content_fingerprint != fingerprint:
                    raise ApiError('同一素材编号对应了不同内容', 'idempotency_conflict', 409)
                _remove_media(keys.values())
                return repeated.result
            check_baseline(site, 'preview', expected_revision, expected_source_fingerprint)
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
            updated = Site.objects.filter(pk=site.pk, owner=request.user, version=site.version).update(
                version=site.version + 1, updated_at=timezone.now())
            if not updated:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            result = _result(asset, site.version + 1, site_source_fingerprint(site))
            PreviewReceipt.objects.create(owner=request.user, capture=capture, site=site, asset=asset,
                client_asset_id=client_asset_id, content_fingerprint=fingerprint, result=result,
                expires_at=timezone.now() + timedelta(days=30))
    except Exception:
        _remove_media(keys.values())
        raise
    return result


@csrf_exempt
@api(['POST'], bearer=True, rate=60)
def icon_upload(request, capture_id):
    client_asset_id = text(request.POST.get('clientAssetId', ''), 128, True)
    expected_revision, expected_source_fingerprint = _baseline_fields(request)
    capture, site = icons.icon_context(request, capture_id)
    upload_file = request.FILES.get('file')
    if not upload_file:
        raise ApiError('请选择图标文件', 'icon_invalid')
    raw = upload_file.read(icons.MAX_ICON_INPUT_BYTES + 1)
    source_url = icons.icon_source(request, site)
    fingerprint = _icon_fingerprint(capture_id, client_asset_id, source_url, raw)
    # 幂等优先：必须在 check_baseline 之前。
    existing = IconReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
    if existing:
        if existing.content_fingerprint != fingerprint:
            raise ApiError('同一素材编号对应了不同内容', 'idempotency_conflict', 409)
        return existing.result
    check_baseline(site, 'icon', expected_revision, expected_source_fingerprint)
    variant = icons.process_icon(raw)
    key = icons.publish_icon(request.user.pk, variant['content'])
    try:
        with transaction.atomic():
            capture, site = icons.icon_context(request, capture_id)
            icons.icon_source(request, site)
            repeated = IconReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
            if repeated:
                if repeated.content_fingerprint != fingerprint:
                    raise ApiError('同一素材编号对应了不同内容', 'idempotency_conflict', 409)
                _remove_media([key])
                return repeated.result
            check_baseline(site, 'icon', expected_revision, expected_source_fingerprint)
            previous = SiteIconAsset.objects.filter(site=site).first()
            old_bytes = previous.bytes if previous else 0
            if icons.icon_quota_used(request.user) - old_bytes + len(variant['content']) > settings.ICON_QUOTA_BYTES:
                raise ApiError('账号图标空间已满，请稍后清理或仅保存文字', 'icon_quota_exceeded', 413)
            values = {'storage_key': key, 'mime': 'image/webp', 'width': variant['width'],
                'height': variant['height'], 'bytes': len(variant['content']), 'source_url': source_url,
                'revision': uuid.uuid4(), 'source_fingerprint': source_url_fingerprint(source_url)}
            if previous:
                for field, value in values.items():
                    setattr(previous, field, value)
                previous.save()
                asset = previous
            else:
                asset = SiteIconAsset.objects.create(owner=request.user, site=site, **values)
            updated = Site.objects.filter(pk=site.pk, owner=request.user, version=site.version).update(
                version=site.version + 1, updated_at=timezone.now())
            if not updated:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            result = _result(asset, site.version + 1, site_source_fingerprint(site))
            IconReceipt.objects.create(owner=request.user, capture=capture, site=site, asset=asset,
                client_asset_id=client_asset_id, content_fingerprint=fingerprint, result=result,
                expires_at=timezone.now() + timedelta(days=30))
    except Exception:
        _remove_media([key])
        raise
    return result
