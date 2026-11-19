"""网站图标经真实解码后进入账号私有媒体，不代理第三方 favicon 服务。"""
import hashlib
import io
import os
import tempfile
import time
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.http import FileResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from PIL import Image, ImageOps, UnidentifiedImageError

from workspace import favicons
from workspace.asset_baseline import record_tombstone, source_url_fingerprint
from workspace.http import ApiError, api, body, owned
from workspace.media import media_path
from workspace.models import AuditEvent, CaptureReceipt, IconReceipt, Site, SiteIconAsset
from workspace.preview import integer
from workspace.validation import safe_url, text

MAX_ICON_INPUT_BYTES = 200 * 1024
MAX_ICON_BYTES = 32 * 1024
REFRESH_BATCH_LIMIT = 6
REFRESH_BATCH_SECONDS = 20


def process_icon(raw):
    if len(raw) > MAX_ICON_INPUT_BYTES:
        raise ApiError('图标输入不能超过 200KiB', 'icon_too_large', 413)
    try:
        probe = Image.open(io.BytesIO(raw))
        if probe.format not in {'PNG', 'WEBP'} or probe.width * probe.height > 2_000_000:
            raise ValueError()
        probe.verify()
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert('RGBA')
        image.thumbnail((128, 128), Image.Resampling.LANCZOS)
        for quality in (85, 75, 65, 55, 45):
            output = io.BytesIO()
            image.save(output, 'WEBP', quality=quality, method=4)
            if output.tell() <= MAX_ICON_BYTES:
                return {'content': output.getvalue(), 'width': image.width, 'height': image.height}
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError):
        pass
    raise ApiError('图标损坏或格式不受支持，仅接受 PNG/WebP', 'icon_invalid', 400)


def icon_quota_used(user):
    return SiteIconAsset.objects.filter(owner=user).aggregate(total=Sum('bytes', default=0))['total']


def publish_icon(owner_id, content):
    root = Path(settings.MEDIA_ROOT)
    temporary_root = root / '.tmp'
    temporary_root.mkdir(parents=True, exist_ok=True)
    key = f'{owner_id}/{uuid.uuid4().hex}-icon.webp'
    try:
        with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
            candidate = Path(temporary) / 'icon.webp'
            candidate.write_bytes(content)
            target = media_path(root, key)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(candidate, target)
        return key
    except OSError:
        media_path(root, key).unlink(missing_ok=True)
        raise ApiError('图标暂时无法保存，请稍后重试', 'icon_publish_failed', 503)


def icon_context(request, capture_id, expected_version=None):
    capture = CaptureReceipt.objects.select_related('site').filter(
        owner=request.user, client_capture_id=capture_id).first()
    if not capture or not capture.site or not capture.can_attach_icon:
        raise ApiError('此收藏回执没有上传图标的许可，请重新确认', 'forbidden', 403)
    site = capture.site
    if site.payload.get('deleted') or site.payload.get('archived'):
        raise ApiError('网站已删除或归档，请在工作台复核', 'preview_source_changed', 409)
    if expected_version is not None and site.version != expected_version:
        raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
    return capture, site


def icon_source(request, site):
    source_url = safe_url(request.POST.get('sourceUrl', ''))
    if source_url not in {entry['url'] for entry in site.payload.get('endpoints', [])}:
        raise ApiError('图标来源地址已变化，请重新收藏或复核', 'preview_source_changed', 409)
    return source_url


