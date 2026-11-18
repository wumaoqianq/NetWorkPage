"""阶段 D：服务端公开图标补齐 Job 层（纯逻辑 + 有界串行执行器）。

captures() 只入队（HTTP 立即返回，不做外网抓取），run_jobs() 复用现有 timer 驱动执行。
自动 Job 只填空，绝不覆盖客户端上传/用户自定义图标；不接收客户端任意 URL，
只使用该站 payload 里通过 favicons 公网校验的入口，且抓取不携带 Cookie/Bearer/Referer。

所有条件写与版本递增都放在事务内；媒体发布在事务外先做，任何失败即删除已发布文件。
"""
import time
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from workspace import favicons
from workspace.asset_baseline import site_source_fingerprint, source_url_fingerprint
from workspace.icons import icon_quota_used, publish_icon
from workspace.media import media_path
from workspace.models import IconJob, Site, SiteIconAsset

MAX_ATTEMPTS = 3
LEASE_SECONDS = 60
MAX_BACKOFF_SECONDS = 600
PENDING_PHASES = ('pending', 'leased')
TERMINAL_PHASES = ('no_icon', 'cancelled', 'kept_existing')
# 这些 code 明确说明「服务器重试也拿不到图」，直接落终态，绝不无限重试。
TERMINAL_ERROR_CODES = frozenset({
    'icon_svg_only', 'icon_refresh_private', 'icon_refresh_timeout', 'icon_refresh_too_large',
})


def _default_fetcher(site):
    """默认抓取：只取该站 payload 里通过公网解析校验的入口，再由 favicons 逐跳安全抓取。"""
    endpoint = favicons.public_endpoint(site.payload)
    return favicons.fetch_icon(endpoint['url'])


def enqueue_icon_job(user, site, capture_id, allow, now=None):
    """在调用方已持有的事务内执行（不自己开 atomic）；返回 job 或 None。

    条件全部满足才创建：allow 为真、site 未 deleted/archived、该 site 没有 SiteIconAsset、
    存在公网候选入口。用 (site, source_version) 去重；已存在则不重置 phase/attempts（幂等）。
    """
    if not allow:
        return None
    if site.payload.get('deleted') or site.payload.get('archived'):
        return None
    if SiteIconAsset.objects.filter(site=site).exists():
        return None
    # 本机/局域网入口没有公网候选：诚实不排队，避免必然无效的外网抓取。
    if not favicons.has_public_candidate(site.payload):
        return None
    now = now or timezone.now()
    source_version = site_source_fingerprint(site)
    job, _ = IconJob.objects.get_or_create(
        site=site, source_version=source_version,
        defaults={'owner': user, 'capture_id': capture_id, 'phase': 'pending',
                  'attempts': 0, 'next_attempt_at': now, 'result': None,
                  'lease_until': None, 'last_error_code': '', 'last_error': ''},
    )
    return job


def icon_job_dto(site):
    """供 summary / capture_site_dto / site_dto 暴露「图标获取中」。"""
    source_version = site_source_fingerprint(site)
    job = IconJob.objects.filter(
        owner_id=site.owner_id, site=site, source_version=source_version,
        phase__in=PENDING_PHASES,
    ).order_by('-created_at').first()
    if job is None:
        return {'queued': False, 'phase': '', 'attempts': 0}
    return {'queued': True, 'phase': job.phase, 'attempts': job.attempts}


