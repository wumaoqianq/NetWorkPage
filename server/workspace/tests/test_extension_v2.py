import uuid

from workspace.models import Category, Collection, Site
from workspace.tests.base import ApiTest


class ExtensionV2Tests(ApiTest):
    def connect(self, protocol=2):
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'Chrome 120',
            'extensionVersion': '1.2.0', 'protocolVersion': protocol}).json()
        return paired, {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}

    def capture(self, headers, **changes):
        data = {'clientCaptureId': str(uuid.uuid4()), 'url': 'https://example.com/tools?q=1#top',
            'title': '示例工具', 'description': '用于处理团队图片', 'descriptionSource': 'page_meta',
            'purpose': '', 'category': '', 'tags': ['图片'], 'collectionIds': [], 'pinned': False,
            'later': False, 'homepageUrl': 'https://example.com/', **changes}
        return self.send('/api/extension/v2/captures', data, **headers), data

    def test_create_description_inbox_and_idempotency(self):
        _, headers = self.connect()
        response, data = self.capture(headers)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertTrue(result['canAttachPreview'])
        site = Site.objects.get()
        self.assertEqual(site.payload['descriptionSource'], 'page_meta')
        self.assertFalse(site.payload['inbox'])
        later, _ = self.capture(headers, url='https://later.example.com/', later=True)
        self.assertEqual(later.status_code, 200)
        self.assertTrue(Site.objects.get(payload__name='示例工具', url_records__url='https://later.example.com/').payload['inbox'])
        self.assertEqual(self.send('/api/extension/v2/captures', data, **headers).json(), result)
        conflict = self.send('/api/extension/v2/captures', {**data, 'title': '不同内容'}, **headers)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()['code'], 'idempotency_conflict')
        self.assertEqual(Site.objects.count(), 2)

    def test_duplicate_note_append_is_explicit_idempotent_and_never_returned_by_lookup(self):
        original = self.site(notes='旧私人备注')
        _, headers = self.connect()
        lookup = self.client.get('/api/extension/lookup?url=https://example.com/tool', **headers).json()
        self.assertNotIn('notes', lookup['site'])
        unchanged, _ = self.capture(headers, url=original['endpoints'][0]['url'], notes='不得自动追加')
        self.assertEqual(unchanged.json()['outcome'], 'existing')
        self.assertEqual(Site.objects.get().payload['notes'], '旧私人备注')
        appended, data = self.capture(headers, url=original['endpoints'][0]['url'], notes='新增经验',
            appendNotes=True, expectedVersion=original['version'])
        self.assertEqual(appended.status_code, 200, appended.content)
        first = Site.objects.get().payload['notes']
        self.assertIn('旧私人备注', first)
        self.assertIn('新增经验', first)
        self.assertNotIn('不得自动追加', first)
        retry = self.send('/api/extension/v2/captures', data, **headers)
        self.assertEqual(retry.json(), appended.json())
        self.assertEqual(Site.objects.get().payload['notes'], first)
        conflict, _ = self.capture(headers, url=original['endpoints'][0]['url'], notes='冲突备注',
            appendNotes=True, expectedVersion=original['version'])
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(Site.objects.get().payload['notes'], first)

    def test_duplicate_explicit_fields_and_version_conflict(self):
        original = self.site(purpose='保留用途', notes='私人备注')
        _, headers = self.connect()
        response, _ = self.capture(headers, url=original['endpoints'][0]['url'], purpose='不得覆盖')
        self.assertEqual(response.json()['outcome'], 'existing')
        self.assertFalse(response.json()['canAttachPreview'])
        self.assertEqual(Site.objects.get().payload['purpose'], '保留用途')
        conflict, _ = self.capture(headers, url=original['endpoints'][0]['url'],
            updateFields=['name', 'purpose'], expectedVersion=original['version'] - 1, purpose='新用途')
        self.assertEqual(conflict.status_code, 409)
        update, _ = self.capture(headers, url=original['endpoints'][0]['url'], title='新名称',
            description='新简介', updateFields=['name'], expectedVersion=original['version'])
        self.assertEqual(update.json()['outcome'], 'updated')
        payload = Site.objects.get().payload
        self.assertEqual(payload['name'], '新名称')
        self.assertEqual(payload['purpose'], '保留用途')
        self.assertEqual(payload['description'], '')
        self.assertEqual(payload['notes'], '私人备注')

    def test_trash_relations_and_legacy_protocol(self):
        original = self.site(deleted=True)
        _, headers = self.connect()
        response, _ = self.capture(headers, url=original['endpoints'][0]['url'], updateFields=['name'],
                                   expectedVersion=original['version'])
        self.assertEqual(response.json()['outcome'], 'trashed')
        self.assertTrue(Site.objects.get().payload['deleted'])
        missing, _ = self.capture(headers, category='不存在')
        self.assertEqual(missing.json()['code'], 'relation_unavailable')
        legacy, legacy_headers = self.connect(protocol=1)
        old = self.send('/api/extension/captures', {'clientCaptureId': 'old-1',
            'url': 'https://old.example.com', 'title': '旧扩展', 'purpose': ''}, **legacy_headers)
        self.assertEqual(old.status_code, 200)
        rejected, _ = self.capture(legacy_headers, url='https://v2.example.com')
        self.assertEqual(rejected.status_code, 426)
        self.assertEqual(rejected.json()['code'], 'extension_upgrade_required')

    def test_options_and_lookup_are_owner_scoped(self):
        self.client.get('/api/workspace')
        collection = Collection.objects.filter(owner=self.a).first()
        Category.objects.get_or_create(owner=self.a, name='开发工具')
        created = self.site(description='简介', notes='绝密私人备注', collections=[str(collection.pk)])
        self.assertIn('id', created, created)
        _, headers = self.connect()
        options = self.client.get('/api/extension/options', **headers).json()
        self.assertIn('开发工具', options['categories'])
        self.assertNotIn('绝密私人备注', str(options))
        lookup = self.client.get('/api/extension/lookup?url=https://example.com/tool', **headers).json()
        self.assertEqual(lookup['site']['description'], '简介')
        self.assertNotIn('notes', lookup['site'])
        self.client.force_login(self.b)
        code = self.send('/api/extension/pairing-code').json()['code']
        other = self.send('/api/extension/pair', {'code': code, 'name': '其他账号', 'protocolVersion': 2}).json()
        other_options = self.client.get('/api/extension/options', HTTP_AUTHORIZATION='Bearer ' + other['token']).json()
        self.assertNotIn(str(collection.pk), str(other_options))

    def test_server_metadata_description_requires_explicit_adoption(self):
        from django.utils import timezone
        from enhancements.models import Metadata
        site = self.site(description='手动简介')
        Metadata.objects.create(owner=self.a, site_id=site['id'], checked_at=timezone.now(),
            result={'description': '服务器抓取简介', 'status': 'available'})
        path = f"/api/enhancements/sites/{site['id']}/metadata"
        adopted = self.send(path, {'version': site['version'], 'adoptDescription': True}, 'patch')
        self.assertEqual(adopted.status_code, 200, adopted.content)
        self.assertEqual(adopted.json()['descriptionSource'], 'server_meta')
        conflict = self.send(path, {'version': site['version'], 'adoptDescription': True}, 'patch')
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(Site.objects.get(pk=site['id']).payload['description'], '服务器抓取简介')
