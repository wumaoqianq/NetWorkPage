"""本机轻量任务调度器：周期性调用 `manage.py runjobs`，把公开图标 Job 排队后真正执行。

- 生产：复用 deploy/website-workspace-jobs.timer 的 runjobs --limit 10（无常驻进程）。
- 本机（Windows/回环 4173）：用本脚本起一个有明确日志/PID/stop-file 进程控制的短循环，
  通过 .local/manual-test-server.py 转发到同一 SQLite 库，绝不另建数据库、不常驻 Node/Redis。
- 每次循环只做一次有界 runjobs（默认 limit 4、单次超时 90s），stdout/stderr 追加到 jobs.log。
- 停止：在 DATA_DIR 放 jobs.stop 文件，或直接向进程发终止；PID 写入 jobs.pid。

用法（在仓库根，用仓库 venv 的 python）：
  .venv/Scripts/python.exe scripts/local_jobs.py once          # 单次执行并打印结果（可验证调度）
  .venv/Scripts/python.exe scripts/local_jobs.py loop --interval 20 --max-cycles 0  # 常驻循环(0=不限,靠 stop 文件停)
所有外网抓取边界由 favicons/runjobs 自己负责；本脚本不碰 DNS/代理/证书。
"""
import argparse
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / '.local' / 'manual-test-server.py'


def env_paths():
    data = ROOT / '.local' / 'manual-test'
    return {
        'data': data,
        'log': data / 'jobs.log',
        'pid': data / 'jobs.pid',
        'stop': data / 'jobs.stop',
    }


def run_cycle(python, limit, timeout, log):
    """一次有界 runjobs；返回 (returncode, stdout_text)。输出同时进日志与返回值。"""
    command = [python, str(LAUNCHER), 'runjobs', '--limit', str(limit)]
    stamp = datetime.now(timezone.utc).isoformat()
    with log.open('a', encoding='utf-8') as stream:
        stream.write(f'[{stamp}] cycle start limit={limit}\n')
        stream.flush()
        try:
            proc = subprocess.run(command, cwd=str(ROOT / 'server'), stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, timeout=timeout)
            out = (proc.stdout or '').strip()
            rc = proc.returncode
        except subprocess.TimeoutExpired as exc:
            out = (exc.stdout or b'').decode('utf-8', 'replace') if isinstance(exc.stdout, bytes) else (exc.stdout or '')
            out = out.strip() + ' [TIMEOUT]'
            rc = 124
        stream.write((out or '(no output)') + '\n')
        stream.write(f'[{datetime.now(timezone.utc).isoformat()}] cycle end rc={rc}\n')
        stream.flush()
    return rc, out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    sub.add_parser('once', help='单次执行 runjobs 并打印结果')
    loop = sub.add_parser('loop', help='周期性循环，靠 jobs.stop 停止')
    loop.add_argument('--interval', type=int, default=20, help='每次循环间隔秒数（默认 20）')
    loop.add_argument('--max-cycles', type=int, default=0, help='最多循环次数，0=不限（默认 0）')
    parser.add_argument('--limit', type=int, default=4, help='单次 runjobs 处理上限（默认 4）')
    parser.add_argument('--timeout', type=int, default=90, help='单次 runjobs 超时秒数（默认 90）')
    args = parser.parse_args()

    if not LAUNCHER.exists():
        print(f'launcher missing: {LAUNCHER}', file=sys.stderr)
        return 2
    paths = env_paths()
    paths['data'].mkdir(parents=True, exist_ok=True)
    python = sys.executable

    if args.mode == 'once':
        rc, out = run_cycle(python, args.limit, args.timeout, paths['log'])
        print(out)
        return rc

    paths['pid'].write_text(str(__import__('os').getpid()), encoding='utf-8')
    paths['stop'].unlink(missing_ok=True)
    cycles = 0
    try:
        while not paths['stop'].exists():
            rc, out = run_cycle(python, args.limit, args.timeout, paths['log'])
            cycles += 1
            if args.max_cycles and cycles >= args.max_cycles:
                break
            # 分段睡眠，及时响应 stop 文件
            for _ in range(max(1, args.interval)):
                if paths['stop'].exists():
                    break
                time.sleep(1)
    finally:
        paths['pid'].unlink(missing_ok=True)
        with paths['log'].open('a', encoding='utf-8') as stream:
            stream.write(f'[{datetime.now(timezone.utc).isoformat()}] scheduler stopped cycles={cycles}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
