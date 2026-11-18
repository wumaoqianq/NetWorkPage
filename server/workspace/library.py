"""网站写操作和 URL 唯一索引始终放在同一事务内。"""
from django.conf import settings
from django.db import transaction
from django.db.models import F, Count, Max, Sum
from django.utils import timezone
from workspace.models import Site, Endpoint, Category, Collection, Visit, UserWorkspace
from workspace.http import api, body, owned, ApiError, user_dto
from workspace.validation import normalized_site


def preview_dto(asset):
    if not asset:
        return {'present': False}
    return {'present': True, 'revision': str(asset.revision), 'pageKind': asset.page_kind,
            'capturedAt': asset.captured_at.isoformat(), 'createdAt': asset.created_at.isoformat(),
            'userConfirmedHomepage': asset.user_confirmed_homepage, 'stale': asset.stale,
            'sourceEndpointId': asset.source_endpoint_id, 'sourceUrl': asset.source_url,
            'homepageUrl': asset.homepage_url, 'width': asset.width, 'height': asset.height,
            'thumbUrl': f'/api/sites/{asset.site_id}/preview/image?size=thumb&rev={asset.revision}',
            'fullUrl': f'/api/sites/{asset.site_id}/preview/image?size=full&rev={asset.revision}'}


def defaults(user):
    with transaction.atomic():
        _, created = UserWorkspace.objects.get_or_create(owner=user)
        if created:
            Category.objects.bulk_create([Category(owner=user, name=name) for name in ['图片与视频', '开发工具', '办公协作']])
            Collection.objects.bulk_create([Collection(owner=user, name=name) for name in ['开发与发布', '图片与素材']])


def icon_dto(asset):
    if not asset:
        return {'present': False}
    return {'present': True, 'revision': str(asset.revision),
            'url': f'/api/sites/{asset.site_id}/icon?rev={asset.revision}'}


def site_dto(site):
    from workspace.icon_jobs import icon_job_dto
    preview = getattr(site, 'preview_asset', None)
    icon = getattr(site, 'site_icon_asset', None)
    return {**site.payload, 'id': str(site.pk), 'version': site.version,
            'createdAt': site.created_at.isoformat(), 'updatedAt': site.updated_at.isoformat(),
            'presentation': {'preview': preview_dto(preview), 'icon': icon_dto(icon)},
            'iconJob': icon_job_dto(site)}


def workspace_revision(user):
    values = Site.objects.filter(owner=user).aggregate(count=Count('id'), latest=Max('updated_at'),
                                                       versions=Sum('version', default=0))
    latest = values['latest'].isoformat() if values['latest'] else ''
    return f"{values['count']}:{values['versions']}:{latest}"


def collection_dto(collection):
    return {'id': str(collection.pk), 'name': collection.name, 'description': collection.description}


def site_page(user, page=1, limit=250):
    # 每次只展开一页 JSON，避免低内存机器同时序列化整个收藏库。
    query = Site.objects.filter(owner=user).select_related('preview_asset', 'site_icon_asset').order_by('created_at', 'id')
    count = query.count()
    start = (page - 1) * limit
    return {'sites': [site_dto(s) for s in query[start:start + limit]],
            'nextPage': page + 1 if start + limit < count else None,
            'userId': user.pk, 'siteCount': count}


def save_site(user, data, site=None, description_source='manual'):
    defaults(user)
    payload = normalized_site(data, user, site.payload if site else None, description_source=description_source)
    urls = [entry['url'] for entry in payload['endpoints']]
    conflict = Endpoint.objects.filter(owner=user, url__in=urls)
    if site:
        conflict = conflict.exclude(site=site)
    if conflict.exists():
        raise ApiError('该网址已收藏，请编辑已有网站', 'duplicate_url', 409)
    if site is None:
        if Site.objects.filter(owner=user).count() >= settings.MAX_SITES:
            raise ApiError('网站数量已达到上限', 'site_limit', 409)
        site = Site.objects.create(owner=user, payload=payload)
    else:
        if not isinstance(data.get('version'), int) or data['version'] != site.version:
            raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
        updated = Site.objects.filter(pk=site.pk, owner=user, version=data['version']).update(
            payload=payload, version=F('version')+1)
        if not updated:
            raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
        site.refresh_from_db()
        site.save(update_fields=['updated_at'])
    site.url_records.all().delete()
    Endpoint.objects.bulk_create([Endpoint(owner=user, site=site, url=url) for url in urls])
    preview = getattr(site, 'preview_asset', None)
    if preview:
        source = next((entry for entry in payload['endpoints'] if entry['id'] == preview.source_endpoint_id), None)
        stale = not source or source['url'] != preview.source_url
        if preview.stale != stale:
            preview.stale = stale
            preview.save(update_fields=['stale'])
    return site


