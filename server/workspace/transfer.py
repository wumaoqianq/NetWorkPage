"""预览保存已校验数据，提交重新检查重复与归属，在一个事务内完成。"""
import json
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from workspace.models import ImportJob, Site, Endpoint, Category, Collection
from workspace.http import api, body, owned, ApiError
from workspace.validation import normalized_site, text
from workspace.library import site_dto, collection_dto, save_site, defaults
from workspace.browser_bookmarks import browser_content, SOURCES


def parse_content(data):
    content = data.get('content')
    if len(json.dumps(content, ensure_ascii=False).encode()) > 5 * 1024 * 1024:
        raise ApiError('导入文件不能超过 5MB')
    if data.get('format') == 'html':
        if not isinstance(content, str):
            raise ApiError('HTML 导入需要文字内容')
        return browser_content(content, 'html')
    if data.get('format') == 'chromium':
        return browser_content(content, 'chromium')
    if data.get('format') != 'json':
        raise ApiError('仅支持 JSON 或 HTML 导入')
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except ValueError:
            raise ApiError('JSON 文件格式不正确')
    if isinstance(content, list):
        content = {'sites': content}
    if not isinstance(content, dict) or not isinstance(content.get('sites'), list):
        raise ApiError('JSON 需要包含 sites 数组')
    if content.get('version', 1) != 1:
        raise ApiError('不支持该导出格式版本')
    return content


def validate_organization(content):
    categories = content.get('categories', [])
    collections = content.get('collections', [])
    if not isinstance(categories, list) or len(categories) > 200 or not isinstance(collections, list) or len(collections) > 200:
        raise ApiError('分类或工作集格式不正确')
    categories = [text(name, 100, True) for name in categories]
    normalized = []
    seen = set()
    for item in collections:
        if not isinstance(item, dict):
            raise ApiError('工作集格式不正确')
        old_id = text(item.get('id', ''), 100, True)
        if old_id in seen:
            raise ApiError('工作集编号重复')
        seen.add(old_id)
        normalized.append({'id': old_id, 'name': text(item.get('name', ''), 100, True),
                           'description': text(item.get('description', ''), 500)})
    return categories, normalized


@api(['POST'], rate=10)
def preview(request):
    defaults(request.user)
    data = body(request)
    source = data.get('source', '')
    if source and source not in SOURCES:
        raise ApiError('浏览器来源不正确')
    content = parse_content(data)
    if len(content['sites']) > 500:
        raise ApiError('一次最多导入 500 条网站')
    categories, collections = validate_organization(content)
    collection_ids = {item['id'] for item in collections}
    own_collection_ids = set(str(pk) for pk in Collection.objects.filter(owner=request.user).values_list('pk', flat=True))
    own_categories = set(Category.objects.filter(owner=request.user).values_list('name', flat=True))
    urls = set(Endpoint.objects.filter(owner=request.user).values_list('url', flat=True))
    entries, duplicates = [], 0
    for item in content['sites']:
        site = normalized_site(item, request.user, check_relations=False)
        if set(site['collections']) - collection_ids - own_collection_ids:
            raise ApiError('导入网站引用了不存在的工作集')
        if site['category'] and site['category'] not in set(categories) | own_categories:
            categories.append(site['category'])
        site_urls = {entry['url'] for entry in site['endpoints']}
        if urls & site_urls:
            duplicates += 1
            continue
        urls.update(site_urls)
        entries.append(site)
    job = ImportJob.objects.create(owner=request.user, payload={'sites': entries, 'categories': categories,
        'collections': collections}, expires_at=timezone.now()+timedelta(hours=1))
    skipped = content.get('skippedUnsupported', 0)
    warnings = ['重复网址将跳过，已有个人资料不会被覆盖'] if duplicates else []
    if skipped:
        warnings.append(f'已跳过 {skipped} 条不支持的网址（如浏览器内部页面、脚本或带凭据网址）')
    return {'id': str(job.pk), 'count': len(entries), 'duplicates': duplicates, 'source': source,
            'skippedUnsupported': skipped, 'preview': entries[:20], 'warnings': warnings}


@api(['POST'], rate=20)
def commit(request, pk):
    with transaction.atomic():
        job = owned(ImportJob, request.user, pk)
        if job.result is not None:
            return job.result
        if job.expires_at <= timezone.now():
            raise ApiError('导入预览已过期，请重新上传', 'import_expired', 410)
        mapping = {}
        for item in job.payload['collections']:
            collection = Collection.objects.create(owner=request.user, name=item['name'], description=item['description'])
            mapping[item['id']] = str(collection.pk)
        for name in job.payload['categories']:
            Category.objects.get_or_create(owner=request.user, name=name)
        imported, skipped = 0, 0
        for item in job.payload['sites']:
            if Endpoint.objects.filter(owner=request.user, url__in=[entry['url'] for entry in item['endpoints']]).exists():
                skipped += 1
                continue
            item = {**item, 'collections': [mapping.get(pk, pk) for pk in item['collections']]}
            save_site(request.user, item)
            imported += 1
        job.result = {'imported': imported, 'skipped': skipped}
        job.save(update_fields=['result'])
        return job.result


@api(['GET'])
def export(request):
    defaults(request.user)
    return {'version': 1, 'exportedAt': timezone.now().isoformat(),
        'sites': [site_dto(site) for site in Site.objects.filter(owner=request.user)[:settings.MAX_SITES]],
        'collections': [collection_dto(c) for c in Collection.objects.filter(owner=request.user)],
        'categories': list(Category.objects.filter(owner=request.user).values_list('name', flat=True))}
