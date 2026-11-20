"""工作台只读展示升级信息：当前版本、可用版本、检查时间、最近升级状态（管理员可见）。"""
from workspace import upgrade
from workspace.http import api
from workspace.management.commands.checkupdate import load_cache


@api(['GET'], admin=True)
def status(request):
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
            'writesReopened': bool(state.get('writesReopened')),
            'timerFailures': state.get('timerFailures', []),
        },
        'lastCheck': None,
        'available': None,
        'upstream': 'unknown',
        'commands': {
            'check': 'sudo /opt/website-workspace/current/.venv/bin/python /opt/website-workspace/current/scripts/manage_env.py --env-file /etc/website-workspace.env checkupdate --refresh',
        },
    }
    cached = load_cache(track=payload['track'], current=payload['currentVersion'], repo=payload['repo'])
    if cached:
        payload['lastCheck'] = cached.get('checkedAt')
        payload['upstream'] = cached.get('status', 'unknown')
        payload['available'] = cached.get('latest')
    return payload
