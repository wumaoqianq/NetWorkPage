import io
import json
import zipfile
from django.test import TestCase


class ExtensionDownloadTests(TestCase):
    def test_unknown_download_is_not_the_frontend(self):
        self.assertEqual(self.client.get('/downloads/not-a-download.zip').status_code, 404)
        self.assertEqual(self.client.get('/downloads/website-workspace-extension-0.0.1.zip').status_code, 404)

    def test_private_extension_routes_still_require_authentication(self):
        self.assertEqual(self.client.get('/api/extension/devices').status_code, 401)
        self.assertEqual(self.client.post('/api/extension/pairing-code').status_code, 401)

    def test_download_contains_loadable_extension_without_private_files(self):
        response = self.client.get('/downloads/website-workspace-extension.zip')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')
        data = b''.join(response.streaming_content)
        response.close()
        import hashlib
        release = self.client.get('/api/extension/release').json()
        self.assertEqual(hashlib.sha256(data).hexdigest(), release['sha256'])
        self.assertEqual(len(data), release['sizeBytes'])
        versioned = self.client.head(f"/downloads/website-workspace-extension-{release['version']}.zip")
        self.assertEqual(versioned.status_code, 200)
        self.assertIn(f"extension-{release['version']}.zip", versioned['Content-Disposition'])
        versioned.close()
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['manifest_version'], 3)
            self.assertEqual(manifest['version'], release['version'])
            self.assertIn('workspace-presence.js', names)
            self.assertEqual(manifest['optional_permissions'], ['bookmarks'])
            self.assertNotIn('bookmarks', manifest['permissions'])
            for name in ['bookmarks.html', 'bookmarks-page.js', 'bookmark-data.js', 'bookmark-engine.js']:
                self.assertIn(name, names)
            self.assertIn(manifest['background']['service_worker'], names)
            self.assertTrue(all(not name.startswith(('.env', 'tests/', 'node_modules/')) for name in names))
