"""协议 2：显式字段更新、请求指纹和受回执约束的附件许可。"""
import hashlib
import json

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from workspace.asset_baseline import baseline_dto
from workspace.http import ApiError, api, body
from workspace.library import save_site
from workspace.models import CaptureReceipt, Category, Collection, Endpoint
from workspace.validation import safe_url, string_list, text

UPDATE_FIELDS = {'name', 'description', 'purpose', 'category', 'tags', 'collections', 'pinned',
                 'homepage', 'preview', 'icon'}
INPUT_FIELDS = {'clientCaptureId', 'url', 'title', 'description', 'descriptionSource', 'purpose', 'notes',
                'category', 'tags', 'collectionIds', 'pinned', 'later', 'homepageUrl', 'scope',
                'updateFields', 'expectedVersion', 'updateExisting', 'appendNotes', 'autoIcon'}


def fingerprint(data):
    content = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(content.encode()).hexdigest()


def summary(site):
    from workspace.icon_jobs import icon_job_dto
    return {'id': str(site.pk), 'name': site.payload['name'], 'version': site.version,
            'category': site.payload.get('category', ''), 'inbox': site.payload.get('inbox', False),
            'previewBaseline': baseline_dto(site, 'preview'),
            'iconBaseline': baseline_dto(site, 'icon'),
            'iconJob': icon_job_dto(site)}


def store_receipt(user, device, capture_id, site, request_fingerprint, result, can_attach, can_attach_icon=False):
    CaptureReceipt.objects.create(owner=user, device=device, client_capture_id=capture_id, site=site,
        request_fingerprint=request_fingerprint, result=result, can_attach_preview=can_attach,
        can_attach_icon=can_attach_icon)


def validate_relations(user, category, collection_ids):
    try:
        valid_category = not category or Category.objects.filter(owner=user, name=category).exists()
        valid_collections = (Collection.objects.filter(owner=user, pk__in=collection_ids).count()
                             == len(collection_ids))
    except (ValidationError, ValueError):
        valid_collections = False
    if not valid_category or not valid_collections:
        raise ApiError('分类或工作集已删除，请移除失效关联后重试', 'relation_unavailable', 400)


def save_capture(user, changes, site=None, source='manual'):
    try:
        return save_site(user, changes, site, description_source=source)
    except ApiError as error:
        if '分类' in error.message or '工作集' in error.message:
            raise ApiError('分类或工作集已删除，请移除失效关联后重试', 'relation_unavailable', 400)
        raise


def capture_result(site, duplicate, outcome, accepted, can_attach, can_attach_icon=False):
    return {'site': summary(site), 'duplicate': duplicate, 'outcome': outcome,
            'acceptedFields': accepted, 'canAttachPreview': can_attach, 'canAttachIcon': can_attach_icon}


def _maybe_enqueue_icon_job(request, site, capture_id, auto_icon):
    """只入队、不抓取：在 captures() 已持有的事务内调用，HTTP 立即返回。"""
    from workspace.icon_jobs import enqueue_icon_job
    return enqueue_icon_job(request.user, site, capture_id, auto_icon)