@csrf_exempt
@api(['POST'], bearer=True, rate=60)
def upload(request, capture_id):
    client_asset_id = text(request.POST.get('clientAssetId', ''), 128, True)
    expected_version = integer(request.POST.get('expectedVersion'), 'expectedVersion')
    capture, site = icon_context(request, capture_id)
    upload_file = request.FILES.get('file')
    if not upload_file:
        raise ApiError('请选择图标文件', 'icon_invalid')
    raw = upload_file.read(MAX_ICON_INPUT_BYTES + 1)
    source_url = icon_source(request, site)
    fingerprint = hashlib.sha256(b'\n'.join((capture_id.encode(), client_asset_id.encode(),
        source_url.encode(), raw))).hexdigest()
    existing = IconReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
    if existing:
        if existing.content_fingerprint != fingerprint:
            raise ApiError('同一图标编号对应了不同内容', 'idempotency_conflict', 409)
        return existing.result
    variant = process_icon(raw)
    key = publish_icon(request.user.pk, variant['content'])
    with transaction.atomic():
        capture, site = icon_context(request, capture_id, expected_version)
        icon_source(request, site)
        repeated = IconReceipt.objects.filter(owner=request.user, client_asset_id=client_asset_id).first()
        if repeated:
            if repeated.content_fingerprint != fingerprint:
                raise ApiError('同一图标编号对应了不同内容', 'idempotency_conflict', 409)
            return repeated.result
        previous = SiteIconAsset.objects.filter(site=site).first()
        old_bytes = previous.bytes if previous else 0
        if icon_quota_used(request.user) - old_bytes + len(variant['content']) > settings.ICON_QUOTA_BYTES:
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
        updated = Site.objects.filter(pk=site.pk, owner=request.user, version=expected_version).update(
            version=expected_version + 1, updated_at=timezone.now())
        if not updated:
            raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
        result = {'assetId': str(asset.pk), 'siteVersion': expected_version + 1,
                  'status': 'complete', 'revision': str(asset.revision)}
        IconReceipt.objects.create(owner=request.user, capture=capture, site=site, asset=asset,
            client_asset_id=client_asset_id, content_fingerprint=fingerprint, result=result,
            expires_at=timezone.now() + timedelta(days=30))
    return result


def refresh_unavailable():
    return ApiError('网站已删除或归档，请在工作台复核', 'icon_refresh_unavailable', 409)


def refresh_failure(site, exc):
    return {'id': str(site.pk), 'name': site.payload.get('name', ''),
            'code': exc.code, 'reason': exc.message}


def store_refreshed_icon(user, site_id, variant, expected_version=None):
    """把已重编码的图标落到私有媒体；版本与配额在事务内重新确认，失败不留文件。"""
    content = variant['content']
    key = publish_icon(user.pk, content)
    try:
        with transaction.atomic():
            site = Site.objects.filter(owner=user, pk=site_id).first()
            if site is None:
                raise ApiError('资料不存在', 'not_found', 404)
            if site.payload.get('deleted') or site.payload.get('archived'):
                raise refresh_unavailable()
            if expected_version is not None and site.version != expected_version:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            expected = site.version if expected_version is None else expected_version
            previous = SiteIconAsset.objects.filter(site=site).first()
            old_bytes = previous.bytes if previous else 0
            if icon_quota_used(user) - old_bytes + len(content) > settings.ICON_QUOTA_BYTES:
                raise ApiError('账号图标空间已满，请稍后清理或仅保存文字', 'icon_quota_exceeded', 413)
            values = {'storage_key': key, 'mime': 'image/webp', 'width': variant['width'],
                'height': variant['height'], 'bytes': len(content), 'source_url': variant['source_url'],
                'revision': uuid.uuid4(),
                'source_fingerprint': source_url_fingerprint(variant['source_url'])}
            if previous:
                for field, value in values.items():
                    setattr(previous, field, value)
                previous.save()
                asset = previous
            else:
                asset = SiteIconAsset.objects.create(owner=user, site=site, **values)
            updated = Site.objects.filter(pk=site.pk, owner=user, version=expected).update(
                version=expected + 1, updated_at=timezone.now())
            if not updated:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            AuditEvent.objects.create(event='icon_refreshed', actor_id=user.pk)
        return {'assetId': str(asset.pk), 'siteVersion': expected + 1, 'status': 'complete',
                'revision': str(asset.revision), 'mime': asset.mime, 'width': asset.width,
                'height': asset.height, 'bytes': asset.bytes,
                'url': f'/api/sites/{asset.site_id}/icon?rev={asset.revision}',
                'sourceUrl': asset.source_url, 'sourceHost': variant['source_host'],
                'sourceType': variant['source_type'], 'frame': variant['frame']}
    except Exception:
        media_path(Path(settings.MEDIA_ROOT), key).unlink(missing_ok=True)
        raise