def requeue_icon_job(user, site, now=None):
    """「重新获取」例外入口：把终态任务重置为 pending；不改变已有图标、不改 site.version。"""
    now = now or timezone.now()
    if site.payload.get('deleted') or site.payload.get('archived'):
        return IconJob.objects.filter(owner=user, site=site).order_by('-created_at').first()
    source_version = site_source_fingerprint(site)
    job = IconJob.objects.filter(
        owner=user, site=site, source_version=source_version,
    ).order_by('-created_at').first()
    if job is None:
        # 当前入口版本尚无任务（例如基线变化后只剩旧任务）：按当前版本重新入队。
        return enqueue_icon_job(user, site, '', True, now=now)
    if job.phase in TERMINAL_PHASES:
        job.phase = 'pending'
        job.attempts = 0
        job.next_attempt_at = now
        job.result = None
        job.lease_until = None
        job.last_error_code = ''
        job.last_error = ''
        job.save(update_fields=['phase', 'attempts', 'next_attempt_at', 'result',
                                'lease_until', 'last_error_code', 'last_error', 'updated_at'])
    return job


def _settle(job, phase, *, result, error_code='', error_message='', next_attempt_at=None):
    """把任务落到终态/重试态并清租约；用 queryset.update 避免覆盖并发字段。"""
    IconJob.objects.filter(pk=job.pk).update(
        phase=phase,
        result=result,
        last_error_code=error_code,
        last_error=error_message[:300],
        lease_until=None,
        next_attempt_at=next_attempt_at if next_attempt_at is not None else job.next_attempt_at,
        updated_at=timezone.now(),
    )


def _entry(job, phase, code):
    return {'jobId': str(job.pk), 'phase': phase, 'code': code}


def _handle_fetch_error(job, exc, now):
    """按 code 分类：明确拿不到图的错误直接终态；其余有界退避，到 MAX_ATTEMPTS 转 no_icon。"""
    code = exc.code
    if code in TERMINAL_ERROR_CODES or job.attempts >= MAX_ATTEMPTS:
        _settle(job, 'no_icon', result={'status': 'no_icon', 'code': code},
                error_code=code, error_message=exc.message)
        return _entry(job, 'no_icon', code)
    backoff = min(60 * 2 ** job.attempts, MAX_BACKOFF_SECONDS)
    _settle(job, 'pending', result=None, error_code=code, error_message=exc.message,
            next_attempt_at=now + timedelta(seconds=backoff))
    return _entry(job, 'pending', code)


def _store_variant(job, variant, now):
    """拿到 variant 后：事务外发布媒体，事务内复核并只填空写库，失败删已发布文件。"""
    key = None
    committed = False
    decision = None
    try:
        content = variant['content']
        key = publish_icon(job.owner_id, content)
        with transaction.atomic():
            site = Site.objects.filter(pk=job.site_id, owner_id=job.owner_id).first()
            if site is None or site.payload.get('deleted') or site.payload.get('archived'):
                decision = ('cancelled', {'status': 'cancelled', 'code': 'unavailable'}, 'cancelled')
            elif site_source_fingerprint(site) != job.source_version:
                decision = ('cancelled', {'status': 'cancelled', 'code': 'baseline_changed'}, 'cancelled')
            elif SiteIconAsset.objects.filter(site=site).exists():
                # 事务外抓取期间已有图标（迟到/并发）：只填空，绝不覆盖。
                decision = ('kept_existing', {'status': 'kept_existing'}, 'kept_existing')
            elif icon_quota_used(job.owner) + len(content) > settings.ICON_QUOTA_BYTES:
                decision = ('no_icon', {'status': 'no_icon', 'code': 'icon_quota_exceeded'},
                            'icon_quota_exceeded')
            else:
                base = site.version
                updated = Site.objects.filter(pk=site.pk, owner_id=job.owner_id,
                                              version=base).update(version=base + 1,
                                                                   updated_at=timezone.now())
                if not updated:
                    decision = ('no_icon', {'status': 'no_icon', 'code': 'version_conflict'},
                                'version_conflict')
                else:
                    source_url = variant.get('source_url', '')
                    asset = SiteIconAsset.objects.create(
                        owner_id=job.owner_id, site=site, storage_key=key,
                        mime='image/webp', width=variant.get('width', 1),
                        height=variant.get('height', 1), bytes=len(content),
                        source_url=source_url, revision=uuid.uuid4(),
                        source_fingerprint=source_url_fingerprint(source_url))
                    committed = True
                    decision = ('complete', {'status': 'complete', 'assetId': str(asset.pk)}, 'complete')
        phase, result, code = decision
        if phase == 'no_icon':
            _settle(job, phase, result=result, error_code=code, error_message=code)
        else:
            _settle(job, phase, result=result)
        return _entry(job, phase, code)
    except Exception:
        # 媒体发布/写库/结算任一异常都按可重试失败收敛，绝不把任务卡在 leased。
        return _handle_fetch_error(job, favicons.FaviconError('图标写入失败', 'icon_refresh_failed'), now)
    finally:
        if key is not None and not committed:
            media_path(Path(settings.MEDIA_ROOT), key).unlink(missing_ok=True)


