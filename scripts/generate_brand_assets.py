"""从同一 SVG 源生成扩展 PNG；仅在开发机使用本机 Chrome/Edge 渲染。"""
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


def browser_executable(explicit=None):
    candidates = [explicit, shutil.which('chrome'), shutil.which('msedge')]
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        base = Path(__import__('os').environ.get(variable, ''))
        candidates.extend((base / 'Google/Chrome/Application/chrome.exe',
                           base / 'Microsoft/Edge/Application/msedge.exe'))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise FileNotFoundError('请用 --browser 指定本机 Chrome 或 Edge；服务器无需执行此脚本')


def generate(root, browser):
    source = (root / 'docs/brand/workspace-mark.svg').resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    with tempfile.TemporaryDirectory(prefix='.brand-', dir=root / '.local') as temporary:
        temporary = Path(temporary)
        for size in (16, 32, 48, 128):
            target = root / 'extension/icons' / f'icon-{size}.png'
            html = temporary / f'{size}.html'
            html.write_text('<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}'
                f'img{{display:block;width:{size}px;height:{size}px}}</style><img src="{source.as_uri()}">',
                encoding='utf-8')
            subprocess.run([str(browser), '--headless=new', '--disable-gpu', '--hide-scrollbars',
                '--force-device-scale-factor=1', '--default-background-color=00000000',
                f'--user-data-dir={temporary / "profile"}', f'--screenshot={target}',
                f'--window-size={size},{size}', html.as_uri()], check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
            with Image.open(target) as image:
                if image.size != (size, size):
                    raise ValueError(f'Unexpected icon dimensions: {image.size}')
            print(f'{target.name}: {target.stat().st_size} bytes')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--browser', type=Path)
    arguments = parser.parse_args()
    generate(arguments.root.resolve(), browser_executable(arguments.browser))


if __name__ == '__main__':
    main()