@csrf_exempt
@api(['POST'], bearer=True, rate=120)
def captures(request):
    data = body(request)
    if set(data) - INPUT_FIELDS:
        raise ApiError('收藏请求包含未支持字段')
    auto_icon = data.get('autoIcon', True)
    if not isinstance(auto_icon, bool):
        raise ApiError('自动图标选项格式不正确')
    capture_id = text(data.get('clientCaptureId', ''), 128, True)
    request_fingerprint = fingerprint(data)
    with transaction.atomic():
        receipt = CaptureReceipt.objects.select_related('site').filter(
            owner=request.user, client_capture_id=capture_id).first()
        if receipt:
            if receipt.request_fingerprint != request_fingerprint:
                raise ApiError('同一收藏编号对应了不同内容，请生成新修订', 'idempotency_conflict', 409)
            if not receipt.site:
                raise ApiError('该收藏已处理且网站已删除', 'capture_gone', 410)
            return receipt.result
        if request.device.protocol_version < 2:
            raise ApiError('服务器需要协议 2，请下载并重新加载新扩展；队列已保留',
                           'extension_upgrade_required', 426)
        url = safe_url(data.get('url', ''))
        title = text(data.get('title', ''), 100, True)
        description = data.get('description', '')
        purpose = text(data.get('purpose', ''), 1000)
        notes = text(data.get('notes', ''), 2000)
        append_notes = data.get('appendNotes', False)
        if not isinstance(append_notes, bool):
            raise ApiError('追加备注选项格式不正确')
        category = text(data.get('category', ''), 100)
        tags = string_list(data.get('tags', []))
        collection_ids = string_list(data.get('collectionIds', []), maximum=30, limit=100)
        pinned, later = data.get('pinned', False), data.get('later', False)
        if not isinstance(pinned, bool) or not isinstance(later, bool):
            raise ApiError('置顶或稍后整理选项格式不正确')
        homepage = safe_url(data['homepageUrl']) if data.get('homepageUrl') else ''
        source = data.get('descriptionSource', 'manual')
        if source not in {'manual', 'page_meta'}:
            raise ApiError('简介来源不受支持')
        endpoint = Endpoint.objects.select_related('site').filter(owner=request.user, url=url).first()
        if endpoint and (endpoint.site.payload.get('deleted') or endpoint.site.payload.get('archived')):
            outcome = 'trashed' if endpoint.site.payload.get('deleted') else 'archived'
            result = capture_result(endpoint.site, True, outcome, [], False)
            store_receipt(request.user, request.device, capture_id, endpoint.site,
                          request_fingerprint, result, False)
            return result
        fields = string_list(data.get('updateFields', []), maximum=20, limit=30)
        if set(fields) - UPDATE_FIELDS:
            raise ApiError('更新字段不在允许范围内')
        if endpoint and not fields and not append_notes:
            _maybe_enqueue_icon_job(request, endpoint.site, capture_id, auto_icon)
            result = capture_result(endpoint.site, True, 'existing', [], False)
            store_receipt(request.user, request.device, capture_id, endpoint.site,
                          request_fingerprint, result, False)
            return result
        validate_relations(request.user, category, collection_ids)
        if endpoint:
            if type(data.get('expectedVersion')) is not int:
                raise ApiError('更新已有收藏需要 expectedVersion', 'version_conflict', 409)
            changes = {'version': data['expectedVersion']}
            if 'homepage' in fields and not homepage:
                raise ApiError('请填写并明确确认首页地址', 'homepage_confirmation_required', 400)
            mapping = {'name': title, 'description': description, 'purpose': purpose,
                       'category': category, 'tags': tags, 'collections': collection_ids, 'pinned': pinned,
                       'homepage': homepage}
            for key in set(fields) - {'preview', 'icon'}:
                changes['homepageUrl' if key == 'homepage' else key] = mapping[key]
            if append_notes:
                if not notes:
                    raise ApiError('请先填写要追加的备注', 'notes_empty', 400)
                previous = endpoint.site.payload.get('notes', '')
                addition = f'[{timezone.localtime().strftime("%Y-%m-%d %H:%M")}]\n{notes}'
                combined = f'{previous}\n\n{addition}' if previous else addition
                if len(combined) > 10000:
                    raise ApiError('追加后会超过备注总长度限制，请在工作台整理后再试', 'notes_too_long', 400)
                changes['notes'] = combined
            if set(changes) - {'version'}:
                site = save_capture(request.user, changes, endpoint.site, source)
            else:
                if data['expectedVersion'] != endpoint.site.version:
                    raise ApiError('资料已更新，请刷新对比后重试', 'version_conflict', 409)
                site = endpoint.site
            accepted = list(fields) + (['notes'] if append_notes else [])
            _maybe_enqueue_icon_job(request, site, capture_id, auto_icon)
            result = capture_result(site, True, 'updated', accepted, 'preview' in fields, 'icon' in fields)
            store_receipt(request.user, request.device, capture_id, site,
                          request_fingerprint, result, 'preview' in fields, 'icon' in fields)
            return result
        scope = text(data.get('scope', '公网'), 100)
        site = save_capture(request.user, {'name': title, 'description': description, 'purpose': purpose,
            'notes': notes, 'category': category, 'tags': tags, 'collections': collection_ids, 'pinned': pinned,
            'homepageUrl': homepage, 'inbox': later,
            'endpoints': [{'url': url, 'label': '默认入口', 'scope': scope}]}, source=source)
        accepted = ['name', 'description', 'purpose', 'notes', 'category', 'tags', 'collections', 'pinned']
        _maybe_enqueue_icon_job(request, site, capture_id, auto_icon)
        result = capture_result(site, False, 'created', accepted, True, True)
        store_receipt(request.user, request.device, capture_id, site,
                      request_fingerprint, result, True, True)
        request.device.last_active_at = timezone.now()
        request.device.save(update_fields=['last_active_at'])
        return result
