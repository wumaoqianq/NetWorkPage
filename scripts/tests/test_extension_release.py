import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.build_extension import RUNTIME_FILES, build_extension


class ExtensionReleaseTests(unittest.TestCase):
    def test_zip_is_reproducible_and_manifest_matches(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            extension = root / 'extension'
            for name in RUNTIME_FILES:
                path = extension / name
                path.parent.mkdir(parents=True, exist_ok=True)
                if name == 'manifest.json':
                    path.write_text(json.dumps({'version': '1.2.0', 'minimum_chrome_version': '120'}), encoding='utf-8')
                else:
                    path.write_bytes(name.encode())
            first, manifest = build_extension(root)
            first_digest = manifest['sha256']
            second, second_manifest = build_extension(root)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(first_digest, second_manifest['sha256'])
            self.assertEqual(first.stat().st_size, second_manifest['sizeBytes'])
            with zipfile.ZipFile(io.BytesIO(first.read_bytes())) as archive:
                self.assertEqual(archive.namelist(), RUNTIME_FILES)
                self.assertFalse(any(name.startswith(('tests/', '.env', 'node_modules/')) for name in archive.namelist()))
                self.assertEqual(archive.read('manifest.json'),
                                 (extension / 'manifest.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
