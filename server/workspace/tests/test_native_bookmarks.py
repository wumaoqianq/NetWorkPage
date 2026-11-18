import uuid
from workspace.tests.base import ApiTest
from workspace.models import Site, ImportJob
from django.utils import timezone
from django.test import override_settings


class NativeBookmarkTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.device = self.pair()
        self.header = {'HTTP_AUTHORIZATION': 'Bearer ' + self.device['token']}
        self.payload = {'batchId': str(uuid.uuid4()), 'items': [
            {'title': '压图工具', 'url': 'https://native.test/', 'folder': '收藏栏 / 工具'},
            {'title': '重复', 'url': 'https://native.test/', 'folder': ''}]}

    def test_bearer_batch_is_idempotent_and_keeps_private_folder_notes(self):
        first = self.send('/api/extension/bookmarks/import', self.payload, **self.header)
        self.assertEqual(first.status_code, 200)
        self.assertEqual((first.json()['imported'], first.json()['skipped']), (1, 1))
        self.assertEqual(first.json()['ownerId'], self.a.pk)
        self.assertEqual(self.send('/api/extension/bookmarks/import', self.payload, **self.header).json(), first.json())
        self.assertEqual(Site.objects.count(), 1)
        saved = Site.objects.get()
        self.assertTrue(saved.payload['inbox'])
        self.assertIn('收藏栏 / 工具', saved.payload['notes'])
        self.assertEqual(saved.payload['accounts'], [])
        other = {**self.payload, 'items': [{'title': '改内容', 'url': 'https://changed.test/'}]}
        self.assertEqual(self.send('/api/extension/bookmarks/import', other, **self.header).status_code, 409)

    def test_requires_device_and_cannot_reuse_other_users_or_web_import_receipts(self):
        self.assertEqual(self.send('/api/extension/bookmarks/import', self.payload).status_code, 401)
        self.send('/api/extension/bookmarks/import', self.payload, **self.header)
        self.client.force_login(self.b)
        device = self.pair()
        self.assertEqual(self.send('/api/extension/bookmarks/import', self.payload,
            HTTP_AUTHORIZATION='Bearer '+device['token']).status_code, 404)
        self.client.force_login(self.a)
        job = ImportJob.objects.create(owner=self.a, payload={'sites': [], 'categories': [], 'collections': []},
                                      expires_at=timezone.now())
        self.assertEqual(self.send('/api/extension/bookmarks/import', {**self.payload, 'batchId': str(job.pk)}, **self.header).status_code, 404)

    def test_rejects_private_fields_and_rolls_back_the_whole_bad_batch(self):
        for item in [{'title': 'bad', 'url': 'https://bad.test', 'accounts': []},
                     {'title': 'bad', 'url': 'javascript:alert(1)'}]:
            response = self.send('/api/extension/bookmarks/import', {**self.payload, 'items': [self.payload['items'][0], item]}, **self.header)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(Site.objects.count(), 0)

    @override_settings(MAX_SITES=1)
    def test_capacity_failure_rolls_back_sites_and_receipt(self):
        payload = {**self.payload, 'items': [self.payload['items'][0], {'title': 'second', 'url': 'https://second.test/'}]}
        self.assertEqual(self.send('/api/extension/bookmarks/import', payload, **self.header).status_code, 409)
        self.assertEqual(Site.objects.count(), 0)
        self.assertEqual(ImportJob.objects.count(), 0)

    def test_original_user_can_resume_receipt_after_device_repair(self):
        original = self.send('/api/extension/bookmarks/import', self.payload, **self.header).json()
        device = self.pair()
        result = self.send('/api/extension/bookmarks/import', self.payload, HTTP_AUTHORIZATION='Bearer '+device['token'])
        self.assertEqual(result.json(), original)
        self.assertEqual(Site.objects.count(), 1)
