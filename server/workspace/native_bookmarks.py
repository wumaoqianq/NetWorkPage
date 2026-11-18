"""设备只能新增书签；批次回执按用户/UUID/内容指纹绑定，重试不重复写入。"""
import json
import uuid
from datetime import timedelta
from urllib.parse import urlsplit
from ipaddress import ip_address
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from workspace.http import api, body, ApiError, digest
from workspace.validation import text, normalized_site
from workspace.models import ImportJob, Endpoint
from workspace.library import save_site


def scope_for(url):
    host = urlsplit(url).hostname
    if host == 'localhost':
        return '本机'
    try:
        address = ip_address(host)
        return '本机' if address.is_loopback else '局域网' if address.is_private else '公网'
    except ValueError:
        return '局域网' if host.endswith('.local') else '公网'


def bookmark_sites(items, user):
    if not isinstance(items, list) or not 1 <= len(items) <= 500:
        raise ApiError('每批需要 1 至 500 个书签')
    sites = []
    for item in items:
        if not isinstance(item, dict) or set(item) - {'title', 'url', 'folder'}:
            raise ApiError('书签批次只接受标题、网址和文件夹，不接受账号或私人资料字段')
        url = text(item.get('url', ''), 2048, True)
        folder = text(item.get('folder', ''), 2000)
        name = text(item.get('title', ''), 100) or url[:100]
        site = normalized_site({'name': name, 'notes': '导入文件夹：' + folder if folder else '',
            'inbox': True, 'endpoints': [{'id': 'bookmark', 'url': url}]}, user, check_relations=False)
        site['endpoints'][0]['scope'] = scope_for(site['endpoints'][0]['url'])
        sites.append(site)
    return sites


@csrf_exempt
@api(['POST'], bearer=True, rate=60)
def import_batch(request):
    data = body(request)
    try:
        batch_id = uuid.UUID(str(data.get('batchId', '')))
    except (ValueError, TypeError):
        raise ApiError('书签批次编号不正确')
    sites = bookmark_sites(data.get('items'), request.user)
    fingerprint = digest(json.dumps(data['items'], ensure_ascii=False, sort_keys=True))
    # IMMEDIATE 事务同时保护回执与整批新增，响应丢失后用相同批次重试只读取旧结果。
    with transaction.atomic():
        receipt = ImportJob.objects.filter(pk=batch_id).first()
        if receipt:
            if receipt.owner_id != request.user.pk or receipt.payload.get('kind') != 'native-bookmark-batch':
                raise ApiError('批次不存在', 'not_found', 404)
            if receipt.payload.get('fingerprint') != fingerprint:
                raise ApiError('批次内容已变化，请重新读取收藏', 'batch_conflict', 409)
            return receipt.result
        urls = [item['endpoints'][0]['url'] for item in sites]
        existing = set(Endpoint.objects.filter(owner=request.user, url__in=urls).values_list('url', flat=True))
        imported, skipped = 0, 0
        for site in sites:
            url = site['endpoints'][0]['url']
            if url in existing:
                skipped += 1
                continue
            save_site(request.user, site)
            existing.add(url)
            imported += 1
        result = {'batchId': str(batch_id), 'ownerId': request.user.pk, 'imported': imported, 'skipped': skipped}
        ImportJob.objects.create(pk=batch_id, owner=request.user,
            payload={'kind': 'native-bookmark-batch', 'fingerprint': fingerprint},
            result=result, expires_at=timezone.now() + timedelta(days=1))
    return result
