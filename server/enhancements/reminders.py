"""提醒只在当前账号的站内通知出现，不发送邮件或外部消息。"""
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from workspace.http import api, body, owned, ApiError
from workspace.validation import text
from enhancements.metadata import active_site
from enhancements.models import Reminder, Notification


def reminder_dto(reminder):
    return {'id': reminder.pk, 'siteId': str(reminder.site_id), 'dueAt': reminder.due_at.isoformat(),
        'advanceDays': reminder.advance_days, 'description': reminder.description,
        'notifiedAt': reminder.notified_at.isoformat() if reminder.notified_at else None}


@api(['GET', 'POST'], rate=120)
def reminders(request):
    if request.method == 'GET':
        return {'reminders': [reminder_dto(r) for r in Reminder.objects.filter(owner=request.user).order_by('due_at')[:1000]]}
    data = body(request)
    site = active_site(request.user, data.get('siteId'))
    value = data.get('dueAt')
    due = parse_datetime(value) if isinstance(value, str) else None
    advance = data.get('advanceDays', 0)
    if due is None or not 2000 <= due.year <= 2200 or type(advance) is not int or not 0 <= advance <= 365:
        raise ApiError('到期时间须为 2000 至 2200 年；提前天数为 0 至 365')
    if timezone.is_naive(due):
        due = timezone.make_aware(due)
    with transaction.atomic():
        if Reminder.objects.filter(owner=request.user).count() >= 1000:
            raise ApiError('提醒数量已达到上限')
        reminder = Reminder.objects.create(owner=request.user, site=site, due_at=due,
            trigger_at=due - timedelta(days=advance), advance_days=advance,
            description=text(data.get('description', '到期提醒'), 500, True))
    return reminder_dto(reminder)


@api(['DELETE'])
def delete_reminder(request, pk):
    reminder = owned(Reminder, request.user, pk)
    reminder.delete()
    return {'deleted': True}


def notification_dto(notification):
    reminder = notification.reminder
    return {'id': notification.pk, 'siteId': str(reminder.site_id), 'description': reminder.description,
            'dueAt': reminder.due_at.isoformat(), 'createdAt': notification.created_at.isoformat(), 'read': notification.read}


@api(['GET'])
def notifications(request):
    records = Notification.objects.filter(owner=request.user).select_related('reminder').order_by('-created_at')[:200]
    return {'notifications': [notification_dto(n) for n in records]}


@api(['PATCH'])
def read_notification(request, pk):
    notification = owned(Notification, request.user, pk)
    value = body(request).get('read')
    if not isinstance(value, bool):
        raise ApiError('已读状态必须为布尔值')
    notification.read = value
    notification.save(update_fields=['read'])
    return notification_dto(notification)
