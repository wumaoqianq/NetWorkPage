import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from scripts import backup


class MediaBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.key = Fernet.generate_key()
        self.database = self.root / 'workspace.sqlite3'
        self.media = self.root / 'media'
        (self.media / '1').mkdir(parents=True)
        (self.media / '1' / 'asset-full.webp').write_bytes(b'private-image-full')
        (self.media / '1' / 'asset-thumb.webp').write_bytes(b'private-image-thumb')
        (self.media / '1' / 'asset-icon.webp').write_bytes(b'private-site-icon')
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute('CREATE TABLE workspace_previewasset (storage_key TEXT, thumbnail_key TEXT)')
            connection.execute("INSERT INTO workspace_previewasset VALUES ('1/asset-full.webp', '1/asset-thumb.webp')")
            connection.execute('CREATE TABLE workspace_siteiconasset (storage_key TEXT)')
            connection.execute("INSERT INTO workspace_siteiconasset VALUES ('1/asset-icon.webp')")
            connection.execute('CREATE TABLE notes (content TEXT)')
            connection.execute("INSERT INTO notes VALUES ('snapshot-marker')")
            connection.commit()

    def tearDown(self):
        self.temporary.cleanup()

    def test_media_container_roundtrip_verifies_database_and_images(self):
        encrypted = backup.create_backup(self.database, self.root / 'backups', self.key, media_root=self.media)
        self.assertNotIn(b'private-image-full', encrypted.read_bytes())
        target = self.root / 'restored.sqlite3'
        restored_media = self.root / 'restored-media'
        backup.restore_backup(encrypted, target, self.key, media_root=restored_media)
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute('SELECT content FROM notes').fetchone()[0], 'snapshot-marker')
        for name in ('asset-full.webp', 'asset-thumb.webp', 'asset-icon.webp'):
            original = (self.media / '1' / name).read_bytes()
            restored = (restored_media / '1' / name).read_bytes()
            self.assertEqual(hashlib.sha256(restored).digest(), hashlib.sha256(original).digest())
        self.assertFalse((self.media / '.maintenance.lock').exists())

    def test_missing_referenced_media_aborts_without_backup(self):
        (self.media / '1' / 'asset-full.webp').unlink()
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, self.root / 'backups', self.key, media_root=self.media)
        self.assertFalse(any((self.root / 'backups').glob('*.wwb')))
        self.assertFalse((self.media / '.maintenance.lock').exists())

    def test_container_tampering_publishes_neither_database_nor_media(self):
        encrypted = backup.create_backup(self.database, self.root / 'backups', self.key, media_root=self.media)
        content = bytearray(encrypted.read_bytes())
        content[-1] ^= 1
        encrypted.write_bytes(content)
        target = self.root / 'tampered.sqlite3'
        with self.assertRaises(InvalidToken):
            backup.restore_backup(encrypted, target, self.key, media_root=self.root / 'tampered-media')
        self.assertFalse(target.exists())
        self.assertFalse((self.root / 'tampered-media').exists())

    def test_database_and_media_share_the_disk_budget(self):
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, self.root / 'backups', self.key,
                media_root=self.media, max_bytes=self.database.stat().st_size + 2)
        self.assertFalse(any((self.root / 'backups').glob('*.wwb')))

    def test_old_single_database_backup_does_not_create_media_directory(self):
        encrypted = backup.create_backup(self.database, self.root / 'backups', self.key)
        target = self.root / 'legacy.sqlite3'
        backup.restore_backup(encrypted, target, self.key)
        self.assertTrue(target.exists())
        self.assertFalse((self.root / 'legacy.sqlite3.media').exists())


if __name__ == '__main__':
    unittest.main()
