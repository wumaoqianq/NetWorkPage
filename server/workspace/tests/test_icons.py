import io
import tempfile
import uuid
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image

from workspace.models import Site, SiteIconAsset
from workspace.tests.base import ApiTest


class IconTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=Path(self.temporary.name), ICON_QUOTA_BYTES=1024 * 1024)
        self.settings_override.enable()
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'Chrome', 'protocolVersion': 2,
                                                   'extensionVersion': '1.3.0'}).json()
        self.headers = {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}

    def tearDown(self):
        self.settings_override.disable()
        self.temporary.cleanup()

    def image(self, image_format='PNG', color='green'):
        output = io.BytesIO()
        Image.new('RGBA', (128, 128), color).save(output, image_format)
        return output.getvalue()

    def create_capture(self, **changes):
        capture_id = str(uuid.uuid4())
        data = {'clientCaptureId': capture_id, 'url': 'https://example.com/path', 'title': '示例',
            'description': '', 'notes': '', 'purpose': '', 'category': '', 'tags': [], 'collectionIds': [],
            'homepageUrl': '', **changes}
        response = self.send('/api/extension/v2/captures', data, **self.headers)
        return capture_id, response

    def upload(self, capture_id, site, version, content=None):
        return self.client.post(f'/api/extension/v2/captures/{capture_id}/icon', {
            'clientAssetId': str(uuid.uuid4()), 'expectedVersion': str(version),
            'sourceUrl': site.payload['endpoints'][0]['url'],
            'file': SimpleUploadedFile('icon.png', content or self.image(), content_type='image/png')}, **self.headers)

    def test_icon_upload_is_private_idempotent_and_owner_scoped(self):
        capture_id, response = self.create_capture(notes='只保存到备注', category='')
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertTrue(result['canAttachIcon'])
        site = Site.objects.get()
        self.assertEqual(site.payload['notes'], '只保存到备注')
        self.assertFalse(site.payload['inbox'])
        uploaded = self.upload(capture_id, site, result['site']['version'])
        self.assertEqual(uploaded.status_code, 200, uploaded.content)
        self.assertEqual(uploaded.json()['siteVersion'], 2)
        asset = SiteIconAsset.objects.get()
        self.assertLessEqual(asset.bytes, 32 * 1024)
        workspace = self.client.get('/api/workspace').json()
        icon_url = workspace['sites'][0]['presentation']['icon']['url']
        private = self.client.get(icon_url)
        self.assertEqual(private.status_code, 200)
        self.assertEqual(private['Cache-Control'], 'private, no-store')
        b''.join(private.streaming_content)
        private.close()
        self.client.force_login(self.b)
        self.assertEqual(self.client.get(icon_url).status_code, 404)
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'B', 'protocolVersion': 2}).json()
        self.headers = {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}
        denied = self.upload(capture_id, site, 2)
        self.assertEqual(denied.status_code, 403)

    def test_invalid_icon_keeps_text_and_existing_icon(self):
        capture_id, response = self.create_capture()
        site = Site.objects.get()
        invalid = self.upload(capture_id, site, 1, b'<svg xmlns="http://www.w3.org/2000/svg"/>')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()['code'], 'icon_invalid')
        self.assertEqual(Site.objects.get().version, 1)
        self.assertFalse(SiteIconAsset.objects.exists())

    def test_conflicting_icon_upload_preserves_existing_asset(self):
        capture_id, response = self.create_capture()
        site = Site.objects.get()
        uploaded = self.upload(capture_id, site, 1)
        self.assertEqual(uploaded.status_code, 200)
        conflict = self.upload(capture_id, site, 1, self.image(color='red'))
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(SiteIconAsset.objects.count(), 1)
        self.assertEqual(Site.objects.get().version, 2)