def _process_one(job, now, fetcher):
    fresh = IconJob.objects.get(pk=job.pk)
    # 事务内复核：站点存活 / 基线未变 / 尚无图标。
    with transaction.atomic():
        site = Site.objects.filter(pk=fresh.site_id, owner_id=fresh.owner_id).first()
        if site is None or site.payload.get('deleted') or site.payload.get('archived'):
            reason = 'unavailable'
        elif site_source_fingerprint(site) != fresh.source_version:
            reason = 'baseline_changed'
        elif SiteIconAsset.objects.filter(site=site).exists():
            reason = 'kept_existing'
        else:
            reason = None
    if reason == 'kept_existing':
        _settle(fresh, 'kept_existing', result={'status': 'kept_existing'})
        return _entry(fresh, 'kept_existing', 'kept_existing')
    if reason is not None:
        _settle(fresh, 'cancelled', result={'status': 'cancelled', 'code': reason})
        return _entry(fresh, 'cancelled', 'cancelled')
    # 事务外抓取（favicons 自带 5s 预算）；不传任何 Cookie/Bearer/Referer。
    try:
        variant = fetcher(site)
    except favicons.FaviconError as exc:
        return _handle_fetch_error(fresh, exc, now)
    except Exception:
        return _handle_fetch_error(fresh, favicons.FaviconError('图标获取失败', 'icon_refresh_failed'), now)
    return _store_variant(fresh, variant, now)


def run_icon_jobs(limit=4, now=None, fetcher=None, run_seconds=25):
    """有界串行执行器，返回 {'processed': int, 'results': [{'jobId','phase','code'}]}。

    用条件 update 抢占租约（SQLite 不支持 select_for_update）；整体墙钟预算 run_seconds，
    超时停止取新任务；单个任务最多 MAX_ATTEMPTS 次，绝不无限重试。
    """
    now = now or timezone.now()
    fetcher = fetcher or _default_fetcher
    limit = max(1, min(int(limit), 100))
    deadline = time.monotonic() + run_seconds
    lease_available = Q(lease_until__isnull=True) | Q(lease_until__lte=now)
    candidates = IconJob.objects.filter(
        phase__in=PENDING_PHASES, next_attempt_at__lte=now,
    ).filter(lease_available).order_by('next_attempt_at', 'pk')[:limit]
    pks = [candidate.pk for candidate in candidates]
    results = []
    processed = 0
    for pk in pks:
        if time.monotonic() >= deadline:
            break
        leased = IconJob.objects.filter(
            pk=pk, phase__in=PENDING_PHASES, next_attempt_at__lte=now,
        ).filter(lease_available).update(
            phase='leased', lease_until=now + timedelta(seconds=LEASE_SECONDS),
            attempts=F('attempts') + 1, updated_at=timezone.now(),
        )
        if not leased:
            # 抢不到租约：说明另一轮正在处理（或已被结算），跳过防并发。
            continue
        fresh = IconJob.objects.get(pk=pk)
        results.append(_process_one(fresh, now, fetcher))
        processed += 1
    return {'processed': processed, 'results': results}
