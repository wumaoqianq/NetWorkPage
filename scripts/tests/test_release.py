"""发布包必须可离线解包且不能夹带开发凭据。"""

import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts import build_release, generate_env


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ["server/manage.py", "prototype/dist/client/index.html", "requirements.lock"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("placeholder", encoding="utf-8")
        extension = self.root / 'extension'
        (extension / 'dist').mkdir(parents=True)
        (extension / 'manifest.json').write_text('{"version":"1.10.0"}', encoding='utf-8')
        self.extension_zip = extension / 'dist' / 'website-workspace-extension-1.10.0.zip'
        with zipfile.ZipFile(self.extension_zip, 'w') as package:
            package.write(extension / 'manifest.json', 'manifest.json')

    def build(self):
        with patch.object(build_release, 'KEY_DIR', self.root / '.local/keys'), \
                patch.object(build_release, 'build_extension'):
            build_release.load_signing_key(create=True)
            return build_release.build_release(self.root, self.root / 'release',
                                               '1.10.0-rc.11', 'v1.10.0-rc.11', 'prerelease', '1.10.0',
                                               commit='a' * 40, allow_dirty=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_bundle_excludes_credentials_database_and_dependencies(self):
        for name in [".env.local", "server/.env", "server/db.sqlite3", "server/node_modules/x.js", "server/snapshot.wwb"]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("excluded-secret", encoding="utf-8")
        manifest, archive = self.build()
        with tarfile.open(archive) as bundle:
            names = bundle.getnames()
            self.assertIn("website-workspace/server/manage.py", names)
            self.assertIn("website-workspace/prototype/dist/client/index.html", names)
            self.assertFalse(any(".env" in name or "sqlite3" in name or "node_modules" in name
                                 or name.endswith(".wwb") for name in names))
            embedded = f'website-workspace/extension/dist/{self.extension_zip.name}'
            with bundle.extractfile(embedded) as payload:
                self.assertEqual(payload.read(), (archive.parent / self.extension_zip.name).read_bytes())
        self.assertTrue((archive.parent / 'SHA256SUMS').is_file())
        self.assertTrue((archive.parent / 'release-manifest.json.sig').is_file())
        self.assertEqual(manifest['assets'][0]['bytes'], archive.stat().st_size)

    def test_missing_frontend_build_rejected(self):
        (self.root / "prototype/dist/client/index.html").unlink()
        with self.assertRaises(FileNotFoundError):
            self.build()

    def test_literal_secret_in_source_is_rejected(self):
        (self.root / "server/leak.py").write_text('SECRET_KEY = "real-secret-value-should-not-ship"')
        with self.assertRaises(ValueError):
            self.build()

    def test_generate_env_never_overwrites_and_has_secure_defaults(self):
        destination = self.root / ".env.local"
        generate_env.generate_env(destination, "https://workspace.example.com")
        original = destination.read_bytes()
        self.assertIn(b"DEBUG=False", original)
        self.assertIn(b"BACKUP_KEY=", original)
        self.assertIn(b"SETUP_TOKEN=", original)
        with self.assertRaises(FileExistsError):
            generate_env.generate_env(destination, "https://workspace.example.com")
        self.assertEqual(destination.read_bytes(), original)

    def test_missing_backend_rejected(self):
        (self.root / "server/manage.py").unlink()
        with self.assertRaises(FileNotFoundError):
            self.build()

    def test_copy_of_known_local_secret_in_readme_rejected(self):
        secret = "private-local-marker-1234567890123456"
        (self.root / ".env.local").write_text(f"SETUP_TOKEN={secret}\n")
        (self.root / "README.md").write_text(f"Accidental copied token: {secret}")
        with self.assertRaises(ValueError):
            self.build()

    def test_env_generation_refuses_insecure_origin(self):
        with self.assertRaises(ValueError):
            generate_env.generate_env(self.root / ".env.local", "http://workspace.example.com")


if __name__ == "__main__":
    unittest.main()
