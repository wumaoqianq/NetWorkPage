"""工作台只读展示升级信息：当前版本、可用版本、检查时间、最近升级状态（管理员可见）。"""
from django.conf import settings

from workspace import release_manifest, upgrade
from workspace.http import api, ApiError


@api(['GET'])
def status(request):
    if not request.user.is_staff:
        raise ApiError('需要管理员权限', 'forbidden', 403)
    state = upgrade.read_state()
    payload = {
        'currentVersion': upgrade.current_version(),
        'track': upgrade.release_track(),
        'repo': upgrade.release_repo(),
        'maintenance': upgrade.is_maintenance(),
        'lastUpgrade': {
            'stage': state.get('stage', ''),
            'target': state.get('target', ''),
            'previous': state.get('previous', ''),
            'updatedAt': state.get('updatedAt', ''),
            'backup': state.get('backup', ''),
            'error': state.get('error', ''),
            'writesReopened': bool(state.get('writesReopened')),
        },
        'lastCheck': None,
        'available': None,
        'upstream': 'unknown',
        'commands': {
            'check': 'manage.py checkupdate --track stable',
            'precheck': 'manage.py upgrade --release-version <版本> --precheck',
            'upgrade': 'manage.py upgrade --release-version <版本>',
        },
    }
    try:
        from workspace.management.commands.checkupdate import load_cache
        cached = load_cache()
    except Exception:  # noqa: BLE001 - 缓存读取失败不影响只读展示
        cached = None
    if cached:
        payload['lastCheck'] = cached.get('checkedAt')
        payload['upstream'] = cached.get('status', 'unknown')
        payload['available'] = cached.get('latest')
    return payload