@api(['GET'])
def workspace(request):
    defaults(request.user)
    recent = Visit.objects.filter(owner=request.user).order_by('-opened_at').values_list('site_id', flat=True)[:50]
    page = site_page(request.user)
    return {'sites': page['sites'], 'siteCount': page['siteCount'], 'nextSitePage': page['nextPage'],
            'collections': [collection_dto(c) for c in Collection.objects.filter(owner=request.user)],
            'categories': list(Category.objects.filter(owner=request.user).values_list('name', flat=True)),
            'recent': list(dict.fromkeys(str(pk) for pk in recent)), 'user': user_dto(request.user),
            'revision': workspace_revision(request.user)}


@api(['GET'], rate=180)
def revision(request):
    return {'revision': workspace_revision(request.user)}


@api(['GET', 'POST'], rate=120)
def sites(request):
    if request.method == 'GET':
        try:
            page = int(request.GET.get('page', 1))
            limit = int(request.GET.get('limit', 250))
        except (ValueError, TypeError):
            raise ApiError('分页参数不正确')
        if not 1 <= page <= settings.MAX_SITES or not 1 <= limit <= 250:
            raise ApiError('每页最多读取 250 个网站，页码必须为正整数')
        return site_page(request.user, page, limit)
    with transaction.atomic():
        return site_dto(save_site(request.user, body(request)))


@api(['GET', 'PATCH', 'DELETE'], rate=180)
def site_detail(request, pk):
    with transaction.atomic():
        site = owned(Site, request.user, pk)
        if request.method == 'GET':
            return site_dto(site)
        data = body(request)
        if request.method == 'DELETE':
            if not site.payload.get('deleted'):
                raise ApiError('请先将网站移入回收站', 'trash_required', 409)
            if data.get('version') != site.version:
                raise ApiError('资料已更新，请刷新后重试', 'version_conflict', 409)
            site.delete()
            return {'deleted': True}
        return site_dto(save_site(request.user, data, site))


@api(['POST'], rate=180)
def visits(request):
    data = body(request)
    site = owned(Site, request.user, data.get('siteId'))
    endpoint = data.get('endpointId')
    if endpoint not in {e['id'] for e in site.payload['endpoints']}:
        raise ApiError('入口不存在')
    Visit.objects.create(owner=request.user, site=site, endpoint_id=endpoint)
    # 最近打开历史有界保留，避免长时间运行持续膨胀。
    old = Visit.objects.filter(owner=request.user).order_by('-opened_at').values_list('pk', flat=True)[500:]
    Visit.objects.filter(pk__in=list(old)).delete()
    return {'siteId': str(site.pk), 'endpointId': endpoint}


@api(['POST'], rate=30)
def complete_inbox(request):
    data = body(request)
    with transaction.atomic():
        sites = list(Site.objects.filter(owner=request.user, payload__inbox=True).order_by('id'))
        if type(data.get('count')) is not int or data['count'] != len(sites):
            raise ApiError('收件箱已变化，请刷新数量后再确认', 'version_conflict', 409)
        for site in sites:
            payload = {**site.payload, 'inbox': False}
            updated = Site.objects.filter(pk=site.pk, owner=request.user, version=site.version).update(
                payload=payload, version=site.version + 1, updated_at=timezone.now())
            if not updated:
                raise ApiError('部分资料已变化，请刷新后重试', 'version_conflict', 409)
    return {'completed': len(sites), 'revision': workspace_revision(request.user)}
