"""快照只有白名单公开字段；原资料失效时整份分享返回 404。"""
import secrets
import json
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from workspace.http import api, body, owned, ApiError, digest
from workspace.models import Site, Collection
from enhancements.models import Share


def visible(site):
    return not site.payload.get('deleted') and not site.payload.get('archived')


def public_site(site, accounts):
    keys = ('name', 'description', 'purpose', 'aliases', 'tags', 'category', 'kind', 'icon')
    result = {key: site.payload.get(key) for key in keys}
    result['endpoints'] = [{key: entry.get(key, '') for key in ('id', 'label', 'url', 'scope')}
                           for entry in site.payload.get('endpoints', [])]
    if accounts:
        allowed = ('label', 'username', 'method', 'notes', 'endpointId', 'loginUrl')
        result['accounts'] = [{key: entry[key] for key in allowed if key in entry}
                              for entry in site.payload.get('accounts', [])]
    return result


def share_dto(share):
    return {'id': str(share.pk), 'title': share.snapshot['title'], 'kind': share.snapshot['kind'],
            'expiresAt': share.expires_at.isoformat(), 'revokedAt': share.revoked_at.isoformat() if share.revoked_at else None,
            'includeAccounts': share.include_accounts, 'createdAt': share.created_at.isoformat()}


@api(['GET', 'POST'], rate=30)
def shares(request):
    if request.method == 'GET':
        return {'shares': [share_dto(s) for s in Share.objects.filter(owner=request.user).order_by('-created_at')[:100]]}
    data = body(request)
    accounts = data.get('includeAccounts', False)
    if not isinstance(accounts, bool) or (accounts and data.get('confirmAccounts') is not True):
        raise ApiError('分享账号说明需要明确确认')
    days = data.get('expiresInDays', 7)
    if type(days) is not int or not 1 <= days <= 30:
        raise ApiError('有效期必须为 1 至 30 天')
    if bool(data.get('siteId')) == bool(data.get('collectionId')):
        raise ApiError('请选择一个网站或工作集')
    with transaction.atomic():
        collection = None
        if data.get('siteId'):
            site = owned(Site, request.user, data['siteId'])
            sites, title, kind = [site], site.payload['name'], 'site'
        else:
            collection = owned(Collection, request.user, data['collectionId'])
            sites = [s for s in Site.objects.filter(owner=request.user) if visible(s)
                     and str(collection.pk) in s.payload.get('collections', [])]
            title, kind = collection.name, 'collection'
        if not sites or any(not visible(s) for s in sites):
            raise ApiError('没有可以分享的网站')
        if len(sites) > 200:
            raise ApiError('一次最多分享 200 个网站')
        if Share.objects.filter(owner=request.user, revoked_at=None, expires_at__gt=timezone.now()).count() >= 100:
            raise ApiError('有效分享数量已达上限')
        snapshot = {'title': title, 'kind': kind, 'sites': [public_site(s, accounts) for s in sites]}
        if len(json.dumps(snapshot, ensure_ascii=False).encode('utf-8')) > 1024 * 1024:
            raise ApiError('分享快照超过 1 MiB，请减少工作集网站或账号说明')
        token = secrets.token_urlsafe(32)
        share = Share.objects.create(owner=request.user, token_hash=digest(token), collection=collection,
            snapshot=snapshot,
            source_ids=[str(s.pk) for s in sites], include_accounts=accounts,
            expires_at=timezone.now() + timedelta(days=days))
    return {**share_dto(share), 'token': token, 'url': settings.PUBLIC_URL.rstrip('/') + '/?share=' + token}


@api(['DELETE'])
def revoke(request, pk):
    share = owned(Share, request.user, pk)
    share.revoked_at = timezone.now()
    share.save(update_fields=['revoked_at'])
    return {'revoked': True}


@api(['GET'], public=True, rate=60)
def public_share(request, token):
    share = Share.objects.filter(token_hash=digest(token), revoked_at=None, expires_at__gt=timezone.now(), owner__is_active=True).first()
    if share:
        sites = list(Site.objects.filter(owner=share.owner, pk__in=share.source_ids))
        valid = len(sites) == len(share.source_ids) and all(visible(s) for s in sites)
        valid = valid and (share.snapshot['kind'] != 'collection' or share.collection_id is not None)
        if valid:
            return {**share.snapshot, 'expiresAt': share.expires_at.isoformat()}
    raise ApiError('分享不存在、已失效或已撤销', 'not_found', 404)
