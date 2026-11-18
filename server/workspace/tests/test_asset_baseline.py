"""阶段 C：素材条件写入层（v3 基线上传 / 幂等 / ABA / 入口变化）端到端测试。"""
import io
import tempfile
import uuid
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image

from workspace.asset_baseline import site_source_fingerprint
from workspace.models import AssetTombstone, PreviewAsset, Site, SiteIconAsset
from workspace.tests.base import ApiTest

KINDS = ('preview', 'icon')


class AssetBaselineTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            MEDIA_ROOT=Path(self.temporary.name),
            PREVIEW_QUOTA_BYTES=10 * 1024 * 1024,
            ICON_QUOTA_BYTES=4 * 1024 * 1024)
        self.settings_override.enable()
        # 固定截图时间：让幂等重放能复现完全相同的 content_fingerprint。
        self.captured_at = timezone.now().isoformat()
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'Chrome',
            'protocolVersion': 2, 'extensionVersion': '1.4.0'}).json()
        self.headers = {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}

    def tearDown(self):
        self.settings_override.disable()
        self.temporary.cleanup()

    # ---- 夹具 -------------------------------------------------------------

    def png(self, color='green', size=(32, 32)):
        output = io.BytesIO()
        Image.new('RGBA', size, color).save(output, 'PNG')
        return output.getvalue()

    def create_capture(self, url='https://example.com/tool'):
        capture_id = str(uuid.uuid4())
        response = self.send('/api/extension/v2/captures', {
            'clientCaptureId': capture_id, 'url': url, 'title': '示例', 'description': '',
            'purpose': '', 'homepageUrl': url, 'category': '', 'tags': [], 'collectionIds': [],
            'descriptionSource': 'manual'}, **self.headers)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        site = Site.objects.get(pk=result['site']['id'])
        return capture_id, result, site

    def upload(self, kind, capture_id, site, client_asset_id, expected_revision,
               source_fingerprint, content=None, headers=None):
        endpoint = site.payload['endpoints'][0]
        content = self.png() if content is None else content
        data = {'clientAssetId': client_asset_id,
                'expectedAssetRevision': expected_revision,
                'expectedSourceFingerprint': source_fingerprint,
                'sourceUrl': endpoint['url'],
                'file': SimpleUploadedFile('asset.png', content, content_type='image/png')}
        if kind == 'preview':
            data.update({'sourceEndpointId': endpoint['id'], 'pageKind': 'current',
                         'homepageUrl': '', 'userConfirmedHomepage': 'false',
                         'capturedAt': self.captured_at})
            url = f'/api/extension/v3/captures/{capture_id}/preview'
        else:
            url = f'/api/extension/v3/captures/{capture_id}/icon'
        return self.client.post(url, data, **(self.headers if headers is None else headers))

    def current_revision(self, kind, site):
        model = PreviewAsset if kind == 'preview' else SiteIconAsset
        obj = model.objects.filter(site=site).first()
        return str(obj.revision) if obj else None

    # ---- 用例 -------------------------------------------------------------

    def test_capture_results_carry_preview_and_icon_baselines(self):
        capture_id, result, site = self.create_capture()
        for key in ('previewBaseline', 'iconBaseline'):
            self.assertIn(key, result['site'])
            baseline = result['site'][key]
            self.assertFalse(baseline['present'])
            self.assertIsNone(baseline['revision'])
            self.assertEqual(len(baseline['sourceFingerprint']), 64)
        # v1 capture_site_dto 也带上基线，同时保留原有字段。
        lookup = self.client.get(
            '/api/extension/lookup?url=' + site.payload['endpoints'][0]['url'],
            **self.headers).json()['site']
        for key in ('previewBaseline', 'iconBaseline', 'previewRevision', 'iconRevision',
                    'previewPresent', 'iconPresent'):
            self.assertIn(key, lookup)
        self.assertFalse(lookup['previewBaseline']['present'])
        self.assertFalse(lookup['iconBaseline']['present'])

    def test_duplicate_existing_updated_trashed_results_carry_baselines(self):
        _, _, site = self.create_capture()
        endpoint_url = site.payload['endpoints'][0]['url']
        base = {'url': endpoint_url, 'title': '示例', 'description': '', 'purpose': '',
                'category': '', 'tags': [], 'collectionIds': [], 'homepageUrl': ''}
        existing = self.send('/api/extension/v2/captures',
                             {'clientCaptureId': str(uuid.uuid4()), **base}, **self.headers).json()
        self.assertEqual(existing['outcome'], 'existing')
        self.assertIn('previewBaseline', existing['site'])
        self.assertIn('iconBaseline', existing['site'])
        updated = self.send('/api/extension/v2/captures',
                            {'clientCaptureId': str(uuid.uuid4()), **base,
                             'updateFields': ['name'], 'expectedVersion': site.version},
                            **self.headers).json()
        self.assertEqual(updated['outcome'], 'updated')
        self.assertIn('previewBaseline', updated['site'])
        self.assertIn('iconBaseline', updated['site'])
        site.payload['deleted'] = True
        site.save(update_fields=['payload'])
        trashed = self.send('/api/extension/v2/captures',
                            {'clientCaptureId': str(uuid.uuid4()), **base}, **self.headers).json()
        self.assertEqual(trashed['outcome'], 'trashed')
        self.assertIn('previewBaseline', trashed['site'])
        self.assertIn('iconBaseline', trashed['site'])

    def test_v3_absent_upload_and_idempotent_replay(self):
        for kind in KINDS:
            capture_id, result, site = self.create_capture(url=f'https://example.com/{kind}')
            fp = result['site'][f'{kind}Baseline']['sourceFingerprint']
            self.assertFalse(result['site'][f'{kind}Baseline']['present'])
            client_asset_id = str(uuid.uuid4())
            green = self.png('green')
            first = self.upload(kind, capture_id, site, client_asset_id, 'absent', fp, green)
            self.assertEqual(first.status_code, 200, first.content)
            uploaded = first.json()
            self.assertEqual(uploaded['status'], 'complete')
            self.assertEqual(uploaded['assetRevision'], uploaded['revision'])
            self.assertEqual(len(uploaded['assetRevision']), 36)
            self.assertEqual(uploaded['sourceFingerprint'], fp)
            r1 = uploaded['assetRevision']
            self.assertEqual(self.current_revision(kind, site), r1)
            # 换图：不同 clientAssetId + 不同内容，带旧 revision -> 新 revision。
            second = self.upload(kind, capture_id, site, str(uuid.uuid4()), r1, fp, self.png('red'))
            self.assertEqual(second.status_code, 200, second.content)
            r2 = second.json()['assetRevision']
            self.assertNotEqual(r2, r1)
            self.assertEqual(self.current_revision(kind, site), r2)
            # 幂等重放：相同 clientAssetId + 相同内容，返回首次 result，不覆盖新图。
            replay = self.upload(kind, capture_id, site, client_asset_id, 'absent', fp, green)
            self.assertEqual(replay.status_code, 200, replay.content)
            self.assertEqual(replay.json(), uploaded)
            self.assertEqual(self.current_revision(kind, site), r2)

    def test_stale_expected_revision_conflicts(self):
        for kind in KINDS:
            capture_id, result, site = self.create_capture(url=f'https://example.com/stale-{kind}')
            fp = result['site'][f'{kind}Baseline']['sourceFingerprint']
            first = self.upload(kind, capture_id, site, str(uuid.uuid4()), 'absent', fp)
            self.assertEqual(first.status_code, 200, first.content)
            r1 = first.json()['assetRevision']
            second = self.upload(kind, capture_id, site, str(uuid.uuid4()), r1, fp, self.png('red'))
            self.assertEqual(second.status_code, 200, second.content)
            r2 = second.json()['assetRevision']
            conflict = self.upload(kind, capture_id, site, str(uuid.uuid4()), r1, fp, self.png('blue'))
            self.assertEqual(conflict.status_code, 409)
            self.assertEqual(conflict.json()['code'], 'asset_conflict')
            self.assertEqual(self.current_revision(kind, site), r2)

    def test_delete_tombstone_blocks_absent_upload(self):
        for kind in KINDS:
            capture_id, result, site = self.create_capture(url=f'https://example.com/tomb-{kind}')
            fp = result['site'][f'{kind}Baseline']['sourceFingerprint']
            up = self.upload(kind, capture_id, site, str(uuid.uuid4()), 'absent', fp)
            self.assertEqual(up.status_code, 200, up.content)
            new_version = up.json()['siteVersion']
            if kind == 'preview':
                removed = self.send(f'/api/sites/{site.pk}/preview', {'version': new_version}, 'delete')
            else:
                removed = self.send(f'/api/sites/{site.pk}/icon', {'version': new_version}, 'delete')
            self.assertEqual(removed.status_code, 200, removed.content)
            self.assertIsNone(self.current_revision(kind, site))
            self.assertTrue(AssetTombstone.objects.filter(site=site, kind=kind).exists())
            blocked = self.upload(kind, capture_id, site, str(uuid.uuid4()), 'absent', fp)
            self.assertEqual(blocked.status_code, 409)
            self.assertEqual(blocked.json()['code'], 'asset_conflict')
            self.assertIsNone(self.current_revision(kind, site))

    def test_endpoint_change_changes_source_fingerprint(self):
        for kind in KINDS:
            capture_id, result, site = self.create_capture(url=f'https://example.com/src-{kind}')
            fp = result['site'][f'{kind}Baseline']['sourceFingerprint']
            current = self.client.get(f'/api/sites/{site.pk}').json()
            current['endpoints'] = current['endpoints'] + [
                {'id': 'second', 'url': f'https://example.com/src-{kind}/second',
                 'label': 'Second', 'scope': '公网'}]
            patched = self.send(f'/api/sites/{site.pk}', current, 'patch')
            self.assertEqual(patched.status_code, 200, patched.content)
            site.refresh_from_db()
            self.assertNotEqual(site_source_fingerprint(site), fp)
            blocked = self.upload(kind, capture_id, site, str(uuid.uuid4()), 'absent', fp, self.png('green'))
            self.assertEqual(blocked.status_code, 409)
            self.assertEqual(blocked.json()['code'], 'asset_source_changed')

    def test_cross_account_and_no_permission_receipt_are_forbidden(self):
        for kind in KINDS:
            capture_id, result, site = self.create_capture(url=f'https://example.com/perm-{kind}')
            fp = result['site'][f'{kind}Baseline']['sourceFingerprint']
            # 跨账号：B 的 Bearer + A 的 capture 回执。
            self.client.force_login(self.b)
            code = self.send('/api/extension/pairing-code').json()['code']
            paired = self.send('/api/extension/pair',
                               {'code': code, 'name': 'B', 'protocolVersion': 2}).json()
            denied = self.upload(kind, capture_id, site, str(uuid.uuid4()), 'absent', fp,
                                 headers={'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']})
            self.assertEqual(denied.status_code, 403)
            # 跨 capture：重复收藏回执（existing）没有上传许可。
            self.client.force_login(self.a)
            duplicate_capture_id = str(uuid.uuid4())
            duplicate = self.send('/api/extension/v2/captures', {
                'clientCaptureId': duplicate_capture_id,
                'url': site.payload['endpoints'][0]['url'], 'title': '重复', 'description': '',
                'purpose': '', 'category': '', 'tags': [], 'collectionIds': [],
                'homepageUrl': ''}, **self.headers).json()
            self.assertEqual(duplicate['outcome'], 'existing')
            self.assertFalse(duplicate['canAttachPreview'])
            denied2 = self.upload(kind, duplicate_capture_id, site, str(uuid.uuid4()), 'absent', fp)
            self.assertEqual(denied2.status_code, 403)
            # 完全未知的 capture 同样 403。
            denied3 = self.upload(kind, 'no-such-capture', site, str(uuid.uuid4()), 'absent', fp)
            self.assertEqual(denied3.status_code, 403)

    def test_idempotency_conflict_same_id_different_content(self):
        for kind in KINDS:
            capture_id, result, site = self.create_capture(url=f'https://example.com/idem-{kind}')
            fp = result['site'][f'{kind}Baseline']['sourceFingerprint']
            client_asset_id = str(uuid.uuid4())
            first = self.upload(kind, capture_id, site, client_asset_id, 'absent', fp, self.png('green'))
            self.assertEqual(first.status_code, 200, first.content)
            r1 = first.json()['assetRevision']
            conflict = self.upload(kind, capture_id, site, client_asset_id, 'absent', fp, self.png('red'))
            self.assertEqual(conflict.status_code, 409)
            self.assertEqual(conflict.json()['code'], 'idempotency_conflict')
            self.assertEqual(self.current_revision(kind, site), r1)
