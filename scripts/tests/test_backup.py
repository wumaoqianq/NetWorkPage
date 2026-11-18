"""真实 SQLite 与临时密钥覆盖备份的安全边界。"""

import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet, InvalidToken

from scripts import backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.database = self.root / "source.sqlite3"
        self.key = Fernet.generate_key()
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("CREATE TABLE notes (content TEXT)")
            connection.executemany("INSERT INTO notes VALUES (?)", [("private marker 机密",), ("second",)])
            connection.commit()

    def tearDown(self):
        self.temp.cleanup()

    def test_snapshot_encrypted_and_restore_preserves_content(self):
        path = backup.create_backup(self.database, self.root / "backups", self.key)
        self.assertNotIn(b"private marker", path.read_bytes())
        self.assertNotIn(b"SQLite format", path.read_bytes())
        target = self.root / "restored.sqlite3"
        backup.restore_backup(path, target, self.key)
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute("SELECT content FROM notes").fetchall(),
                             [("private marker 机密",), ("second",)])

    def test_wrong_key_creates_no_destination(self):
        path = backup.create_backup(self.database, self.root / "backups", self.key)
        target = self.root / "restored.sqlite3"
        with self.assertRaises(InvalidToken):
            backup.restore_backup(path, target, Fernet.generate_key())
        self.assertFalse(target.exists())

    def test_existing_destination_is_never_overwritten(self):
        path = backup.create_backup(self.database, self.root / "backups", self.key)
        with self.assertRaises(FileExistsError):
            backup.restore_backup(path, self.database, self.key)
        self.assertIn(b"private marker", self.database.read_bytes())

    def test_retention_keeps_daily_and_weekly_without_touching_other_files(self):
        directory = self.root / "backups"
        now = datetime(2026, 10, 25, tzinfo=timezone.utc)
        paths = [backup.create_backup(self.database, directory, self.key, now=now - timedelta(days=i))
                 for i in range(45)]
        unrelated = directory / "personal.sqlite3.fernet"
        unrelated.write_text("keep")
        deleted = backup.prune_backups(directory)
        survivors = {path for path in paths if path.exists()}
        self.assertTrue(set(paths[:7]).issubset(survivors))
        self.assertLessEqual(len(survivors), 11)
        weeks = {(now - timedelta(days=i)).isocalendar()[:2] for i, path in enumerate(paths)
                 if path in survivors}
        self.assertGreaterEqual(len(weeks), 4)
        self.assertTrue(unrelated.exists())
        self.assertEqual(len(deleted), 45 - len(survivors))

    def test_size_cap_rejects_without_leaving_plaintext_snapshot(self):
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, self.root / "backups", self.key, max_bytes=1)
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_missing_source_is_not_created(self):
        missing = self.root / "missing.sqlite3"
        with self.assertRaises(FileNotFoundError):
            backup.create_backup(missing, self.root / "backups", self.key)
        self.assertFalse(missing.exists())

    def test_wal_commits_are_included_in_consistent_snapshot(self):
        with closing(sqlite3.connect(self.database)) as live:
            live.execute("PRAGMA journal_mode=WAL")
            live.execute("INSERT INTO notes VALUES ('committed in WAL')")
            live.commit()
            path = backup.create_backup(self.database, self.root / "backups", self.key)
        target = self.root / "wal-restore.sqlite3"
        backup.restore_backup(path, target, self.key)
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM notes").fetchone()[0], 3)

    def test_tampered_ciphertext_fails_without_destination(self):
        path = backup.create_backup(self.database, self.root / "backups", self.key)
        content = bytearray(path.read_bytes())
        content[len(content) // 2] ^= 1
        path.write_bytes(content)
        target = self.root / "tampered.sqlite3"
        with self.assertRaises(InvalidToken):
            backup.restore_backup(path, target, self.key)
        self.assertFalse(target.exists())

    def test_retention_refuses_symlink_directory(self):
        outside = self.root / "outside"
        outside.mkdir()
        link = self.root / "link"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("Windows account cannot create symbolic links")
        with self.assertRaises(ValueError):
            backup.prune_backups(link)

    def test_failed_flush_does_not_publish_backup(self):
        directory = self.root / "backups"
        with patch("scripts.backup.os.fsync", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                backup.create_backup(self.database, directory, self.key)
        self.assertEqual(list(directory.iterdir()), [])

    def test_failed_restore_flush_does_not_publish_destination(self):
        path = backup.create_backup(self.database, self.root / "backups", self.key)
        target = self.root / "restore.sqlite3"
        with patch("scripts.backup.os.fsync", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                backup.restore_backup(path, target, self.key)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
