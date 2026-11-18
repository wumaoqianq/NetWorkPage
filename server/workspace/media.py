"""私有预览图的真实解码、受管存储、配额与延迟垃圾回收。"""
import io
import os
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from workspace.http import ApiError
from workspace.models import OrphanedMedia, PreviewAsset, SiteIconAsset

MAX_INPUT_BYTES = 200 * 1024
MAX_PIXELS = 2_000_000
LOCK_NAME = '.maintenance.lock'


def process_image(raw):
    if len(raw) > MAX_INPUT_BYTES:
        raise ApiError('图片不能超过 200KiB，请重新压缩', 'preview_too_large', 413)
    try:
        probe = Image.open(io.BytesIO(raw))
        if probe.format not in {'WEBP', 'JPEG', 'PNG'}:
            raise ValueError()
        if probe.width * probe.height > MAX_PIXELS or min(probe.size) < 1:
            raise ValueError()
        probe.verify()
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert('RGB')
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError):
        raise ApiError('图片损坏、格式或尺寸不受支持', 'preview_invalid', 400)
    return {'full': encode_variant(image, 960, 540, MAX_INPUT_BYTES),
            'thumb': encode_variant(image, 480, 270, 60 * 1024)}


def encode_variant(image, maximum_width, maximum_height, byte_limit):
    ratio = maximum_width / maximum_height
    width, height = image.size
    if width / height > ratio:
        crop_width = max(1, round(height * ratio))
        left = (width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, height))
    else:
        crop_height = max(1, round(width / ratio))
        top = (height - crop_height) // 2
        image = image.crop((0, top, width, top + crop_height))
    scale = min(1, maximum_width / image.width, maximum_height / image.height)
    if scale < 1:
        image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                             Image.Resampling.LANCZOS)
    for quality in (82, 72, 62, 52, 42, 32):
        output = io.BytesIO()
        image.save(output, 'WEBP', quality=quality, method=4)
        if output.tell() <= byte_limit:
            return {'content': output.getvalue(), 'width': image.width, 'height': image.height}
    raise ApiError('图片无法压缩到允许范围', 'preview_too_large', 413)


def media_path(root, key):
    root = Path(root).resolve()
    path = (root / key).resolve()
    if not key or Path(key).is_absolute() or '..' in Path(key).parts or not path.is_relative_to(root):
        raise ApiError('图片路径无效', 'preview_invalid', 400)
    return path


def publish_images(owner_id, variants):
    root = Path(settings.MEDIA_ROOT)
    temporary_root = root / '.tmp'
    temporary_root.mkdir(parents=True, exist_ok=True)
    prefix = f'{owner_id}/{uuid.uuid4().hex}'
    keys = {'full': f'{prefix}-full.webp', 'thumb': f'{prefix}-thumb.webp'}
    try:
        with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
            for kind in ('full', 'thumb'):
                path = Path(temporary) / f'{kind}.webp'
                path.write_bytes(variants[kind]['content'])
                target = media_path(root, keys[kind])
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(path, target)
        return keys
    except OSError:
        for key in keys.values():
            media_path(root, key).unlink(missing_ok=True)
        raise ApiError('图片暂时无法保存，请稍后重试', 'preview_publish_failed', 503)


def quota_used(user):
    values = PreviewAsset.objects.filter(owner=user).aggregate(
        full=Sum('bytes', default=0), thumb=Sum('thumbnail_bytes', default=0))
    return values['full'] + values['thumb']


def maintenance_lock(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(root / LOCK_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return descriptor


def release_maintenance_lock(root, descriptor):
    os.close(descriptor)
    Path(root, LOCK_NAME).unlink(missing_ok=True)


def managed_files(root):
    for directory in root.iterdir():
        if directory.name.startswith('.') or directory.is_symlink() or not directory.is_dir():
            continue
        for path in directory.iterdir():
            if path.is_file() and not path.is_symlink() and not path.name.startswith('.'):
                yield path


def collect_garbage(root=None, now=None):
    root = Path(root or settings.MEDIA_ROOT)
    now = now or timezone.now()
    if not root.exists():
        return []
    try:
        descriptor = maintenance_lock(root)
    except FileExistsError:
        return []
    deleted = []
    try:
        referenced = set()
        for asset in PreviewAsset.objects.iterator():
            referenced.update((asset.storage_key, asset.thumbnail_key))
        for asset in SiteIconAsset.objects.iterator():
            referenced.add(asset.storage_key)
        found = set()
        for path in managed_files(root):
            key = path.relative_to(root).as_posix()
            if media_path(root, key).parent != path.parent.resolve():
                continue
            found.add(key)
            if key in referenced:
                OrphanedMedia.objects.filter(storage_key=key).delete()
                continue
            marker, _ = OrphanedMedia.objects.get_or_create(storage_key=key)
            if marker.first_seen <= now - timedelta(days=7):
                path.unlink()
                marker.delete()
                deleted.append(key)
        OrphanedMedia.objects.exclude(storage_key__in=found).delete()
    finally:
        release_maintenance_lock(root, descriptor)
    return deleted