@api(['POST'], rate=20)
def refresh(request, pk):
    """公开站点主动刷新：先做公网校验与抓取，再在事务里落库并 bump 版本。"""
    site = owned(Site, request.user, pk)
    data = body(request)
    expected = data.get('version')
    if 'version' in data and (not isinstance(expected, int) or isinstance(expected, bool) or expected < 1):
        raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
    if site.payload.get('deleted') or site.payload.get('archived'):
        raise refresh_unavailable()
    if expected is not None and site.version != expected:
        raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
    try:
        endpoint = favicons.public_endpoint(site.payload)
        variant = favicons.fetch_icon(endpoint['url'])
    except favicons.FaviconError as exc:
        raise ApiError(exc.message, exc.code, exc.status)
    return store_refreshed_icon(request.user, site.pk, variant, expected)


def fallback_capture(request, capture_id):
    """自动兜底只认当前设备（Bearer）账号的收藏回执；无回执时客户端应等队列同步后重试。"""
    capture = CaptureReceipt.objects.select_related('site').filter(
        owner=request.user, client_capture_id=capture_id).first()
    if capture is None or capture.site is None:
        raise ApiError('收藏回执尚未同步，请稍后重试', 'capture_not_found', 404)
    if not capture.can_attach_icon:
        raise ApiError('此收藏回执没有上传图标的许可，请重新确认', 'forbidden', 403)
    site = capture.site
    if site.payload.get('deleted') or site.payload.get('archived'):
        raise refresh_unavailable()
    return capture, site


def icon_exists_result(site):
    return {'status': 'icon_exists', 'siteVersion': site.version}


def fallback_result(asset, site_version, variant):
    return {'assetId': str(asset.pk), 'siteVersion': site_version, 'status': 'complete',
            'revision': str(asset.revision), 'mime': asset.mime, 'width': asset.width,
            'height': asset.height, 'bytes': asset.bytes,
            'url': f'/api/sites/{asset.site_id}/icon?rev={asset.revision}',
            'sourceUrl': asset.source_url, 'sourceHost': variant['source_host'],
            'sourceType': variant['source_type'], 'frame': variant['frame'],
            'diagnostics': variant.get('diagnostics', [])}


def store_fallback_icon(user, site_id, variant, expected_version):
    """条件创建自动兜底图标：已有图标绝不覆盖；版本/配额在事务内复核，失败不留文件。"""
    content = variant['content']
    key = publish_icon(user.pk, content)
    try:
        with transaction.atomic():
            site = Site.objects.filter(owner=user, pk=site_id).first()
            if site is None:
                raise ApiError('资料不存在', 'not_found', 404)
            if site.payload.get('deleted') or site.payload.get('archived'):
                raise refresh_unavailable()
            if SiteIconAsset.objects.filter(site=site).exists():
                # 抓取期间已有图标（自定义或并发兜底）：保留现有图标，不覆盖。
                media_path(Path(settings.MEDIA_ROOT), key).unlink(missing_ok=True)
                return icon_exists_result(site)
            if site.version != expected_version:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            if icon_quota_used(user) + len(content) > settings.ICON_QUOTA_BYTES:
                raise ApiError('账号图标空间已满，请稍后清理或仅保存文字', 'icon_quota_exceeded', 413)
            try:
                with transaction.atomic():
                    updated = Site.objects.filter(pk=site.pk, owner=user,
                        version=expected_version).update(version=expected_version + 1,
                                                         updated_at=timezone.now())
                    if not updated:
                        raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
                    asset = SiteIconAsset.objects.create(owner=user, site=site, storage_key=key,
                        mime='image/webp', width=variant['width'], height=variant['height'],
                        bytes=len(content), source_url=variant['source_url'], revision=uuid.uuid4(),
                        source_fingerprint=source_url_fingerprint(variant['source_url']))
            except IntegrityError:
                # 唯一约束说明另一个并发写入已创建图标：savepoint 已回滚版本，重查后返回 icon_exists。
                media_path(Path(settings.MEDIA_ROOT), key).unlink(missing_ok=True)
                repeat = SiteIconAsset.objects.filter(site=site).first()
                if repeat is None:
                    raise
                return icon_exists_result(Site.objects.get(pk=site.pk))
            AuditEvent.objects.create(event='icon_fallback_filled', actor_id=user.pk)
            return fallback_result(asset, expected_version + 1, variant)
    except Exception:
        media_path(Path(settings.MEDIA_ROOT), key).unlink(missing_ok=True)
        raise


