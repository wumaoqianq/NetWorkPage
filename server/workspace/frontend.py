from pathlib import Path
from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.utils._os import safe_join
from django.core.exceptions import SuspiciousFileOperation


def frontend(request, path=''):
    if path.startswith(('api/', 'downloads/')):
        return JsonResponse({'error': '接口不存在', 'code': 'not_found'}, status=404)
    root = settings.FRONTEND_ROOT
    try:
        target = Path(safe_join(root, path)) if path else root / 'index.html'
    except SuspiciousFileOperation:
        return JsonResponse({'error': '文件不存在', 'code': 'not_found'}, status=404)
    if not target.is_file():
        target = root / 'index.html'
    if not target.is_file():
        return JsonResponse({'error': '前端尚未构建，请先运行前端构建', 'code': 'frontend_missing'}, status=503)
    response = FileResponse(target.open('rb'))
    response['Cache-Control'] = 'public, max-age=31536000, immutable' if path.startswith('assets/') else 'no-cache'
    return response
