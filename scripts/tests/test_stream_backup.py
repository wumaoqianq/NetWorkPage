"""新流式格式的大库、认证边界及旧备份兼容测试。"""

import hashlib
import sqlite3
import tempfile
import tracemalloc
import unittest
from contextlib import closing
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from scripts import backup


class StreamingBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.key = Fernet.generate_key()
        self.database = self.root / "workspace.sqlite3"
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("CREATE TABLE pages (body BLOB)")
            connection.execute("INSERT INTO pages VALUES (?)", (b"private archived text",))
            connection.commit()

    def tearDown(self):
        self.temporary.cleanup()

    def test_actual_sqlite_above_32mib_roundtrip_has_bounded_python_memory(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("DELETE FROM pages")
            for index in range(36):
                connection.execute("INSERT INTO pages VALUES (?)", (bytes([index]) * 1024 * 1024,))
            connection.commit()
        self.assertGreater(self.database.stat().st_size, 32 * 1024 * 1024)
        target = self.root / "restored.sqlite3"
        tracemalloc.start()
        try:
            encrypted = backup.create_backup(self.database, self.root / "backups", self.key)
            backup.restore_backup(encrypted, target, self.key)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 12 * 1024 * 1024)
        with closing(sqlite3.connect(target)) as connection:
            rows = connection.execute("SELECT length(body), hex(substr(body, 1, 1)) FROM pages").fetchall()
            for index, (content,) in enumerate(connection.execute("SELECT body FROM pages")):
                self.assertEqual(hashlib.sha256(content).digest(),
                                 hashlib.sha256(bytes([index]) * 1024 * 1024).digest())
        self.assertEqual(rows, [(1024 * 1024, f"{index:02X}") for index in range(36)])
        with encrypted.open("rb") as stream:
            self.assertEqual(stream.read(8), b"WWBK\x01GCM")
        self.assertEqual(encrypted.suffix, ".wwb")

    def test_each_header_ciphertext_and_tag_component_is_authenticated(self):
        encrypted = backup.create_backup(self.database, self.root / "backups", self.key)
        original = encrypted.read_bytes()
        for label, offset in [("magic", 0), ("version", 4), ("salt", 8), ("nonce", 24),
                              ("ciphertext", 40), ("tag", -1)]:
            with self.subTest(component=label):
                changed = bytearray(original)
                changed[offset] ^= 1
                corrupt = self.root / f"{label}.wwb"
                corrupt.write_bytes(changed)
                target = self.root / f"{label}.sqlite3"
                with self.assertRaises(InvalidToken):
                    backup.restore_backup(corrupt, target, self.key)
                self.assertFalse(target.exists())
        self.assertFalse(list(self.root.glob(".restore-*")))

    def test_truncation_never_publishes_destination(self):
        encrypted = backup.create_backup(self.database, self.root / "backups", self.key)
        original = encrypted.read_bytes()
        for length in [0, 7, 35, 36, 51, len(original) - 1, len(original) - 16]:
            with self.subTest(length=length):
                corrupt = self.root / "truncated.wwb"
                corrupt.write_bytes(original[:length])
                target = self.root / "truncated.sqlite3"
                with self.assertRaises(InvalidToken):
                    backup.restore_backup(corrupt, target, self.key)
                self.assertFalse(target.exists())
        self.assertFalse(list(self.root.glob(".restore-*")))

    def test_legacy_fernet_is_readable_but_new_backup_is_not_fernet(self):
        legacy = self.root / "legacy.sqlite3.fernet"
        legacy.write_bytes(Fernet(self.key).encrypt(self.database.read_bytes()))
        target = self.root / "legacy-restored.sqlite3"
        backup.restore_backup(legacy, target, self.key)
        with closing(sqlite3.connect(target)) as connection:
            self.assertEqual(connection.execute("SELECT body FROM pages").fetchone()[0], b"private archived text")
        new = backup.create_backup(self.database, self.root / "backups", self.key)
        with self.assertRaises(InvalidToken):
            Fernet(self.key).decrypt(new.read_bytes())

    def test_restore_disk_budget_rejects_without_destination(self):
        encrypted = backup.create_backup(self.database, self.root / "backups", self.key)
        target = self.root / "too-large.sqlite3"
        with self.assertRaises(ValueError):
            backup.restore_backup(encrypted, target, self.key, max_bytes=1024)
        self.assertFalse(target.exists())

    def test_random_salt_and_nonce_change_every_backup(self):
        first = backup.create_backup(self.database, self.root / "backups", self.key)
        second = backup.create_backup(self.database, self.root / "backups", self.key)
        self.assertNotEqual(first.read_bytes()[8:36], second.read_bytes()[8:36])

    def test_legacy_fernet_larger_than_32mib_is_rejected_before_decrypt(self):
        legacy = self.root / "oversized.fernet"
        with legacy.open("wb") as stream:
            stream.write(b"gAAAA")
            stream.truncate((32 * 1024 * 1024 * 4 // 3) + 4097)
        target = self.root / "legacy-too-large.sqlite3"
        with self.assertRaises(ValueError):
            backup.restore_backup(legacy, target, self.key)
        self.assertFalse(target.exists())

    def test_zero_disk_budget_rejected(self):
        with self.assertRaises(ValueError):
            backup.create_backup(self.database, self.root / "backups", self.key, max_bytes=0)


if __name__ == "__main__":
    unittest.main()