@csrf_exempt
@api(['POST'], bearer=True, rate=60)
def fallback(request, capture_id):
    """设备 Bearer 自动图标兜底：只抓回执所属站点声明/默认候选，已有图标不覆盖。"""
    capture, site = fallback_capture(request, capture_id)
    if SiteIconAsset.objects.filter(site=site).exists():
        return icon_exists_result(site)
    if not favicons.has_public_candidate(site.payload):
        raise ApiError(favicons.PRIVATE_MESSAGE, 'icon_refresh_private', 400)
    deadline = time.monotonic() + favicons.TOTAL_SECONDS
    try:
        endpoint = favicons.public_endpoint(
            site.payload, deadline=min(deadline, time.monotonic() + favicons.REQUEST_SECONDS))
        variant = favicons.fetch_icon(endpoint['url'], deadline=deadline)
    except favicons.FaviconError as exc:
        raise ApiError(exc.message, exc.code, exc.status)
    return store_fallback_icon(request.user, site.pk, variant, site.version)


@api(['POST'], rate=3)
def refresh_missing(request):
    """同步、限量地补齐当前账号缺图站点；单个失败不影响其他站点，不做后台常驻任务。"""
    data = body(request)
    limit = data.get('limit', REFRESH_BATCH_LIMIT)
    if not isinstance(limit, int) or isinstance(limit, bool):
        raise ApiError('limit 必须是整数')
    limit = max(1, min(REFRESH_BATCH_LIMIT, limit))
    deadline = time.monotonic() + REFRESH_BATCH_SECONDS
    missing_sites = Site.objects.filter(owner=request.user, site_icon_asset__isnull=True).exclude(
        payload__deleted=True).exclude(payload__archived=True).order_by('created_at', 'id')
    missing = missing_sites.count()
    checked = updated = skipped = 0
    failed = []
    for site in missing_sites.only('id', 'payload', 'version').iterator(chunk_size=50):
        if checked >= limit or time.monotonic() >= deadline:
            break
        if not favicons.has_public_candidate(site.payload):
            skipped += 1
            continue
        try:
            endpoint = favicons.public_endpoint(
                site.payload, deadline=min(deadline, time.monotonic() + favicons.REQUEST_SECONDS))
        except favicons.FaviconError as exc:
            if exc.code == 'icon_refresh_private':
                skipped += 1
                continue
            checked += 1
            failed.append(refresh_failure(site, exc))
            continue
        checked += 1
        try:
            variant = favicons.fetch_icon(
                endpoint['url'], deadline=min(deadline, time.monotonic() + favicons.TOTAL_SECONDS))
            store_refreshed_icon(request.user, site.pk, variant)
            updated += 1
        except favicons.FaviconError as exc:
            failed.append(refresh_failure(site, exc))
        except ApiError as exc:
            failed.append(refresh_failure(site, exc))
    return {'missing': missing, 'checked': checked, 'updated': updated,
            'skippedPrivate': skipped, 'failed': failed, 'limit': limit}


@api(['GET', 'DELETE'], rate=180)
def image(request, pk):
    site = owned(Site, request.user, pk)
    if request.method == 'DELETE':
        data = body(request)
        with transaction.atomic():
            site = owned(Site, request.user, pk)
            if data.get('version') != site.version:
                raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
            asset = getattr(site, 'site_icon_asset', None)
            if not asset:
                return {'removed': True, 'siteVersion': site.version}
            updated = Site.objects.filter(pk=site.pk, owner=request.user, version=site.version).update(
                version=site.version + 1, updated_at=timezone.now())
            if not updated:
                raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
            record_tombstone(request.user, site, 'icon', str(asset.revision))
            asset.delete()
        return {'removed': True, 'siteVersion': site.version + 1}
    asset = getattr(site, 'site_icon_asset', None)
    if not asset or (request.GET.get('rev') and request.GET['rev'] != str(asset.revision)):
        raise ApiError('网站图标不存在', 'not_found', 404)
    path = media_path(Path(settings.MEDIA_ROOT), asset.storage_key)
    if not path.is_file() or path.is_symlink():
        raise ApiError('图标文件暂不可用', 'icon_missing', 404)
    response = FileResponse(path.open('rb'), content_type='image/webp')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Disposition'] = 'inline'
    return response


