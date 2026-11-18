import hashlib
import json
from django.conf import settings
from django.http import FileResponse
from workspace.http import api, ApiError


@api(['GET'])
def extension_zip(request):
    root = (settings.BASE_DIR / 'extension').resolve()
    try:
        release = json.loads((root / 'release.json').read_text(encoding='utf-8'))
        path = (root / release['packagePath']).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.is_symlink():
            raise ValueError()
        if path.stat().st_size != release['sizeBytes']:
            raise ValueError()
        with path.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != release['sha256']:
                raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise ApiError('扩展包或发行清单尚未准备好', 'extension_unavailable', 503)
    response = FileResponse(path.open('rb'), as_attachment=True,
                            filename='website-workspace-extension.zip', content_type='application/zip')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
