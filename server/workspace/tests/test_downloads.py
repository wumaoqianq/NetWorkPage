import io
import json
import zipfile
from django.test import TestCase
from django.contrib.auth.models import User


class ExtensionDownloadTests(TestCase):
    def test_download_requires_login(self):
        self.assertEqual(self.client.get('/downloads/website-workspace-extension.zip').status_code, 401)

    def test_download_contains_loadable_extension_without_private_files(self):
        user = User.objects.create_user(username='download@example.test', password='Temporary-Only!123')
        self.client.force_login(user)
        response = self.client.get('/downloads/website-workspace-extension.zip')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')
        data = b''.join(response.streaming_content)
        response.close()
        import hashlib
        release = self.client.get('/api/extension/release').json()
        self.assertEqual(hashlib.sha256(data).hexdigest(), release['sha256'])
        self.assertEqual(len(data), release['sizeBytes'])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['manifest_version'], 3)
            self.assertEqual(manifest['version'], '1.10.0')
            self.assertEqual(manifest['optional_permissions'], ['bookmarks'])
            self.assertNotIn('bookmarks', manifest['permissions'])
            for name in ['bookmarks.html', 'bookmarks-page.js', 'bookmark-data.js', 'bookmark-engine.js']:
                self.assertIn(name, names)
            self.assertIn(manifest['background']['service_worker'], names)
            self.assertTrue(all(not name.startswith(('.env', 'tests/', 'node_modules/')) for name in names))