@api(['POST'], rate=10)
def refetch(request, pk):
    """「重新获取」例外入口：只把终态图标 Job 重新排队，不覆盖已有图标、不改 site.version。"""
    from workspace.icon_jobs import requeue_icon_job, icon_job_dto
    site = owned(Site, request.user, pk)
    requeue_icon_job(request.user, site)
    return {'queued': True, 'iconJob': icon_job_dto(site)}


@api(['POST'], rate=20)
def upload_local(request, pk):
    """高级本地上传：用户明确动作可替换已有图标；媒体发布在事务外，失败删已发布文件。

    这是用户主动上传，source_url 用稳定哨兵 'local-upload' 而非冒充站点 URL。
    与服务端自动 Job 相反：本端点允许覆盖已有图标。
    """
    site = owned(Site, request.user, pk)
    raw_version = request.POST.get('version')
    if raw_version is None:
        raw_version = request.GET.get('version')
    expected = None
    if raw_version not in (None, ''):
        try:
            expected = int(raw_version)
        except (ValueError, TypeError):
            raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
        if expected < 1:
            raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
    if site.payload.get('deleted') or site.payload.get('archived'):
        raise refresh_unavailable()
    if expected is not None and site.version != expected:
        raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
    upload_file = request.FILES.get('file')
    if not upload_file:
        raise ApiError('请选择图标文件', 'icon_invalid')
    raw = upload_file.read(MAX_ICON_INPUT_BYTES + 1)
    variant = process_icon(raw)
    variant.update({'source_url': 'local-upload', 'source_host': '',
                    'source_type': 'local', 'frame': None, 'diagnostics': []})
    content = variant['content']
    key = None
    try:
        key = publish_icon(request.user.pk, content)
        with transaction.atomic():
            fresh = Site.objects.filter(owner=request.user, pk=pk).first()
            if fresh is None:
                raise ApiError('资料不存在', 'not_found', 404)
            if fresh.payload.get('deleted') or fresh.payload.get('archived'):
                raise refresh_unavailable()
            if expected is not None and fresh.version != expected:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            previous = SiteIconAsset.objects.filter(site=fresh).first()
            old_bytes = previous.bytes if previous else 0
            if icon_quota_used(request.user) - old_bytes + len(content) > settings.ICON_QUOTA_BYTES:
                raise ApiError('账号图标空间已满，请稍后清理或仅保存文字', 'icon_quota_exceeded', 413)
            base = fresh.version
            values = {'storage_key': key, 'mime': 'image/webp', 'width': variant['width'],
                'height': variant['height'], 'bytes': len(content), 'source_url': 'local-upload',
                'revision': uuid.uuid4(), 'source_fingerprint': source_url_fingerprint('local-upload')}
            if previous:
                for field, value in values.items():
                    setattr(previous, field, value)
                previous.save()
                asset = previous
            else:
                asset = SiteIconAsset.objects.create(owner=request.user, site=fresh, **values)
            updated = Site.objects.filter(pk=fresh.pk, owner=request.user, version=base).update(
                version=base + 1, updated_at=timezone.now())
            if not updated:
                raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
            AuditEvent.objects.create(event='icon_local_uploaded', actor_id=request.user.pk)
            return {'assetId': str(asset.pk), 'siteVersion': base + 1, 'status': 'complete',
                'revision': str(asset.revision), 'mime': asset.mime, 'width': asset.width,
                'height': asset.height, 'bytes': asset.bytes,
                'url': f'/api/sites/{asset.site_id}/icon?rev={asset.revision}',
                'sourceUrl': asset.source_url, 'sourceHost': '', 'sourceType': 'local', 'frame': None}
    except Exception:
        if key is not None:
            media_path(Path(settings.MEDIA_ROOT), key).unlink(missing_ok=True)
        raise
