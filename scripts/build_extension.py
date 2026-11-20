"""先检查扩展，再生成不可变 ZIP、SHA-256 和受白名单约束的发行清单。"""
import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

RUNTIME_FILES = [
    'manifest.json', 'popup.html', 'popup.js', 'popup-preview.js', 'popup-form.js', 'popup-tasks.js',
    'options.html', 'options.js', 'styles.css', 'ui.js', 'queue.js', 'engine.js', 'api.js',
    'service-worker.js', 'attachment-store.js', 'asset-attach.js', 'screenshot.js', 'page-data.js',
    'automatic-assets.js', 'site-icon.js', 'icon-format.js', 'icon-tasks.js', 'icon-task-runner.js', 'icon-page-capture.js', 'asset-jobs-runner.js', 'engine-assets.js', 'engine-repair.js', 'preferences.js',
    'bookmarks.html', 'bookmarks-page.js', 'bookmark-data.js', 'bookmark-engine.js',
    # 阶段 B：普通扩展收藏表单 + 单一权威 Outbox + 迁移（旧模块保留作数据备份/兼容，不加载）
    'capture.html', 'capture.css', 'capture.js',
    'outbox-store.js', 'outbox.js', 'outbox-model.js', 'migration.js', 'migration-run.js', 'workspace.js',
    # 阶段 C：短窗口采集 + 页面内压缩 + 独立 revision 条件上传
    'capture-entry.js', 'capture-compress.js', 'asset-upload.js', 'asset-manager.js',
    # 1.10.0：工具栏小弹窗 + 后台 OffscreenCanvas 压缩兜底
    'popup.css', 'worker-compress.js', 'raw-preview.js', 'workspace-presence.js',
    'README.md', 'icons/PHOSPHOR-LICENSE.txt',
    'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png',
]


def build_extension(root, run_checks=False):
    root = Path(root).resolve()
    extension = root / 'extension'
    if run_checks:
        executable = 'npm.cmd' if os.name == 'nt' else 'npm'
        for arguments in (('test',), ('run', 'check')):
            subprocess.run((executable, '--prefix', str(extension), *arguments), cwd=root, check=True)
    manifest = json.loads((extension / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    output = extension / 'dist'
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'website-workspace-extension-{version}.zip'
    temporary = output / f'.{archive.name}.pending'
    temporary.unlink(missing_ok=True)
    newest = 0
    with zipfile.ZipFile(temporary, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in RUNTIME_FILES:
            path = extension / name
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(extension):
                raise FileNotFoundError(f'Missing or unsafe extension runtime file: {name}')
            content = path.read_bytes()
            newest = max(newest, path.stat().st_mtime)
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, content)
    digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
    os.replace(temporary, archive)
    release = {'version': version,
        'releasedAt': datetime.fromtimestamp(newest, timezone.utc).isoformat(),
        'sizeBytes': archive.stat().st_size, 'sha256': digest,
        'downloadPath': '/downloads/website-workspace-extension.zip',
        'minBrowserVersion': manifest['minimum_chrome_version'], 'protocolRange': {'min': 1, 'max': 2},
        'releaseNotes': '1.10.0 交互修正候选（未全面验收）：恢复工具栏小弹窗，点击不打开新标签页、留在当前网页；弹窗显示当前页截图预览（正在截图/截图已就绪/截图不可用三态），截图失败仍可保存并明确说明「这次未附截图」；工作台保留 Logo 紧凑卡片与「查看截图」按钮，大图查看器支持适应窗口/原尺寸/缩放且重开工作台仍可看图。弹窗只负责交互，后台继续使用单一 IndexedDB Outbox：文字草稿+原始截图 Blob+图标 Blob 同一个 captureId 一次性事务落盘，关闭弹窗后继续同步；原始快照有界 8MB（修复内容丰富的 2560×1440 页面被 700KB 静默丢弃的真实缺图），弹窗 DOM/canvas 或后台 OffscreenCanvas 压缩成有界 WebP 后原子清除；submitDraft 不再丢弃仍为 raw 的截图。重新截图只在仍能确认原标签与权限时进行，不拿切换后的页面凑数；图标慢或失败不阻塞保存；保留后台自动补图、断网续传、账号隔离与素材冲突保护。正式 Edge Add-ons 发行仅准备资料、未发布。此前 1.9.0 阶段 D 候选（未全面验收）：缺图且用户未拒绝时，服务端在文字收藏同事务登记唯一公开图标 Job，HTTP 立即返回不等待外网抓取；run_icon_jobs 有界串行（单次 4 项、单任务最多 3 次退避、租约防并发），复用 favicons 每跳公网 DNS/端口/重定向/字节/像素/时间预算、CDN 候选与 ICO/PNG 解码、SVG 终态降级，只填空不覆盖客户端上传/用户自定义图标，基线变化取消、迟到结果保留现有图。生产复用现有 systemd timer 的 runjobs，本机 scripts/local_jobs.py 提供带 jobs.log/jobs.pid/jobs.stop 进程控制的短循环、调用同一 SQLite 库，不另建库、不常驻 Node/Redis。扩展不再维护重复的服务器兜底排程；表单显示「已入库，图标获取中」并可拒绝自动补图，服务器受阻时浏览器已合法取得的同源 PNG 仍条件写上传，失败有限重试后明确缺图。卡片详情提供「重新排队补图」与高级本地 PNG/WebP 上传例外恢复，普通收藏不需手工补图。正式 Edge Add-ons 发行仅准备资料（docs/extension-store-readiness.md），未发布、不制造商店链接、不承诺审核。此为阶段 D 候选，不宣称全面验收完成。',
        'packagePath': f'dist/{archive.name}', 'files': RUNTIME_FILES}
    if version == '1.10.1':
        release['releaseNotes'] = '修复站内 ZIP 下载；工作台可检测当前浏览器是否启用扩展，不读取配对信息。旧版请在原目录覆盖并重新加载，刷新工作台后再检测。收藏、截图、图标和离线队列沿用原有流程。'
    manifest_path = extension / 'release.json'
    pending_manifest = extension / '.release.json.pending'
    pending_manifest.write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(pending_manifest, manifest_path)
    return archive, release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    arguments = parser.parse_args()
    archive, release = build_extension(arguments.root, run_checks=True)
    print(f'Extension created: {archive.name}')
    print(f"SHA256: {release['sha256']}")


if __name__ == '__main__':
    main()
