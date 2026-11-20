"""扩展发行清单与仅含当前账号整理选项的设备专用接口。"""
import json

from django.conf import settings
from django.views.decorators.csrf import csrf_exempt

from workspace.http import ApiError, api
from workspace.icons import icon_quota_used
from workspace.media import quota_used
from workspace.models import Category, Collection


@csrf_exempt
@api(['GET'], public=True, rate=60)
def release(request):
    path = settings.BASE_DIR / 'extension' / 'release.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        raise ApiError('扩展发行清单尚未准备好', 'extension_unavailable', 503)
    allowed = {'version', 'releasedAt', 'sizeBytes', 'sha256', 'downloadPath',
               'minBrowserVersion', 'protocolRange', 'releaseNotes'}
    return {key: value for key, value in data.items() if key in allowed}


@csrf_exempt
@api(['GET'], bearer=True, rate=60)
def options(request):
    return {'categories': list(Category.objects.filter(owner=request.user).values_list('name', flat=True)),
            'collections': list(Collection.objects.filter(owner=request.user).values('id', 'name')),
            'previewQuota': {'usedBytes': quota_used(request.user), 'limitBytes': settings.PREVIEW_QUOTA_BYTES},
            'iconQuota': {'usedBytes': icon_quota_used(request.user), 'limitBytes': settings.ICON_QUOTA_BYTES},
            'capabilities': {'protocol': 2, 'explicitUpdate': True, 'previewAttachments': True,
                             'iconAttachments': True, 'notes': True, 'appendNotes': True,
                             'fields': ['description', 'notes', 'category', 'tags', 'collections', 'pinned', 'later']}}
