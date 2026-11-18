"""素材条件写入基线：入口来源指纹、素材现状 DTO 与条件校验。

客户端在上传预览图/图标前先拿到 baseline（present / revision / sourceFingerprint），
再把它随上传请求带回；服务端在事务内复核，避免 ABA（删图后又无图）与并发覆盖。
"""
import hashlib
import json

from workspace.http import ApiError
from workspace.models import AssetTombstone


def site_source_fingerprint(site):
    """对 site 的入口集合（id + url）做稳定 sha256；入口增删或改动都会改变它。"""
    endpoints = site.payload.get('endpoints', [])
    ordered = sorted([[entry.get('id', ''), entry.get('url', '')] for entry in endpoints])
    payload = json.dumps(ordered, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode()).hexdigest()


def source_url_fingerprint(source_url):
    """单个来源 URL 的指纹，用于 SiteIconAsset.source_fingerprint 等非空场景。"""
    return hashlib.sha256(source_url.encode()).hexdigest()


def _asset(site, kind):
    name = 'preview_asset' if kind == 'preview' else 'site_icon_asset'
    return getattr(site, name, None)


def baseline_dto(site, kind):
    asset = _asset(site, kind)
    return {'present': asset is not None,
            'revision': str(asset.revision) if asset else None,
            'sourceFingerprint': site_source_fingerprint(site)}


def check_baseline(site, kind, expected_revision, expected_source_fingerprint):
    if site_source_fingerprint(site) != expected_source_fingerprint:
        raise ApiError('入口来源已变化', 'asset_source_changed', 409)
    asset = _asset(site, kind)
    if expected_revision == 'absent':
        if asset is not None or AssetTombstone.objects.filter(site=site, kind=kind).exists():
            raise ApiError('素材基线已变化', 'asset_conflict', 409)
    elif asset is None or str(asset.revision) != expected_revision:
        raise ApiError('素材基线已变化', 'asset_conflict', 409)


def record_tombstone(user, site, kind, revision):
    return AssetTombstone.objects.create(owner=user, site=site, kind=kind, revision=revision)
