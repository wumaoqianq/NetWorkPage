import io
import json
import socket
import tempfile
import time
import uuid
from pathlib import Path
from unittest.mock import patch

from django.test import Client, override_settings
from django.utils import timezone
from PIL import Image

from workspace import favicons
from workspace.models import AuditEvent, PreviewAsset, Site, SiteIconAsset
from workspace.tests.base import ApiTest

PUBLIC_IP = '93.184.216.34'
ENDPOINT = 'https://example.com/tool'
FAVICON = 'https://example.com/favicon.ico'
ICO_SIZES = ((16, 16), (32, 32), (48, 48), (128, 128), (256, 256))


class IconRefreshTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.override = override_settings(MEDIA_ROOT=Path(self.temporary.name), ICON_QUOTA_BYTES=1024 * 1024)
        self.override.enable()
        self.addCleanup(self.override.disable)

    # ---- 辅助方法 -------------------------------------------------------

    def html(self, *links):
        tags = ''.join(f'<link rel="icon" href="{href}">' for href in links)
        return ('<!doctype html><html><head>' + tags + '</head><body>ok</body></html>').encode()

    def icon(self, sizes=ICO_SIZES, color='green'):
        output = io.BytesIO()
        Image.new('RGBA', (256, 256), color).save(output, 'ICO', sizes=list(sizes))
        return output.getvalue()

    def variant(self):
        item = favicons.decode_icon(self.icon())
        item.update({'source_url': FAVICON, 'source_host': 'example.com', 'source_type': 'favicon'})
        return item

    def make_site(self, url=ENDPOINT, name='图片工具', scope='公网'):
        return self.send('/api/sites', {'name': name, 'purpose': '压缩图片',
            'endpoints': [{'id': 'main', 'url': url, 'label': '默认入口', 'scope': scope}]}).json()

    def refresh(self, site, version=None, **extra):
        data = dict(extra)
        if version is not None:
            data['version'] = version
        return self.send(f"/api/sites/{site['id']}/icon/refresh", data)

    def batch(self, **data):
        return self.send('/api/sites/icons/refresh-missing', data)

    def network(self, routes):
        """替换网络层：记录请求 URL，并按 routes(url) 返回 (status, headers, body)。"""
        calls = []

        def request_once(url, hostname, port, ip, max_bytes, deadline, truncate=False):
            calls.append(url)
            return routes(url)

        def resolve_public(hostname, port, deadline):
            return [PUBLIC_IP]

        patcher = patch.multiple('workspace.favicons', request_once=request_once,
                                 resolve_public=resolve_public)
        patcher.start()
        self.addCleanup(patcher.stop)
        return calls

    def media_files(self):
        root = Path(self.temporary.name)
        if not root.exists():
            return []
        return sorted(str(path.relative_to(root)) for path in root.rglob('*')
                      if path.is_file() and not path.name.startswith('.'))

    def assert_unchanged(self, site, version=1):
        self.assertEqual(Site.objects.get(pk=site['id']).version, version)
        self.assertFalse(SiteIconAsset.objects.filter(site__pk=site['id']).exists())
        self.assertEqual(self.media_files(), [])

    def icon_route(self, ico):
        def routes(url):
            if url == ENDPOINT:
                return 200, {'content-type': 'text/html'}, self.html()
            return 200, {'content-type': 'image/x-icon'}, ico
        return routes

    def site_with_history(self, url=ENDPOINT):
        """已保存历史资料的站点：payload 备注/用途/简介 + PreviewAsset + 旧 SiteIconAsset。"""
        site = self.make_site(url)
        saved = self.send(f"/api/sites/{site['id']}", {'version': site['version'],
            'notes': '保留的备注', 'purpose': '保留的用途', 'description': '保留的简介'}, 'patch').json()
        self.assertEqual(saved['version'], 2, saved)
        record = Site.objects.get(pk=site['id'])
        root = Path(self.temporary.name)
        preview_full = f'1/{uuid.uuid4().hex}-preview-full.webp'
        preview_thumb = f'1/{uuid.uuid4().hex}-preview-thumb.webp'
        old_icon = f'1/{uuid.uuid4().hex}-icon.webp'
        files = {preview_full: b'old-preview-full', preview_thumb: b'old-preview-thumb',
                 old_icon: b'old-icon-content' * 64}
        for key, content in files.items():
            target = root / key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        preview = PreviewAsset.objects.create(owner=self.a, site=record, storage_key=preview_full,
            thumbnail_key=preview_thumb, mime='image/webp', width=100, height=80,
            bytes=len(files[preview_full]), thumbnail_bytes=len(files[preview_thumb]),
            source_endpoint_id='main', source_url=record.payload['endpoints'][0]['url'],
            homepage_url='', page_kind='current', user_confirmed_homepage=False,
            captured_at=timezone.now(), revision=uuid.uuid4(), source_fingerprint='f' * 64)
        icon = SiteIconAsset.objects.create(owner=self.a, site=record, storage_key=old_icon,
            mime='image/webp', width=16, height=16, bytes=len(files[old_icon]),
            source_url='https://example.com/old.ico', revision=uuid.uuid4())
        return record, preview, icon

    def history_snapshot(self, record, preview, icon):
        root = Path(self.temporary.name)
        record.refresh_from_db()
        preview.refresh_from_db()
        icon.refresh_from_db()
        return {'version': record.version, 'payload': json.loads(json.dumps(record.payload)),
                'previewRevision': str(preview.revision),
                'previewKeys': (preview.storage_key, preview.thumbnail_key),
                'previewBytes': (preview.bytes, preview.thumbnail_bytes),
                'previewCapturedAt': preview.captured_at,
                'iconRevision': str(icon.revision), 'iconBytes': icon.bytes, 'iconKey': icon.storage_key,
                'files': {name: (root / name).read_bytes() for name in self.media_files()}}

    def assert_history_preserved(self, snapshot, record, preview, icon):
        current = self.history_snapshot(record, preview, icon)
        for key in ('payload', 'version', 'previewRevision', 'previewKeys', 'previewBytes',
                    'previewCapturedAt', 'iconRevision', 'iconBytes', 'iconKey', 'files'):
            self.assertEqual(current[key], snapshot[key], key)

    # ---- 成功路径 -------------------------------------------------------

    def test_multi_frame_ico_refresh_succeeds_with_large_input(self):
        site = self.make_site()
        padded = self.icon() + b'\x00' * (300 * 1024)
        self.assertGreater(len(padded), 200 * 1024)
        self.assertLessEqual(len(padded), favicons.MAX_ICON_FILE_BYTES)
        calls = self.network(self.icon_route(padded))
        response = self.refresh(site)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        asset = SiteIconAsset.objects.get(site__pk=site['id'])
        self.assertEqual(asset.mime, 'image/webp')
        self.assertLessEqual(asset.width, 128)
        self.assertLessEqual(asset.height, 128)
        self.assertLessEqual(asset.bytes, 32 * 1024)
        self.assertEqual(result['siteVersion'], 2)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['sourceHost'], 'example.com')
        self.assertEqual(result['sourceType'], 'favicon')
        self.assertEqual(result['frame'], 128)
        self.assertIn(f"/api/sites/{site['id']}/icon?rev=", result['url'])
        self.assertEqual(result['url'], f"/api/sites/{site['id']}/icon?rev={result['revision']}")
        self.assertEqual(calls, [ENDPOINT, FAVICON])
        stored = Path(self.temporary.name) / asset.storage_key
        self.assertTrue(stored.is_file())
        with Image.open(io.BytesIO(stored.read_bytes())) as encoded:
            self.assertEqual(encoded.format, 'WEBP')
            self.assertLessEqual(max(encoded.size), 128)
        presentation = self.client.get('/api/workspace').json()['sites'][0]['presentation']['icon']
        self.assertTrue(presentation['present'])
        private = self.client.get(presentation['url'])
        self.assertEqual(private.status_code, 200)
        self.assertEqual(private['Cache-Control'], 'private, no-store')
        body = b''.join(private.streaming_content)
        private.close()
        self.assertEqual(len(body), asset.bytes)

    def test_refresh_replaces_existing_icon_and_bumps_version(self):
        site = self.make_site()
        self.network(self.icon_route(self.icon()))
        first = self.refresh(site)
        self.assertEqual(first.status_code, 200, first.content)
        revision = first.json()['revision']
        second = self.refresh(site, version=2)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()['siteVersion'], 3)
        self.assertNotEqual(second.json()['revision'], revision)
        self.assertEqual(SiteIconAsset.objects.count(), 1)
        self.assertEqual(Site.objects.get(pk=site['id']).version, 3)

    def test_refresh_preserves_payload_notes_and_preview_asset(self):
        record, preview, icon = self.site_with_history()
        snapshot = self.history_snapshot(record, preview, icon)
        self.network(self.icon_route(self.icon()))
        response = self.refresh({'id': str(record.pk), 'version': snapshot['version']})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['siteVersion'], snapshot['version'] + 1)
        record.refresh_from_db()
        preview.refresh_from_db()
        icon.refresh_from_db()
        self.assertEqual(record.version, snapshot['version'] + 1)
        self.assertEqual(record.payload, snapshot['payload'])
        self.assertEqual(str(preview.revision), snapshot['previewRevision'])
        self.assertEqual((preview.storage_key, preview.thumbnail_key), snapshot['previewKeys'])
        self.assertEqual((preview.bytes, preview.thumbnail_bytes), snapshot['previewBytes'])
        self.assertEqual(preview.captured_at, snapshot['previewCapturedAt'])
        self.assertEqual(SiteIconAsset.objects.count(), 1)
        self.assertNotEqual(str(icon.revision), snapshot['iconRevision'])
        self.assertNotEqual(icon.bytes, snapshot['iconBytes'])
        self.assertNotEqual(icon.storage_key, snapshot['iconKey'])
        root = Path(self.temporary.name)
        for name, content in snapshot['files'].items():
            self.assertEqual((root / name).read_bytes(), content, name)
        self.assertTrue((root / icon.storage_key).is_file())
        self.assertEqual(AuditEvent.objects.filter(event='icon_refreshed', actor_id=self.a.pk).count(), 1)

    def test_refresh_failures_preserve_payload_and_preview_asset(self):
        ico = self.icon()

        def routes(url):
            if url.endswith('/favicon.ico'):
                if 'fetchfail' in url:
                    return 200, {'content-type': 'image/png'}, b'garbage'
                return 200, {'content-type': 'image/x-icon'}, ico
            return 200, {'content-type': 'text/html'}, self.html()

        self.network(routes)
        cases = (
            ('version', 'https://version.example.com/', 999, None),
            ('quota', 'https://quota.example.com/', 2, override_settings(ICON_QUOTA_BYTES=1)),
            ('fetchfail', 'https://fetchfail.example.com/', 2, None),
        )
        for label, url, version, setting in cases:
            with self.subTest(label):
                record, preview, icon = self.site_with_history(url)
                snapshot = self.history_snapshot(record, preview, icon)
                if setting is not None:
                    setting.enable()
                try:
                    response = self.refresh({'id': str(record.pk)}, version=version)
                finally:
                    if setting is not None:
                        setting.disable()
                self.assertIn(response.status_code, (400, 409, 413), (label, response.content))
                self.assert_history_preserved(snapshot, record, preview, icon)
        self.assertFalse(AuditEvent.objects.filter(event='icon_refreshed').exists())

    def test_ico_frame_selection_prefers_128_then_smallest(self):
        self.assertEqual(favicons.decode_icon(self.icon())['frame'], 128)
        large = favicons.decode_icon(self.icon(sizes=((192, 192), (256, 256))))
        self.assertEqual(large['frame'], 192)
        self.assertLessEqual(large['width'], 128)
        self.assertLessEqual(large['height'], 128)

    # ---- 预算与错误 -----------------------------------------------------

    def test_oversized_source_is_rejected_without_changes(self):
        site = self.make_site()
        oversized = b'\x00' * (favicons.MAX_ICON_FILE_BYTES + 1)
        calls = self.network(self.icon_route(oversized))
        response = self.refresh(site)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['code'], 'icon_refresh_too_large')
        self.assert_unchanged(site)
        self.assertEqual(calls, [ENDPOINT, FAVICON])

    def test_oversized_html_falls_back_to_default_favicon(self):
        # 回归：GitHub 首页约 512KB，超限 HTML 不能让 /favicon.ico 回退被判死。
        site = self.make_site()
        huge = b'<html>' + b'x' * (favicons.MAX_HTML_BYTES + 1)
        ico = self.icon()

        def routes(url):
            if url == ENDPOINT:
                return 200, {'content-type': 'text/html'}, huge
            return 200, {'content-type': 'image/x-icon'}, ico

        calls = self.network(routes)
        response = self.refresh(site)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['sourceType'], 'favicon')
        self.assertEqual(result['sourceHost'], 'example.com')
        self.assertEqual(result['siteVersion'], 2)
        asset = SiteIconAsset.objects.get(site__pk=site['id'])
        self.assertEqual(asset.mime, 'image/webp')
        self.assertLessEqual(asset.bytes, 32 * 1024)
        self.assertEqual(calls, [ENDPOINT, FAVICON])

    def test_failed_html_fetch_falls_back_to_default_favicon(self):
        site = self.make_site()
        ico = self.icon()

        def routes(url):
            if url == ENDPOINT:
                return 503, {'content-type': 'text/html'}, b''
            return 200, {'content-type': 'image/x-icon'}, ico

        calls = self.network(routes)
        response = self.refresh(site)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sourceType'], 'favicon')
        self.assertEqual(calls, [ENDPOINT, FAVICON])

    def test_cumulative_icon_budget_is_enforced(self):
        site = self.make_site()
        junk = b'\x00' * (900 * 1024)
        links = ['/a.png', '/b.png', '/c.png']

        def routes(url):
            if url == ENDPOINT:
                return 200, {'content-type': 'text/html'}, self.html(*links)
            return 200, {'content-type': 'image/png'}, junk

        calls = self.network(routes)
        response = self.refresh(site)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['code'], 'icon_refresh_too_large')
        self.assert_unchanged(site)
        self.assertEqual(len(calls), 4)

    def test_candidate_list_is_capped_at_four(self):
        site = self.make_site()
        links = [f'/i{index}.png' for index in range(8)]

        def routes(url):
            if url == ENDPOINT:
                return 200, {'content-type': 'text/html'}, self.html(*links)
            return 404, {'content-type': 'text/html'}, b''

        calls = self.network(routes)
        response = self.refresh(site)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()['code'], 'icon_refresh_failed')
        self.assert_unchanged(site)
        self.assertEqual(calls, [ENDPOINT] + [f'https://example.com/i{index}.png' for index in range(4)])
        self.assertNotIn(FAVICON, calls)

    def test_timeout_leaves_site_unchanged(self):
        site = self.make_site()
        calls = self.network(lambda url: (_ for _ in ()).throw(
            favicons.FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)))
        response = self.refresh(site)
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()['code'], 'icon_refresh_timeout')
        self.assert_unchanged(site)

    def test_expired_deadline_aborts_before_network(self):
        with patch('workspace.favicons.request_once', side_effect=AssertionError('网络不应被调用')):
            with self.assertRaises(favicons.FaviconError) as raised:
                favicons.fetch_icon(ENDPOINT, deadline=time.monotonic() - 1)
        self.assertEqual(raised.exception.code, 'icon_refresh_timeout')

    def test_undecodable_candidates_are_rejected_without_writes(self):
        cases = {
            'garbage': b'not an image',
            'svg': b'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"/>',
            'html': b'<html><body>not an icon</body></html>',
        }
        for label, payload in cases.items():
            with self.subTest(label):
                SiteIconAsset.objects.all().delete()
                Site.objects.all().delete()
                site = self.make_site()
                calls = self.network(lambda url, payload=payload: (
                    (200, {'content-type': 'text/html'}, self.html()) if url == ENDPOINT
                    else (200, {'content-type': 'image/png'}, payload)))
                response = self.refresh(site)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['code'], 'icon_refresh_invalid')
                self.assert_unchanged(site)
                self.assertEqual(calls[0], ENDPOINT)

    def test_pixel_limit_rejects_oversized_candidate(self):
        site = self.make_site()
        output = io.BytesIO()
        Image.new('RGB', (1600, 1300), 'blue').save(output, 'PNG')
        self.assertGreater(1600 * 1300, favicons.MAX_PIXELS)
        calls = self.network(self.icon_route(output.getvalue()))
        response = self.refresh(site)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'icon_refresh_invalid')
        self.assert_unchanged(site)

    # ---- 同源与网络边界 -------------------------------------------------

    def test_declared_cross_origin_candidate_is_fetched(self):
        # 页面明确声明的跨域公共 CDN 候选不再被同源过滤；实际抓取仍逐跳做公网校验。
        site = self.make_site()
        ico = self.icon()

        def routes(url):
            if url == ENDPOINT:
                return 200, {'content-type': 'text/html'}, self.html(
                    'https://cdn.other.test/icon.png', '//evil.test/favicon.ico', '/same.png')
            if url == 'https://cdn.other.test/icon.png':
                return 200, {'content-type': 'image/png'}, ico
            return 404, {}, b''

        calls = self.network(routes)
        response = self.refresh(site)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sourceUrl'], 'https://cdn.other.test/icon.png')
        self.assertEqual(response.json()['sourceHost'], 'cdn.other.test')
        self.assertEqual(calls, [ENDPOINT, 'https://cdn.other.test/icon.png'])

    def test_redirect_to_private_network_is_rejected(self):
        site = self.make_site()

        def routes(url):
            if url == ENDPOINT:
                return 200, {'content-type': 'text/html'}, self.html()
            return 302, {'location': 'http://127.0.0.1/secret.ico'}, b''

        calls = self.network(routes)
        response = self.refresh(site)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'icon_refresh_private')
        self.assert_unchanged(site)
        self.assertEqual(calls, [ENDPOINT, FAVICON])
        self.assertFalse(any('127.0.0.1' in url for url in calls))

    def test_private_endpoints_never_trigger_network(self):
        for endpoint_url in ('http://127.0.0.1:8080/app', 'http://localhost:3000/'):
            with self.subTest(endpoint_url):
                SiteIconAsset.objects.all().delete()
                Site.objects.all().delete()
                site = self.make_site(endpoint_url)
                calls = self.network(lambda url: self.fail('私网站点不得发起网络请求'))
                response = self.refresh(site)
                self.assertEqual(response.status_code, 400)
                body = response.json()
                self.assertEqual(body['code'], 'icon_refresh_private')
                self.assertIn('扩展', body['error'])
                self.assertEqual(calls, [])
                self.assert_unchanged(site)

    def test_resolve_public_rejects_private_addresses(self):
        for value in ('127.0.0.1', '10.1.2.3', '192.168.1.5', '169.254.1.1',
                      '172.16.0.9', '::1', 'fe80::1', '0.0.0.0'):
            self.assertFalse(favicons.public_address(value), value)
        self.assertTrue(favicons.public_address(PUBLIC_IP))
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.5', 443))]
        with patch('workspace.favicons.socket.getaddrinfo', return_value=answers):
            with self.assertRaises(favicons.FaviconError) as raised:
                favicons.resolve_public('intranet.example.com', 443, time.monotonic() + 3)
        self.assertEqual(raised.exception.code, 'icon_refresh_private')

    # ---- 版本与配额 -----------------------------------------------------

    def test_version_conflict_changes_nothing(self):
        site = self.make_site()
        calls = self.network(lambda url: self.fail('版本冲突时不应抓取'))
        response = self.refresh(site, version=site['version'] + 3)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'version_conflict')
        self.assertEqual(calls, [])
        self.assert_unchanged(site)

    def test_interleaved_version_change_returns_conflict_without_asset(self):
        site = self.make_site()

        def fake_fetch(*args, **kwargs):
            Site.objects.filter(pk=site['id']).update(version=site['version'] + 1)
            return self.variant()

        with patch('workspace.favicons.public_endpoint', return_value={'url': ENDPOINT}), \
                patch('workspace.favicons.fetch_icon', side_effect=fake_fetch):
            response = self.refresh(site, version=site['version'])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'version_conflict')
        self.assertEqual(Site.objects.get(pk=site['id']).version, 2)
        self.assertFalse(SiteIconAsset.objects.exists())
        self.assertEqual(self.media_files(), [])

    def test_quota_exceeded_leaves_no_asset(self):
        site = self.make_site()
        self.network(self.icon_route(self.icon()))
        with override_settings(ICON_QUOTA_BYTES=1):
            response = self.refresh(site)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()['code'], 'icon_quota_exceeded')
        self.assert_unchanged(site)

    # ---- 批量接口 -------------------------------------------------------

    def test_batch_skips_private_sites(self):
        public_site = self.make_site('https://public.example.com/app', name='公开站')
        private_site = self.make_site('http://127.0.0.1:8000/local', name='本机站')
        ico = self.icon()

        def routes(url):
            if url.endswith('/favicon.ico'):
                return 200, {'content-type': 'image/x-icon'}, ico
            return 200, {'content-type': 'text/html'}, self.html()

        calls = self.network(routes)
        response = self.batch()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {'missing': 2, 'checked': 1, 'updated': 1,
            'skippedPrivate': 1, 'failed': [], 'limit': 6})
        self.assertEqual(Site.objects.get(pk=public_site['id']).version, 2)
        self.assertEqual(Site.objects.get(pk=private_site['id']).version, 1)
        self.assertTrue(SiteIconAsset.objects.filter(site__pk=public_site['id']).exists())
        self.assertFalse(SiteIconAsset.objects.filter(site__pk=private_site['id']).exists())
        self.assertEqual(calls, ['https://public.example.com/app',
                                 'https://public.example.com/favicon.ico'])

    def test_batch_reports_partial_success(self):
        sites = [self.make_site(f'https://{letter}.example.com/', name=letter.upper())
                 for letter in ('a', 'b', 'c')]
        ico = self.icon()

        def routes(url):
            if url.endswith('/favicon.ico') or url.endswith('/apple-touch-icon.png'):
                if 'b.example.com' in url:
                    return 200, {'content-type': 'image/png'}, b'garbage'
                return 200, {'content-type': 'image/x-icon'}, ico
            return 200, {'content-type': 'text/html'}, self.html()

        self.network(routes)
        data = self.batch().json()
        self.assertEqual(data['missing'], 3)
        self.assertEqual(data['checked'], 3)
        self.assertEqual(data['updated'], 2)
        self.assertEqual(data['skippedPrivate'], 0)
        self.assertEqual([item['id'] for item in data['failed']], [sites[1]['id']])
        self.assertEqual(data['failed'][0]['name'], 'B')
        self.assertEqual(data['failed'][0]['code'], 'icon_refresh_invalid')
        self.assertEqual(Site.objects.get(pk=sites[0]['id']).version, 2)
        self.assertEqual(Site.objects.get(pk=sites[2]['id']).version, 2)
        self.assertEqual(Site.objects.get(pk=sites[1]['id']).version, 1)
        self.assertTrue(SiteIconAsset.objects.filter(site__pk=sites[0]['id']).exists())
        self.assertFalse(SiteIconAsset.objects.filter(site__pk=sites[1]['id']).exists())
        self.assertTrue(SiteIconAsset.objects.filter(site__pk=sites[2]['id']).exists())

    def test_batch_limit_is_clamped(self):
        for index in range(8):
            self.make_site(f'https://s{index}.example.com/', name=f'S{index}')
        ico = self.icon()

        def routes(url):
            if url.endswith('/favicon.ico'):
                return 200, {'content-type': 'image/x-icon'}, ico
            return 200, {'content-type': 'text/html'}, self.html()

        self.network(routes)
        first = self.batch(limit=999).json()
        self.assertEqual(first['limit'], 6)
        self.assertEqual(first['missing'], 8)
        self.assertEqual(first['checked'], 6)
        self.assertEqual(first['updated'], 6)
        self.assertEqual(SiteIconAsset.objects.count(), 6)
        second = self.batch(limit=0).json()
        self.assertEqual(second['limit'], 1)
        self.assertEqual(second['missing'], 2)
        self.assertEqual(second['checked'], 1)
        self.assertEqual(second['updated'], 1)
        invalid = self.batch(limit='many')
        self.assertEqual(invalid.status_code, 400)

    # ---- 权限、CSRF、状态 ----------------------------------------------

    def test_refresh_requires_session_csrf_and_owner_scope(self):
        site = self.make_site()
        check_client = Client(enforce_csrf_checks=True)
        check_client.force_login(self.a)
        denied = check_client.post(f"/api/sites/{site['id']}/icon/refresh", '{}',
                                   content_type='application/json')
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()['code'], 'csrf_failed')
        self.client.logout()
        anonymous = self.send(f"/api/sites/{site['id']}/icon/refresh", {})
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(anonymous.json()['code'], 'auth_required')
        self.client.force_login(self.b)
        other = self.send(f"/api/sites/{site['id']}/icon/refresh", {})
        self.assertEqual(other.status_code, 404)
        self.client.force_login(self.a)
        batch_denied = Client(enforce_csrf_checks=True)
        batch_denied.force_login(self.a)
        self.assertEqual(batch_denied.post('/api/sites/icons/refresh-missing', '{}',
                                           content_type='application/json').status_code, 403)

    def test_deleted_or_archived_site_is_rejected(self):
        site = self.make_site()
        site_record = Site.objects.get(pk=site['id'])
        site_record.payload = {**site_record.payload, 'archived': True}
        site_record.save(update_fields=['payload'])
        calls = self.network(lambda url: self.fail('删除/归档站点不应抓取'))
        response = self.refresh(site)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'icon_refresh_unavailable')
        self.assertEqual(calls, [])
        self.assert_unchanged(site)
