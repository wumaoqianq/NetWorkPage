"""一致 SQLite 快照、流式认证加密及不会覆写生产库的独立恢复工具。"""

import argparse
import os
import re
import sqlite3
import sys
import tempfile
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import InvalidToken

if __package__:
    from .backup_crypto import decode_key, decrypt_file, encrypt_file, validate_budget
    from .media_backup import MAGIC, create_container, restore_container
else:
    from backup_crypto import decode_key, decrypt_file, encrypt_file, validate_budget
    from media_backup import MAGIC, create_container, restore_container

MAX_BYTES = 1024 * 1024 * 1024
NAME_PATTERN = re.compile(r"ww-backup-(\d{8}T\d{12}Z)-[0-9a-f]{8}\.sqlite3\.(?:wwb|fernet)")


def load_environment(path):
    """只接受 KEY=value 数据；绝不执行 env 文件或把密钥送进命令参数。"""
    if not path:
        return
    for raw in Path(path).read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            raise ValueError("Invalid environment file format")
        os.environ.setdefault(name, value.strip().strip("\"'"))


def private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Backup directory must not be a symlink")
    path.chmod(0o700)
    return path.resolve()


def validate_sqlite(path):
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("SQLite integrity check failed")


def create_backup(database, directory, key, *, now=None, max_bytes=MAX_BYTES, media_root=None):
    """backup API 包含 WAL 已提交数据；可选媒体与快照使用同一版本化容器。"""
    database = Path(database).resolve(strict=True)
    validate_budget(max_bytes)
    decode_key(key)
    directory = private_directory(directory)
    now = now or datetime.now(timezone.utc)
    timestamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = directory / f"ww-backup-{timestamp}-{uuid.uuid4().hex[:8]}.sqlite3.wwb"
    with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=directory) as temporary:
        snapshot = Path(temporary) / "snapshot.sqlite3"
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source:
            page_size = source.execute("PRAGMA page_size").fetchone()[0]
            if source.execute("PRAGMA page_count").fetchone()[0] * page_size > max_bytes:
                raise ValueError("Database exceeds configured backup disk budget")

            # 在线库增长时也中断快照，避免在完整复制后才发现超出磁盘预算。
            def enforce_budget(status, remaining, total):
                if total * page_size > max_bytes or snapshot.stat().st_size > max_bytes:
                    raise ValueError("Snapshot exceeds configured backup disk budget")

            with closing(sqlite3.connect(snapshot)) as destination:
                source.backup(destination, pages=256, progress=enforce_budget, sleep=0.05)
        validate_sqlite(snapshot)
        if snapshot.stat().st_size > max_bytes:
            raise ValueError("Snapshot exceeds configured backup disk budget")
        pending = Path(temporary) / "encrypted.pending"
        if media_root is None:
            encrypt_file(snapshot, pending, key, max_bytes)
        else:
            container = Path(temporary) / "container.zip"
            create_container(snapshot, Path(media_root), container, max_bytes)
            encrypt_file(container, pending, key, max_bytes)
        # 同卷硬链接只在完整写入之后发布，已存在目标会失败，保留策略看不到半成品。
        os.link(pending, output)
    return output


def restore_backup(source, target, key, *, max_bytes=MAX_BYTES, media_root=None):
    """先认证密文并独立检验，再用独占创建模式写入新目标，拒绝原地覆盖。"""
    source, target = Path(source), Path(target)
    if target.exists() or target.is_symlink():
        raise FileExistsError("Restore destination already exists")
    validate_budget(max_bytes)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".restore-", dir=target.parent) as temporary:
        candidate = Path(temporary) / "candidate.sqlite3"
        decrypt_file(source, candidate, key, max_bytes)
        with candidate.open('rb') as stream:
            container = stream.read(4) == MAGIC
        if container:
            restore_container(candidate, target, media_root)
        else:
            validate_sqlite(candidate.resolve())
            # 完整检验后才发布；硬链接原子拒绝已存在目标，失败不会留下半成品。
            os.link(candidate, target)
    return target


def prune_backups(directory, daily=7, weekly=4):
    """保留最近 7 个 UTC 日与最近 4 个 ISO 周的各最新一份；仅删除严格命名文件。"""
    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError("Retention directory must not be a symlink")
    directory = directory.resolve(strict=True)
    candidates = []
    for path in directory.iterdir():
        match = NAME_PATTERN.fullmatch(path.name)
        if not match or path.is_symlink() or not path.is_file():
            continue
        if path.resolve().parent != directory:
            continue
        try:
            timestamp = datetime.strptime(match[1], "%Y%m%dT%H%M%S%fZ")
        except ValueError:
            continue
        candidates.append((timestamp, path))
    keep, days, weeks = set(), set(), set()
    for timestamp, path in sorted(candidates, reverse=True):
        day, week = timestamp.date(), timestamp.isocalendar()[:2]
        if day not in days and len(days) < daily:
            keep.add(path)
            days.add(day)
        if week not in weeks and len(weeks) < weekly:
            keep.add(path)
            weeks.add(week)
    deleted = []
    for _, path in candidates:
        if path not in keep:
            path.unlink()
            deleted.append(path)
    return deleted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("--database", type=Path)
    create.add_argument("--directory", type=Path)
    create.add_argument("--max-bytes", type=int)
    create.add_argument("--media-directory", type=Path)
    restore = commands.add_parser("restore")
    restore.add_argument("source", type=Path)
    restore.add_argument("target", type=Path)
    restore.add_argument("--max-bytes", type=int)
    restore.add_argument("--media-directory", type=Path)
    arguments = parser.parse_args()
    load_environment(arguments.env_file)
    key = os.environ.get("BACKUP_KEY", "").encode("ascii")
    if not key:
        parser.error("BACKUP_KEY is required (environment or protected --env-file)")
    max_bytes = arguments.max_bytes if arguments.max_bytes is not None else int(os.environ.get("BACKUP_MAX_BYTES", MAX_BYTES))
    validate_budget(max_bytes)
    if arguments.command == "create":
        data = Path(os.environ.get("DATA_DIR", "/var/lib/website-workspace"))
        output = create_backup(arguments.database or data / "workspace.sqlite3",
                               arguments.directory or data / "backups", key, max_bytes=max_bytes,
                               media_root=arguments.media_directory or data / 'media')
        removed = prune_backups(output.parent)
        print(f"Encrypted backup created: {output.name}; retained policy applied ({len(removed)} removed)")
    else:
        restore_backup(arguments.source, arguments.target, key, max_bytes=max_bytes,
                       media_root=arguments.media_directory or arguments.target.parent / (arguments.target.name + '.media'))
        print("Restore verified into a new file; production database was not replaced")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, sqlite3.Error, InvalidToken):
        print("Backup operation failed; check paths, key, SQLite integrity and disk budget", file=sys.stderr)
        sys.exit(1)
