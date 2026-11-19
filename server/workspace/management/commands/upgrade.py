"""执行在线升级：先预检（不动线上），再按阶段停写、备份验证、迁移、切换、健康检查。

只能由管理员在服务器执行（需要切换 current 符号链接与操作 systemd），Web 进程不提供升级入口。
"""
import json

from django.core.management.base import BaseCommand, CommandError

from workspace import release_manifest, upgrade


class Command(BaseCommand):
    help = '预检或执行到指定版本的在线升级（保留数据库、媒体、账号、配对与配置）'

    def add_arguments(self, parser):
        parser.add_argument('--release-version', required=True, help='目标版本，如 1.10.0-rc.3')
        parser.add_argument('--precheck', action='store_true', help='只做预检，不动线上数据或服务')
        parser.add_argument('--backup', help='复用已有加密备份路径（默认现做一份并验证）')
        parser.add_argument('--json', action='store_true')

    def handle(self, *args, **options):
        version = options['release_version'].lstrip('v')
        try:
            release_manifest.parse_version(version)
        except release_manifest.ManifestError as exc:
            raise CommandError(str(exc)) from exc
        if version == upgrade.current_version():
            raise CommandError(f'当前已经是 {version}，无需升级')

        if options['precheck']:
            notes = upgrade.precheck(version)
            if options['json']:
                self.stdout.write(json.dumps(notes, ensure_ascii=False, indent=2))
                return
            self.stdout.write(self.style.SUCCESS('预检通过（未改动线上数据或服务）'))
            self.stdout.write(f'当前版本: {notes["currentVersion"]} -> 目标: {notes["version"]}')
            self.stdout.write(f'tag {notes["tag"]}  commit {notes["commit"]}  轨道 {notes["track"]}')
            self.stdout.write(f'扩展版本: {notes["extensionVersion"]}（已校验服务包内嵌 ZIP 与清单同字节）')
            for asset in notes['assets']:
                self.stdout.write(f'  资产 {asset["name"]} {asset["bytes"]} B sha256={asset["sha256"][:16]}…')
            self.stdout.write(f'暂存目录: {notes["staging"]}')
            self.stdout.write('执行升级: manage.py upgrade --release-version ' + version)
            return

        self.stdout.write(f'开始升级 {upgrade.current_version()} -> {version}（进入维护窗口）')
        try:
            result = upgrade.apply(version, backup_file=options['backup'])
        except release_manifest.ManifestError as exc:
            raise CommandError(f'清单/签名/资产校验失败，未改动线上: {exc}') from exc
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f'升级失败：{exc}') from exc
        if options['json']:
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
            return
        self.stdout.write(self.style.SUCCESS(
            f'升级完成: {result["previous"]} -> {result["version"]}'))
        self.stdout.write(f'备份: {result["backup"]}')
        self.stdout.write(f'试恢复校验: {result["restoreProbe"]}')
        self.stdout.write(f'已恢复定时器: {", ".join(result["timers"]) or "无"}')
        self.stdout.write('状态: ' + json.dumps(upgrade.read_state(), ensure_ascii=False))
