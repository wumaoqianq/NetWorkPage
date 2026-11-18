import io
import json
import tempfile
import uuid
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image

from workspace.models import PreviewAsset, Site
from workspace.tests.base import ApiTest


class PreviewTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=Path(self.temporary.name), PREVIEW_QUOTA_BYTES=1024 * 1024)
        self.settings_override.enable()
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'Chrome', 'protocolVersion': 2,
                                                   'extensionVersion': '1.2.0'}).json()
        self.headers = {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}

    def tearDown(self):
        self.settings_override.disable()
        self.temporary.cleanup()

    def image(self, color='green', size=(960, 540), mime='PNG'):
        output = io.BytesIO()
        Image.new('RGB', size, color).save(output, mime)
        return output.getvalue()

    def create_capture(self, url='https://example.com/'):
        capture_id = str(uuid.uuid4())
        response = self.send('/api/extension/v2/captures', {'clientCaptureId': capture_id, 'url': url,
            'title': '示例', 'description': '', 'purpose': '', 'homepageUrl': url,
            'category': '', 'tags': [], 'collectionIds': []}, **self.headers).json()
        site = Site.objects.get(pk=response['site']['id'])
        return capture_id, response, site

    def upload(self, capture_id, version, site, content=None, **changes):
        data = {'clientAssetId': str(uuid.uuid4()), 'expectedVersion': str(version),
            'sourceEndpointId': site.payload['endpoints'][0]['id'], 'sourceUrl': site.payload['endpoints'][0]['url'],
            'homepageUrl': site.payload.get('homepageUrl', ''), 'pageKind': 'home',
            'userConfirmedHomepage': 'true', 'capturedAt': timezone.now().isoformat(),
            'file': SimpleUploadedFile('preview.png', content if content is not None else self.image(),
                                       content_type='image/png'), **changes}
        return self.client.post(f'/api/extension/v2/captures/{capture_id}/preview', data, **self.headers), data

    def test_upload_private_read_idempotent_retry_and_remove(self):
        capture_id, result, site = self.create_capture()
        response, data = self.upload(capture_id, result['site']['version'], site)
        self.assertEqual(response.status_code, 200, response.content)
        uploaded = response.json()
        self.assertEqual(uploaded['siteVersion'], 2)
        data['file'].seek(0)
        retry = self.client.post(f'/api/extension/v2/captures/{capture_id}/preview', data, **self.headers)
        self.assertEqual(retry.json(), uploaded)
        self.assertEqual(PreviewAsset.objects.count(), 1)
        presentation = self.client.get('/api/workspace').json()['sites'][0]['presentation']['preview']
        self.assertTrue(presentation['present'])
        image = self.client.get(presentation['fullUrl'])
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image['Cache-Control'], 'private, no-store')
        self.assertEqual(image['X-Content-Type-Options'], 'nosniff')
        b''.join(image.streaming_content)
        image.close()
        self.client.force_login(self.b)
        self.assertEqual(self.client.get(presentation['fullUrl']).status_code, 404)
        self.client.force_login(self.a)
        removed = self.send(f'/api/sites/{site.pk}/preview', {'version': 2}, 'delete')
        self.assertEqual(removed.json()['siteVersion'], 3)
        self.assertFalse(PreviewAsset.objects.exists())

    def test_bad_image_keeps_text_and_previous_image(self):
        capture_id, result, site = self.create_capture()
        bad, _ = self.upload(capture_id, result['site']['version'], site, content=b'not an image')
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()['code'], 'preview_invalid')
        self.assertEqual(Site.objects.get(pk=site.pk).version, 1)
        good, _ = self.upload(capture_id, 1, site)
        self.assertEqual(good.status_code, 200)
        asset = PreviewAsset.objects.get()
        second_id = str(uuid.uuid4())
        updated = self.send('/api/extension/v2/captures', {'clientCaptureId': second_id,
            'url': str(site.payload['endpoints'][0]['url']), 'title': '新图', 'description': '', 'purpose': '',
            'category': '', 'tags': [], 'collectionIds': [], 'homepageUrl': 'https://example.com/',
            'updateFields': ['preview'], 'expectedVersion': 2}, **self.headers).json()
        failed, _ = self.upload(second_id, updated['site']['version'], site, content=b'fake')
        self.assertEqual(failed.status_code, 400)
        self.assertTrue(PreviewAsset.objects.filter(pk=asset.pk).exists())
        self.assertEqual(Site.objects.get(pk=site.pk).version, 2)

    def test_source_and_cross_account_capture_cannot_upload(self):
        capture_id, result, site = self.create_capture()
        changed, _ = self.upload(capture_id, 1, site, sourceUrl='https://other.example.com/')
        self.assertEqual(changed.json()['code'], 'preview_source_changed')
        self.client.force_login(self.b)
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'B', 'protocolVersion': 2}).json()
        self.headers = {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}
        denied, _ = self.upload(capture_id, 1, site)
        self.assertEqual(denied.status_code, 403)

    def test_source_edit_marks_existing_preview_stale(self):
        capture_id, result, site = self.create_capture()
        uploaded, _ = self.upload(capture_id, 1, site)
        self.assertEqual(uploaded.status_code, 200)
        current = self.client.get(f'/api/sites/{site.pk}').json()
        current['endpoints'][0]['url'] = 'https://example.com/changed'
        saved = self.send(f'/api/sites/{site.pk}', current, 'patch')
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(saved.json()['presentation']['preview']['stale'])

    def test_pixel_limit_and_account_quota_are_enforced(self):
        capture_id, result, site = self.create_capture()
        oversized, _ = self.upload(capture_id, 1, site, content=self.image(size=(1001, 2000)))
        self.assertEqual(oversized.status_code, 400)
        self.assertEqual(oversized.json()['code'], 'preview_invalid')
        with override_settings(PREVIEW_QUOTA_BYTES=1):
            quota, _ = self.upload(capture_id, 1, site)
        self.assertEqual(quota.status_code, 413)
        self.assertEqual(quota.json()['code'], 'preview_quota_exceeded')
        self.assertEqual(Site.objects.get(pk=site.pk).version, 1)
        self.assertFalse(PreviewAsset.objects.exists())

    def test_garbage_collection_waits_seven_days_and_respects_maintenance_lock(self):
        from django.utils import timezone as time
        from workspace.media import collect_garbage, maintenance_lock, release_maintenance_lock
        from workspace.models import OrphanedMedia
        capture_id, result, site = self.create_capture()
        uploaded, _ = self.upload(capture_id, 1, site)
        self.assertEqual(uploaded.status_code, 200)
        asset = PreviewAsset.objects.get()
        key = asset.storage_key
        self.send(f'/api/sites/{site.pk}/preview', {'version': 2}, 'delete')
        root = Path(self.temporary.name)
        self.assertEqual(collect_garbage(root), [])
        self.assertTrue((root / key).exists())
        OrphanedMedia.objects.filter(storage_key=key).update(first_seen=time.now() - time.timedelta(days=8))
        descriptor = maintenance_lock(root)
        try:
            self.assertEqual(collect_garbage(root), [])
            self.assertTrue((root / key).exists())
        finally:
            release_maintenance_lock(root, descriptor)
        self.assertEqual(collect_garbage(root), [key])
        self.assertFalse((root / key).exists())

    def test_historical_homepage_can_be_explicitly_updated_before_home_upload(self):
        capture_id, result, site = self.create_capture()
        site.payload['homepageUrl'] = ''
        site.save(update_fields=['payload'])
        second_id = str(uuid.uuid4())
        updated = self.send('/api/extension/v2/captures', {'clientCaptureId': second_id,
            'url': site.payload['endpoints'][0]['url'], 'title': '示例', 'description': '', 'purpose': '',
            'category': '', 'tags': [], 'collectionIds': [], 'homepageUrl': 'https://example.com/',
            'updateFields': ['homepage', 'preview'], 'expectedVersion': result['site']['version']}, **self.headers)
        self.assertEqual(updated.status_code, 200, updated.content)
        self.assertIn('homepage', updated.json()['acceptedFields'])
        site.refresh_from_db()
        self.assertEqual(site.payload['homepageUrl'], 'https://example.com/')
        uploaded, _ = self.upload(second_id, updated.json()['site']['version'], site)
        self.assertEqual(uploaded.status_code, 200, uploaded.content)
        self.assertEqual(PreviewAsset.objects.get().page_kind, 'home')

    def test_homepage_change_is_explicit_and_version_protected(self):
        _, result, site = self.create_capture()
        original_homepage = site.payload['homepageUrl']
        other, _ = self.capture_for_site(site, result['site']['version'], ['name'], homepage='https://other.example.com/')
        self.assertEqual(other.status_code, 200, other.content)
        site.refresh_from_db()
        self.assertEqual(site.payload['homepageUrl'], original_homepage)
        conflict, _ = self.capture_for_site(site, site.version - 1, ['homepage'], homepage='https://other.example.com/')
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['code'], 'version_conflict')
        site.refresh_from_db()
        self.assertEqual(site.payload['homepageUrl'], original_homepage)
        missing, _ = self.capture_for_site(site, site.version, ['homepage'], homepage='')
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json()['code'], 'homepage_confirmation_required')
        site.refresh_from_db()
        self.assertEqual(site.payload['homepageUrl'], original_homepage)
        changed, _ = self.capture_for_site(site, site.version, ['homepage'], homepage='https://other.example.com/')
        self.assertEqual(changed.status_code, 200, changed.content)
        site.refresh_from_db()
        self.assertEqual(site.payload['homepageUrl'], 'https://other.example.com/')

    def capture_for_site(self, site, version, fields, homepage):
        capture_id = str(uuid.uuid4())
        response = self.send('/api/extension/v2/captures', {'clientCaptureId': capture_id,
            'url': site.payload['endpoints'][0]['url'], 'title': '新名称', 'description': '', 'purpose': '',
            'category': '', 'tags': [], 'collectionIds': [], 'homepageUrl': homepage,
            'updateFields': fields, 'expectedVersion': version}, **self.headers)
        return response, capture_id

    def test_current_page_upload_does_not_invent_a_homepage(self):
        capture_id, result, site = self.create_capture()
        site.payload['homepageUrl'] = ''
        site.save(update_fields=['payload'])
        uploaded, _ = self.upload(capture_id, result['site']['version'], site,
                                  pageKind='current', homepageUrl='', userConfirmedHomepage='false')
        self.assertEqual(uploaded.status_code, 200, uploaded.content)
        site.refresh_from_db()
        self.assertEqual(site.payload['homepageUrl'], '')
        self.assertEqual(PreviewAsset.objects.get().page_kind, 'current')

    def test_interleaved_version_change_cannot_remove_preview(self):
        from unittest.mock import patch
        from django.db.models import QuerySet
        capture_id, result, site = self.create_capture()
        uploaded, _ = self.upload(capture_id, result['site']['version'], site)
        self.assertEqual(uploaded.status_code, 200)
        site.refresh_from_db()
        asset = PreviewAsset.objects.get()
        real_update = QuerySet.update
        interleaved = False

        def update_with_interleaving(queryset, *args, **kwargs):
            nonlocal interleaved
            if queryset.model is Site and not interleaved:
                interleaved = True
                real_update(queryset, version=site.version + 1, updated_at=timezone.now())
            return real_update(queryset, *args, **kwargs)

        with patch.object(QuerySet, 'update', new=update_with_interleaving):
            removed = self.send(f'/api/sites/{site.pk}/preview', {'version': 2}, 'delete')
        self.assertTrue(interleaved, 'the test must interleave a write with the conditional delete')
        self.assertEqual(removed.status_code, 409)
        self.assertEqual(removed.json()['code'], 'version_conflict')
        self.assertTrue(PreviewAsset.objects.filter(pk=asset.pk).exists())
        self.assertEqual(Site.objects.get(pk=site.pk).version, 2)

    def test_remove_without_preview_is_idempotent_at_the_same_version(self):
        _, _, site = self.create_capture()
        first = self.send(f'/api/sites/{site.pk}/preview', {'version': 1}, 'delete')
        second = self.send(f'/api/sites/{site.pk}/preview', {'version': 1}, 'delete')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.json(), {'removed': True, 'siteVersion': 1})
        self.assertEqual(Site.objects.get(pk=site.pk).version, 1)

    def test_share_allows_description_but_never_private_preview_data(self):
        capture_id, result, site = self.create_capture()
        uploaded, _ = self.upload(capture_id, 1, site)
        self.assertEqual(uploaded.status_code, 200)
        self.send(f'/api/sites/{site.pk}', {'version': 2, 'description': '可分享简介'}, 'patch')
        shared = self.send('/api/enhancements/shares', {'siteId': str(site.pk)}).json()
        public = self.client.get('/api/enhancements/public/shares/' + shared['token']).json()
        self.assertEqual(public['sites'][0]['description'], '可分享简介')
        self.assertNotIn('presentation', public['sites'][0])
        self.assertNotIn('sourceUrl', public['sites'][0])
        self.assertNotIn('fullUrl', public['sites'][0])
