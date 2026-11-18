"""版本 2 备份容器：SQLite 快照及该快照引用的全部媒体与摘要。"""
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path, PurePosixPath

MAGIC = b'PK\x03\x04'


def digest_stream(stream):
    return hashlib.file_digest(stream, 'sha256').hexdigest()


def digest_path(path):
    with Path(path).open('rb') as stream:
        return digest_stream(stream)


def referenced_keys(snapshot):
    with closing(sqlite3.connect(snapshot.as_uri() + '?mode=ro', uri=True)) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        rows = []
        if 'workspace_previewasset' in tables:
            rows.extend(connection.execute('SELECT storage_key, thumbnail_key FROM workspace_previewasset').fetchall())
        if 'workspace_siteiconasset' in tables:
            rows.extend(connection.execute('SELECT storage_key, NULL FROM workspace_siteiconasset').fetchall())
    return sorted({key for row in rows for key in row if key})


def managed_file(root, key):
    if not isinstance(key, str) or PurePosixPath(key).is_absolute() or '..' in PurePosixPath(key).parts:
        raise ValueError('Unsafe media key in database snapshot')
    path = (root / key).resolve()
    if not path.is_relative_to(root) or path.is_symlink() or not path.is_file():
        raise ValueError('Referenced media is missing or unsafe')
    return path


def maintenance_lock(root):
    root.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(root / '.maintenance.lock', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return descriptor


def create_container(snapshot, media_root, target, max_bytes=None):
    root = Path(media_root).resolve()
    descriptor = maintenance_lock(root)
    try:
        keys = referenced_keys(Path(snapshot))
        media = []
        total = snapshot.stat().st_size
        for key in keys:
            path = managed_file(root, key)
            total += path.stat().st_size
            if max_bytes is not None and total > max_bytes:
                raise ValueError('Database and media exceed configured backup disk budget')
            with path.open('rb') as stream:
                media.append({'key': key, 'bytes': path.stat().st_size, 'sha256': digest_stream(stream)})
        with snapshot.open('rb') as stream:
            database = {'bytes': snapshot.stat().st_size, 'sha256': digest_stream(stream)}
        manifest = {'format': 'website-workspace-backup', 'version': 2, 'database': database, 'media': media}
        with zipfile.ZipFile(target, 'x', zipfile.ZIP_STORED) as bundle:
            bundle.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
            bundle.write(snapshot, 'database.sqlite3')
            for item in media:
                bundle.write(managed_file(root, item['key']), 'media/' + item['key'])
                if max_bytes is not None and target.stat().st_size > max_bytes:
                    raise ValueError('Backup container exceeds configured disk budget')
    finally:
        os.close(descriptor)
        (root / '.maintenance.lock').unlink(missing_ok=True)


def verify_member(bundle, name):
    with bundle.open(name) as stream:
        return digest_stream(stream), stream.tell()


def restore_container(payload, target, media_root):
    if media_root is None:
        raise ValueError('This backup contains media; a new media restore directory is required')
    media_target = Path(media_root)
    if media_target.exists() or media_target.is_symlink():
        raise FileExistsError('Media restore destination already exists')
    with zipfile.ZipFile(payload) as bundle:
        if bundle.getinfo('manifest.json').file_size > 1024 * 1024:
            raise ValueError('Backup manifest is too large')
        manifest = json.loads(bundle.read('manifest.json'))
        if manifest.get('format') != 'website-workspace-backup' or manifest.get('version') != 2:
            raise ValueError('Unsupported backup container')
        media = manifest.get('media')
        if not isinstance(media, list):
            raise ValueError('Invalid media manifest')
        expected = {'manifest.json', 'database.sqlite3'} | {'media/' + item['key'] for item in media}
        if set(bundle.namelist()) != expected:
            raise ValueError('Backup container members do not match manifest')
        media_target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.restore-media-', dir=media_target.parent) as temporary:
            temporary = Path(temporary)
            candidate = temporary / 'candidate.sqlite3'
            (temporary / 'media').mkdir()
            with bundle.open('database.sqlite3') as source, candidate.open('xb') as destination:
                shutil.copyfileobj(source, destination, 1024 * 1024)
                destination.flush()
                os.fsync(destination.fileno())
            if candidate.stat().st_size != manifest['database']['bytes'] or digest_path(candidate) != manifest['database']['sha256']:
                raise ValueError('Database snapshot digest mismatch')
            for item in media:
                key = item['key']
                if not isinstance(key, str) or PurePosixPath(key).is_absolute() or '..' in PurePosixPath(key).parts:
                    raise ValueError('Unsafe media key in manifest')
                destination = temporary / 'media' / key
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open('media/' + key) as source, destination.open('xb') as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                if destination.stat().st_size != item['bytes'] or digest_path(destination) != item['sha256']:
                    raise ValueError('Media digest mismatch')
            with closing(sqlite3.connect(candidate.as_uri() + '?mode=ro', uri=True)) as connection:
                if connection.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('SQLite integrity check failed')
            os.link(candidate, target)
            try:
                os.rename(temporary / 'media', media_target)
            except Exception:
                target.unlink(missing_ok=True)
                raise
    return target
