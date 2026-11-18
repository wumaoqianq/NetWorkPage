"""主动刷新与后台监控共用受限抓取；缓存和存档不修改个人网站字段。"""
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from workspace.http import api, body, owned, ApiError
from workspace.library import save_site, site_dto
from workspace.models import Site
from enhancements.models import Metadata, Archive, Monitor
from enhancements.safe_fetch import fetch, FetchError


def active_site(user, pk):
    site = owned(Site, user, pk)
    if site.payload.get('deleted') or site.payload.get('archived'):
        raise ApiError('请先恢复网站资料', 'not_found', 404)
    return site


def endpoint(site, endpoint_id=None):
    entries = site.payload.get('endpoints', [])
    endpoint_id = endpoint_id or site.payload.get('defaultEndpointId')
    entry = next((e for e in entries if e.get('id') == endpoint_id), None) if endpoint_id else next(iter(entries), None)
    if entry is None:
        raise ApiError('入口不存在')
    return entry


def refresh(site, entry, archive=False):
    cached = Metadata.objects.filter(owner=site.owner, site=site).first()
    fresh = cached and cached.checked_at > timezone.now() - timedelta(minutes=1)
    fresh = fresh and cached.result.get('requestedUrl') == entry['url']
    if fresh:
        result = cached.result
    else:
        try:
            if entry.get('scope', '公网') != '公网':
                raise FetchError('内部入口暂不支持服务器检查', 'unsupported')
            result = fetch(entry['url'])
        except FetchError as exc:
            result = {'title': '', 'description': '', 'text': '', 'url': entry['url'],
                'checkedAt': timezone.now().isoformat(), 'source': 'server', 'httpStatus': None,
                'status': 'unsupported' if exc.code == 'unsupported' else 'error', 'error': exc.message}
        result = {**result, 'endpointId': entry['id'], 'requestedUrl': entry['url']}
        Metadata.objects.update_or_create(site=site, defaults={'owner': site.owner, 'result': result,
            'checked_at': parse_datetime(result['checkedAt'])})
    if archive and result['status'] == 'available':
        save_archive(site, result)
    return {'metadata': result, 'cached': bool(fresh)}


def save_archive(site, result):
    # 限制每站三份、每份文本 120KiB，为标题、URL 与 JSON 编码留出余量。
    text = result.get('text', '').encode('utf-8')[:120 * 1024].decode('utf-8', errors='ignore')
    with transaction.atomic():
        Archive.objects.create(owner=site.owner, site=site, title=result.get('title', '')[:500],
            url=result['url'][:2048], text=text, checked_at=parse_datetime(result['checkedAt']))
        old = list(Archive.objects.filter(owner=site.owner, site=site).order_by('-pk').values_list('pk', flat=True)[3:])
        Archive.objects.filter(pk__in=old, owner=site.owner).delete()


@api(['GET', 'POST', 'PATCH'], rate=30)
def metadata(request, pk):
    site = active_site(request.user, pk)
    if request.method == 'GET':
        cached = Metadata.objects.filter(owner=request.user, site=site).first()
        return {'metadata': cached.result if cached else None, 'cached': bool(cached)}
    data = body(request)
    if request.method == 'PATCH':
        cached = Metadata.objects.filter(owner=request.user, site=site).first()
        if data.get('adoptDescription') is not True or not cached or not cached.result.get('description'):
            raise ApiError('没有可采用的服务器简介，请先检查并查看预览')
        with transaction.atomic():
            site = save_site(request.user, {'version': data.get('version'),
                'description': cached.result['description']}, site, description_source='server_meta')
        return site_dto(site)
    archive = data.get('archive', False)
    if not isinstance(archive, bool):
        raise ApiError('存档选项必须为布尔值')
    return refresh(site, endpoint(site, data.get('endpointId')), archive)


@api(['GET'])
def archives(request, pk):
    site = active_site(request.user, pk)
    return {'archives': [{'id': a.pk, 'title': a.title, 'url': a.url, 'text': a.text,
                         'checkedAt': a.checked_at.isoformat()}
                        for a in Archive.objects.filter(owner=request.user, site=site).order_by('-pk')[:3]]}


def monitor_dto(monitor):
    return {'enabled': monitor.enabled if monitor else False,
        'intervalHours': monitor.interval_hours if monitor else 24,
        'endpointId': monitor.endpoint_id if monitor else None,
        'nextCheckAt': monitor.next_check_at.isoformat() if monitor and monitor.next_check_at else None}


@api(['GET', 'PUT'])
def monitor(request, pk):
    site = active_site(request.user, pk)
    current = Monitor.objects.filter(owner=request.user, site=site).first()
    if request.method == 'GET':
        return monitor_dto(current)
    data = body(request)
    enabled, hours = data.get('enabled'), data.get('intervalHours', 24)
    if not isinstance(enabled, bool) or type(hours) is not int or not 6 <= hours <= 720:
        raise ApiError('监控开关必须明确；间隔为 6 至 720 小时')
    entry = endpoint(site, data.get('endpointId'))
    current, _ = Monitor.objects.update_or_create(owner=request.user, site=site,
        defaults={'enabled': enabled, 'interval_hours': hours, 'endpoint_id': entry['id'],
                  'next_check_at': timezone.now() if enabled else None})
    return monitor_dto(current)
