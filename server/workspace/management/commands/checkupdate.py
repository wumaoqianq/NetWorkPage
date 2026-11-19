"""检查是否有可用更新（只读，不动数据与服务）。"""
import json
import time
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from workspace import release_manifest, upgrade

CACHE_SECONDS = 6 * 60 * 60


def cache_path():
    return Path(settings.DATA_DIR) / 'update-cache.json'


def load_cache():
    try:
        data = json.loads(cache_path().read_text(encoding='utf-8'))
        if time.time() - float(data.get('checkedAtEpoch', 0)) < CACHE_SECONDS:
            return data
    except (OSError, ValueError, TypeError):
        pass
    return None


def save_cache(payload):
    payload = dict(payload, checkedAtEpoch=time.time(),
                   checkedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    try:
        cache_path().write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    except OSError:
        pass
    return payload


class Command(BaseCommand):
    help = '检查 GitHub Release 是否有可用更新（稳定轨道默认忽略预发布）'

    def add_arguments(self, parser):
        parser.add_argument('--track', choices=('stable', 'prerelease'),
                            default=upgrade.release_track())
        parser.add_argument('--refresh', action='store_true', help='忽略缓存重新检查')
        parser.add_argument('--json', action='store_true', help='输出 JSON')

    def handle(self, *args, **options):
        track = options['track']
        current = upgrade.current_version()
        cached = None if options['refresh'] else load_cache()
        if cached and cached.get('track') == track and cached.get('current') == current:
            result = cached
            result['cached'] = True
        else:
            try:
                releases = release_manifest.fetch_releases(upgrade.release_repo())
            except Exception as exc:  # noqa: BLE001 - 上游不可用不应影响本地功能
                result = {'status': 'unavailable', 'current': current, 'track': track,
                          'error': f'{type(exc).__name__}: {exc}'[:300],
                          'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
                save_cache(result)
            else:
                picked = release_manifest.pick_update(current, releases, track)
                result = {'status': 'update' if picked else 'current',
                          'current': current, 'track': track,
                          'latest': picked or None,
                          'repo': upgrade.release_repo(),
                          'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
                save_cache(result)
            result['cached'] = False

        if options['json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
            return
        self.stdout.write(f'当前版本: {result.get("current")}  轨道: {track}')
        self.stdout.write(f'检查时间: {result.get("checkedAt")}'
                          f'{"（缓存）" if result.get("cached") else ""}')
        if result.get('status') == 'update':
            latest = result['latest']
            self.stdout.write(self.style.SUCCESS(
                f'可用版本: {latest["version"]} (tag {latest["tag"]})　发布: {latest.get("publishedAt", "")}'))
            self.stdout.write(f'发布说明: {latest.get("url", "")}')
            self.stdout.write(f'预检: manage.py upgrade --release-version {latest["version"]} --precheck')
        elif result.get('status') == 'current':
            self.stdout.write(self.style.SUCCESS('已是最新版本，无需升级。'))
        else:
            self.stdout.write(self.style.WARNING(
                f'上游暂不可用（不影响登录/收藏/同步）: {result.get("error", "")}'))
            raise CommandError('上游暂不可用')
