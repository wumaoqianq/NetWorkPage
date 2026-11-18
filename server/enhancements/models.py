"""增强资料与私人 Site 分离，删除站点时级联清理缓存、监控与提醒。"""
import uuid
from django.db import models
from workspace.models import Owned, Site, Collection


class Share(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token_hash = models.CharField(max_length=64, unique=True)
    snapshot = models.JSONField()
    source_ids = models.JSONField(default=list)
    collection = models.ForeignKey(Collection, null=True, on_delete=models.SET_NULL)
    include_accounts = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Metadata(Owned):
    site = models.OneToOneField(Site, on_delete=models.CASCADE)
    result = models.JSONField(default=dict)
    checked_at = models.DateTimeField()


class Archive(Owned):
    site = models.ForeignKey(Site, on_delete=models.CASCADE)
    title = models.CharField(max_length=500)
    url = models.CharField(max_length=2048)
    text = models.TextField()
    checked_at = models.DateTimeField()


class Monitor(Owned):
    site = models.OneToOneField(Site, on_delete=models.CASCADE)
    enabled = models.BooleanField(default=False)
    endpoint_id = models.CharField(max_length=100, blank=True)
    interval_hours = models.PositiveIntegerField(default=24)
    next_check_at = models.DateTimeField(null=True, db_index=True)


class Reminder(Owned):
    site = models.ForeignKey(Site, on_delete=models.CASCADE)
    due_at = models.DateTimeField()
    trigger_at = models.DateTimeField(db_index=True)
    advance_days = models.PositiveIntegerField(default=0)
    description = models.CharField(max_length=500)
    notified_at = models.DateTimeField(null=True)


class Notification(Owned):
    reminder = models.OneToOneField(Reminder, on_delete=models.CASCADE)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class JobLease(models.Model):
    """单行数据库租约避免重叠 timer 在 SQLite 上同时进行后台抓取。"""
    expires_at = models.DateTimeField()
