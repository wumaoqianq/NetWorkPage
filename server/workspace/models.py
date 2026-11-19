"""私有资料使用 owner 外键；URL 与收藏回执用数据库唯一约束去重。"""
import uuid
from django.conf import settings
from django.db import models


class Owned(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        abstract = True


class SetupState(models.Model):
    completed = models.BooleanField(default=False)


class UserWorkspace(models.Model):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)


class Collection(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=500, blank=True)


class Category(Owned):
    name = models.CharField(max_length=100)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'name'], name='unique_owner_category')]


class Site(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payload = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Endpoint(Owned):
    site = models.ForeignKey(Site, related_name='url_records', on_delete=models.CASCADE)
    url = models.CharField(max_length=2048)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'url'], name='unique_owner_url')]


class Visit(Owned):
    site = models.ForeignKey(Site, on_delete=models.CASCADE)
    endpoint_id = models.CharField(max_length=100)
    opened_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['owner', '-opened_at'])]


class Invite(models.Model):
    token_hash = models.CharField(max_length=64, unique=True)
    email = models.EmailField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True)


class PairingCode(Owned):
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True)


class Device(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    token_hash = models.CharField(max_length=64, unique=True)
    auth_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    extension_version = models.CharField(max_length=20, blank=True)
    protocol_version = models.PositiveSmallIntegerField(default=1)
    last_active_at = models.DateTimeField(null=True)


class CaptureReceipt(Owned):
    client_capture_id = models.CharField(max_length=128)
    device = models.ForeignKey(Device, on_delete=models.SET_NULL, null=True)
    site = models.ForeignKey(Site, on_delete=models.SET_NULL, null=True)
    request_fingerprint = models.CharField(max_length=64, blank=True)
    result = models.JSONField(null=True)
    can_attach_preview = models.BooleanField(default=False)
    can_attach_icon = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'client_capture_id'], name='unique_owner_capture')]


class PreviewAsset(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.OneToOneField(Site, related_name='preview_asset', on_delete=models.CASCADE)
    storage_key = models.CharField(max_length=200, unique=True)
    thumbnail_key = models.CharField(max_length=200, unique=True)
    mime = models.CharField(max_length=20)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    bytes = models.PositiveIntegerField()
    thumbnail_bytes = models.PositiveIntegerField()
    source_endpoint_id = models.CharField(max_length=100)
    source_url = models.CharField(max_length=2048)
    homepage_url = models.CharField(max_length=2048, blank=True)
    page_kind = models.CharField(max_length=10)
    user_confirmed_homepage = models.BooleanField(default=False)
    captured_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    revision = models.CharField(max_length=36, default=uuid.uuid4)
    stale = models.BooleanField(default=False)
    source_fingerprint = models.CharField(max_length=64)


class PreviewReceipt(Owned):
    capture = models.ForeignKey(CaptureReceipt, on_delete=models.CASCADE)
    site = models.ForeignKey(Site, on_delete=models.SET_NULL, null=True)
    asset = models.ForeignKey(PreviewAsset, on_delete=models.SET_NULL, null=True)
    client_asset_id = models.CharField(max_length=128)
    content_fingerprint = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'client_asset_id'], name='unique_owner_preview_receipt')]


class SiteIconAsset(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.OneToOneField(Site, related_name='site_icon_asset', on_delete=models.CASCADE)
    storage_key = models.CharField(max_length=200, unique=True)
    mime = models.CharField(max_length=20)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    bytes = models.PositiveIntegerField()
    source_url = models.CharField(max_length=2048)
    revision = models.CharField(max_length=36, default=uuid.uuid4)
    created_at = models.DateTimeField(auto_now_add=True)
    source_fingerprint = models.CharField(max_length=64, default='')


class IconReceipt(Owned):
    capture = models.ForeignKey(CaptureReceipt, on_delete=models.CASCADE)
    site = models.ForeignKey(Site, on_delete=models.SET_NULL, null=True)
    asset = models.ForeignKey(SiteIconAsset, on_delete=models.SET_NULL, null=True)
    client_asset_id = models.CharField(max_length=128)
    content_fingerprint = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'client_asset_id'], name='unique_owner_icon_receipt')]


class AssetTombstone(Owned):
    """记录「曾经有图但被删除」，让「删图后又无图」与「从未有图」可区分，防止 ABA。"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, related_name='asset_tombstones', on_delete=models.CASCADE)
    kind = models.CharField(max_length=10)
    revision = models.CharField(max_length=36)
    created_at = models.DateTimeField(auto_now_add=True)


class OrphanedMedia(models.Model):
    storage_key = models.CharField(max_length=200, unique=True)
    first_seen = models.DateTimeField(auto_now_add=True)


class ImportJob(Owned):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    payload = models.JSONField()
    result = models.JSONField(null=True)
    expires_at = models.DateTimeField()


class RecoveryToken(Owned):
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True)


class AuditEvent(models.Model):
    event = models.CharField(max_length=80)
    actor_id = models.IntegerField(null=True)
    subject_id = models.IntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class IconJob(Owned):
    """阶段 D：服务端公开图标补齐任务。按「站点 + 入口来源版本」去重，
    重复收藏命中同一任务时不重置终态；自动补齐只填空，绝不覆盖已有图标。"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    site = models.ForeignKey(Site, related_name='icon_jobs', on_delete=models.CASCADE)
    capture_id = models.CharField(max_length=128, blank=True)
    source_version = models.CharField(max_length=64)
    phase = models.CharField(max_length=20, default='pending')
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    lease_until = models.DateTimeField(null=True)
    result = models.JSONField(null=True)
    last_error_code = models.CharField(max_length=64, blank=True)
    last_error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['site', 'source_version'],
                                               name='unique_icon_job_site_source')]
