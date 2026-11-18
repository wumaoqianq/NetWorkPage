"""有界串行任务：单次最多 100 项，默认 10 项，无常驻调度器。"""
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from workspace.http import ApiError
from enhancements.metadata import refresh, endpoint
from enhancements.models import Reminder, Notification, Monitor, JobLease


def run_jobs(limit=10):
    limit = max(1, min(int(limit), 100))
    now = timezone.now()
    with transaction.atomic():
        lease, _ = JobLease.objects.get_or_create(pk=1, defaults={'expires_at': now})
        acquired = JobLease.objects.filter(pk=1, expires_at__lte=now).update(expires_at=now + timedelta(minutes=10))
    if not acquired:
        return {'processed': 0, 'skipped': 'another_run_active'}
    processed = 0
    try:
        # 每个待办领取与通知写入同一事务，重复执行不会重复通知。
        ids = Reminder.objects.filter(notified_at=None, trigger_at__lte=now,
            owner__is_active=True).order_by('trigger_at').values_list('pk', flat=True)[:limit]
        for pk in list(ids):
            with transaction.atomic():
                reminder = Reminder.objects.select_related('site').get(pk=pk)
                if reminder.notified_at is None:
                    if not reminder.site.payload.get('deleted') and not reminder.site.payload.get('archived'):
                        Notification.objects.get_or_create(reminder=reminder, defaults={'owner': reminder.owner})
                    reminder.notified_at = now
                    reminder.save(update_fields=['notified_at'])
            processed += 1
        monitors = Monitor.objects.filter(enabled=True, next_check_at__lte=now,
            owner__is_active=True).select_related('site').order_by('next_check_at')[:limit - processed]
        for monitor in list(monitors):
            # 先预约下一次，异常或重启不会对同一入口形成密集重试。
            monitor.next_check_at = now + timedelta(hours=monitor.interval_hours)
            monitor.save(update_fields=['next_check_at'])
            if not monitor.site.payload.get('deleted') and not monitor.site.payload.get('archived'):
                try:
                    refresh(monitor.site, endpoint(monitor.site, monitor.endpoint_id))
                except ApiError:
                    monitor.enabled, monitor.next_check_at = False, None
                    monitor.save(update_fields=['enabled', 'next_check_at'])
            processed += 1
        from workspace.icon_jobs import run_icon_jobs
        icon_jobs_result = run_icon_jobs(limit=min(4, max(1, limit)))
        return {'processed': processed, 'iconJobs': icon_jobs_result}
    finally:
        JobLease.objects.filter(pk=1).update(expires_at=timezone.now())
