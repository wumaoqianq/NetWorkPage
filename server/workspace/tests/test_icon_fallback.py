"""设备 Bearer 自动图标兜底：跨域声明候选、SVG/栅格混排、SSRF 边界与条件创建。

全部用例 mock 网络层（favicons.request_once / resolve_public），不访问真实外网。
"""
import hashlib
import io
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

from django.test import override_settings
from PIL import Image

from workspace import favicons
from workspace.models import AuditEvent, CaptureReceipt, Site, SiteIconAsset
from workspace.tests.base import ApiTest

PUBLIC_IP = '93.184.216.34'
PAGE = 'https://example.com/tool'
FAVICON = 'https://example.com/favicon.ico'
APPLE_TOUCH = 'https://example.com/apple-touch-icon.png'
FALLBACK = '/api/extension/v2/captures/{}/icon/fallback'
ICO_SIZES = ((16, 16), (32, 32), (48, 48), (128, 128), (256, 256))


def png_bytes(width=128, height=128, color='green'):
    output = io.BytesIO()
    Image.new('RGBA', (width, height), color).save(output, 'PNG')
    return output.getvalue()


def ico_bytes(color='green'):
    output = io.BytesIO()
    Image.new('RGBA', (256, 256), color).save(output, 'ICO', sizes=list(ICO_SIZES))
    return output.getvalue()


def page_html(*links):
    return ('<!doctype html><html><head>' + ''.join(links) + '</head><body>ok</body></html>').encode()


def icon_link(href, content_type='image/png', sizes='', media='', rel='icon'):
    attrs = f'rel="{rel}" href="{href}"'
    if content_type:
        attrs += f' type="{content_type}"'
    if sizes:
        attrs += f' sizes="{sizes}"'
    if media:
        attrs += f' media="{media}"'
    return f'<link {attrs}>'


class IconFallbackTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.override = override_settings(MEDIA_ROOT=Path(self.temporary.name),
                                          ICON_QUOTA_BYTES=1024 * 1024)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.headers = self.connect(self.a)

    # ---- 辅助方法 -------------------------------------------------------

    def connect(self, user):
        self.client.force_login(user)
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'Chrome 120',
            'extensionVersion': '1.3.3', 'protocolVersion': 2}).json()
        return {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}

    def capture(self, url=PAGE, scope='公网', headers=None):
        capture_id = str(uuid.uuid4())
        data = {'clientCaptureId': capture_id, 'url': url, 'title': '示例站点', 'description': '',
            'descriptionSource': 'manual', 'purpose': '', 'category': '', 'tags': [],
            'collectionIds': [], 'pinned': False, 'later': False, 'homepageUrl': '', 'scope': scope}
        response = self.send('/api/extension/v2/captures', data, **(headers or self.headers))
        self.assertEqual(response.status_code, 200, response.content)
        site = Site.objects.get(pk=response.json()['site']['id'])
        return capture_id, site

    def fallback(self, capture_id, data=None, headers=None):
        return self.send(FALLBACK.format(capture_id), data if data is not None else {},
                         **(headers or self.headers))

    def network(self, routes, resolve=None):
        """替换网络层；routes(url)->(status, headers, body)，resolve(host)->[ip]。"""
        calls = []

        def request_once(url, hostname, port, ip, max_bytes, deadline, truncate=False):
            calls.append(url)
            return routes(url)

        def resolve_public(hostname, port, deadline):
            if resolve is not None:
                return resolve(hostname)
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
        return sorted(path.relative_to(root).as_posix() for path in root.rglob('*')
                      if path.is_file() and not path.name.startswith('.'))

    def variant(self, color='green'):
        item = favicons.decode_icon(ico_bytes(color))
        item.update({'source_url': FAVICON, 'source_host': 'example.com',
                     'source_type': 'favicon', 'theme': None, 'sizes': '', 'diagnostics': []})
        return item

    def assert_no_writes(self, site, version=1):
        site.refresh_from_db()
        self.assertEqual(site.version, version)
        self.assertFalse(SiteIconAsset.objects.filter(site=site).exists())
        self.assertEqual(self.media_files(), [])
        self.assertFalse(AuditEvent.objects.filter(event='icon_fallback_filled').exists())

    def route_page(self, links=(), icons=None, page=PAGE):
        icons = icons or {}

        def routes(url):
            if url == page:
                return 200, {'content-type': 'text/html'}, page_html(*links)
            if url in icons:
                return 200, {'content-type': 'image/png'}, icons[url]
            return 404, {'content-type': 'text/html'}, b''

        return routes

    # ---- 候选发现：属性、排序与 SVG 过滤 --------------------------------

    def test_candidate_discovery_records_attributes_and_puts_defaults_last(self):
        html = page_html(
            '<link rel="apple-touch-icon" type="image/png" sizes="128x128" '
            'href="https://cdn.example.com/apple-128.png">',
            icon_link('https://cdn.example.com/icon-64.png', sizes='64x64'),
            '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
            icon_link('https://cdn.example.com/dark.png', sizes='128x128',
                      media='(prefers-color-scheme: dark)'))
        candidates, info = favicons.discover_icon_candidates(html, PAGE, PAGE)
        urls = [candidate['url'] for candidate in candidates]
        # 已声明栅格按 rel=icon 优先于 apple-touch；dark 排后；默认同源路径永远最后。
        self.assertEqual(urls, ['https://cdn.example.com/icon-64.png',
                                'https://cdn.example.com/apple-128.png',
                                'https://cdn.example.com/dark.png', FAVICON])
        self.assertEqual((info['declared'], info['raster'], info['svg'], info['svgOnly']),
                         (4, 3, 1, False))
        by_url = {candidate['url']: candidate for candidate in candidates}
        self.assertTrue(by_url[urls[0]]['crossOrigin'])
        self.assertEqual(by_url[urls[0]]['sizes'], '64x64')
        self.assertEqual(by_url[urls[0]]['kind'], 'link')
        self.assertEqual(by_url[urls[1]]['kind'], 'apple-touch')
        self.assertEqual(by_url[urls[2]]['theme'], 'dark')
        self.assertFalse(by_url[FAVICON]['crossOrigin'])

    def test_light_theme_preferred_over_dark(self):
        html = page_html(
            icon_link('https://cdn.example.com/dark.png', sizes='128x128',
                      media='(prefers-color-scheme: dark)'),
            icon_link('https://cdn.example.com/light.png', sizes='128x128',
                      media='(prefers-color-scheme: light)'))
        candidates, _ = favicons.discover_icon_candidates(html, PAGE, PAGE)
        self.assertEqual([candidate['url'] for candidate in candidates[:2]],
                         ['https://cdn.example.com/light.png',
                          'https://cdn.example.com/dark.png'])

    def test_svg_only_discovery_is_flagged(self):
        html = page_html('<link rel="icon" href="/a.svg" type="image/svg+xml">',
                         '<link rel="icon" href="/b.svg">')
        candidates, info = favicons.discover_icon_candidates(html, PAGE, PAGE)
        self.assertTrue(info['svgOnly'])
        self.assertEqual([candidate['url'] for candidate in candidates], [FAVICON, APPLE_TOUCH])

    # ---- 千问式：跨域公共 CDN + light/dark 主题 -------------------------

    def test_qianwen_style_cross_origin_light_candidate_fills_icon(self):
        capture_id, site = self.capture()
        light = 'https://img.alicdn.com/tfs/TB1light_128.png'
        dark = 'https://img.alicdn.com/tfs/TB1dark_128.png'
        # dark 声明在前：服务端应按主题排序优先 light，而不是盲取第一个。
        links = (icon_link(dark, sizes='128x128', media='(prefers-color-scheme: dark)'),
                 icon_link(light, sizes='128x128', media='(prefers-color-scheme: light)'))
        calls = self.network(self.route_page(links, {light: png_bytes(128, 128, 'red')}))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['siteVersion'], 2)
        self.assertEqual(result['sourceHost'], 'img.alicdn.com')
        self.assertEqual(result['sourceUrl'], light)
        self.assertEqual(result['sourceType'], 'link')
        self.assertEqual(result['mime'], 'image/webp')
        self.assertLessEqual(result['bytes'], 32 * 1024)
        self.assertLessEqual(max(result['width'], result['height']), 128)
        self.assertEqual(result['url'], f"/api/sites/{site.pk}/icon?rev={result['revision']}")
        self.assertEqual(calls, [PAGE, light])
        self.assertFalse(any(dark == url for url in calls))
        self.assertNotIn(FAVICON, calls)
        # 落库为真实 WebP，siteVersion+1 且记录审计事件；绝不接受 SVG/data 或页面正文。
        asset = SiteIconAsset.objects.get(site=site)
        stored = Path(self.temporary.name) / asset.storage_key
        self.assertTrue(stored.is_file())
        with Image.open(io.BytesIO(stored.read_bytes())) as encoded:
            self.assertEqual(encoded.format, 'WEBP')
            self.assertLessEqual(max(encoded.size), 128)
        site.refresh_from_db()
        self.assertEqual(site.version, 2)
        self.assertEqual(AuditEvent.objects.filter(event='icon_fallback_filled', actor_id=self.a.pk).count(), 1)
        private = self.client.get(result['url'])
        self.assertEqual(private.status_code, 200)
        private.close()
        # 诊断只含候选摘要（host/类型/theme/字节/耗时），不含页面正文。
        diagnostics = result['diagnostics']
        success = [entry for entry in diagnostics if entry['ok']]
        self.assertEqual(len(success), 1, diagnostics)
        chosen = success[0]
        self.assertEqual(chosen['host'], 'img.alicdn.com')
        self.assertEqual(chosen['type'], 'image/png')
        self.assertEqual(chosen['theme'], 'light')
        self.assertEqual(chosen['sizes'], '128x128')
        self.assertGreater(chosen['bytes'], 0)
        self.assertGreaterEqual(chosen['elapsedMs'], 0)
        self.assertNotIn('TB1', str([entry['host'] for entry in diagnostics]))

    # ---- ChatGPT 式：SVG + 栅格混排 -------------------------------------

    def test_svg_mixed_with_raster_selects_raster_png(self):
        capture_id, site = self.capture()
        raster = 'https://example.com/favicon-48.png'
        apple = 'https://example.com/apple-touch-icon-180.png'
        links = ('<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
                 icon_link(raster, sizes='48x48'),
                 icon_link(apple, sizes='180x180', rel='apple-touch-icon'))
        calls = self.network(self.route_page(links, {raster: png_bytes(48, 48, 'blue')}))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['sourceUrl'], raster)
        self.assertEqual(result['sourceType'], 'link')
        self.assertEqual(calls, [PAGE, raster])
        self.assertFalse(any(url.endswith('.svg') for url in calls), calls)
        self.assertTrue(SiteIconAsset.objects.filter(site=site).exists())

    def test_svg_only_page_fails_with_icon_svg_only_and_no_writes(self):
        capture_id, site = self.capture()
        svg = 'https://example.com/favicon.svg'
        links = ('<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
                 '<link rel="shortcut icon" href="/icon.svg">')
        calls = self.network(self.route_page(links))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 415, response.content)
        self.assertEqual(response.json()['code'], 'icon_svg_only')
        self.assertIn('SVG', response.json()['error'])
        self.assert_no_writes(site)
        self.assertFalse(any('svg' in url for url in calls), calls)
        # 只允许回退到默认同源 favicon 路径，且都失败后给出明确 SVG-only 终态。
        self.assertEqual(calls, [PAGE, FAVICON, APPLE_TOUCH])
        self.assertNotIn(svg, calls)

    # ---- 已有图标：icon_exists 且绝不覆盖 --------------------------------

    def test_existing_icon_returns_icon_exists_without_overwrite(self):
        capture_id, site = self.capture()
        content = b'existing-icon-content' * 64
        root = Path(self.temporary.name)
        key = f'1/{uuid.uuid4().hex}-icon.webp'
        target = root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        asset = SiteIconAsset.objects.create(owner=self.a, site=site, storage_key=key,
            mime='image/webp', width=32, height=32, bytes=len(content),
            source_url='https://example.com/custom.png', revision=uuid.uuid4())
        revision, digest = str(asset.revision), hashlib.sha256(content).hexdigest()
        calls = self.network(lambda url: self.fail('已有图标时不得发起抓取'))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {'status': 'icon_exists', 'siteVersion': 1})
        self.assertEqual(calls, [])
        asset.refresh_from_db()
        self.assertEqual(str(asset.revision), revision)
        self.assertEqual(asset.storage_key, key)
        self.assertEqual(hashlib.sha256((root / key).read_bytes()).hexdigest(), digest)
        site.refresh_from_db()
        self.assertEqual(site.version, 1)
        self.assertFalse(AuditEvent.objects.filter(event='icon_fallback_filled').exists())

    # ---- 回执权限、状态与私网拒绝 ---------------------------------------

    def test_unknown_capture_is_retryable_not_found(self):
        calls = self.network(lambda url: self.fail('无回执不得抓取'))
        response = self.fallback(str(uuid.uuid4()))
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(response.json()['code'], 'capture_not_found')
        self.assertEqual(calls, [])

    def test_capture_of_another_owner_is_not_found(self):
        capture_id, site = self.capture()
        other = self.connect(self.b)
        calls = self.network(lambda url: self.fail('非 owner 不得抓取'))
        response = self.fallback(capture_id, headers=other)
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(response.json()['code'], 'capture_not_found')
        self.assertEqual(calls, [])
        self.assert_no_writes(site)

    def test_capture_without_icon_permission_is_forbidden(self):
        capture_id, site = self.capture()
        CaptureReceipt.objects.filter(owner=self.a, client_capture_id=capture_id).update(
            can_attach_icon=False)
        calls = self.network(lambda url: self.fail('无图标许可不得抓取'))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(response.json()['code'], 'forbidden')
        self.assertEqual(calls, [])
        self.assert_no_writes(site)

    def test_deleted_or_archived_site_is_rejected(self):
        for flag in ('deleted', 'archived'):
            with self.subTest(flag):
                capture_id, site = self.capture(url=f'https://{flag}.example.com/tool')
                site.payload = {**site.payload, flag: True}
                site.save(update_fields=['payload'])
                calls = self.network(lambda url: self.fail('删除/归档站点不得抓取'))
                response = self.fallback(capture_id)
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()['code'], 'icon_refresh_unavailable')
                self.assertEqual(calls, [])
                self.assertFalse(SiteIconAsset.objects.filter(site=site).exists())
                self.assertEqual(self.media_files(), [])

    def test_private_or_local_endpoint_never_requests_network(self):
        for endpoint in ('http://127.0.0.1:8080/app', 'http://localhost:3000/',
                         'http://10.1.2.3/tool'):
            with self.subTest(endpoint):
                capture_id, site = self.capture(url=endpoint)
                calls = self.network(lambda url: self.fail('私网 endpoint 不得发起公网请求'))
                response = self.fallback(capture_id)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()['code'], 'icon_refresh_private')
                self.assertIn('扩展', response.json()['error'])
                self.assertEqual(calls, [])
                self.assert_no_writes(site)

    def test_dns_private_endpoint_is_rejected_without_http_request(self):
        capture_id, site = self.capture(url='https://intranet.example.com/tool')

        def resolve(hostname):
            raise favicons.FaviconError(favicons.PRIVATE_MESSAGE, 'icon_refresh_private', 400)

        calls = self.network(lambda url: self.fail('DNS 私网不得发起 HTTP 请求'), resolve=resolve)
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['code'], 'icon_refresh_private')
        self.assertEqual(calls, [])
        self.assert_no_writes(site)

    # ---- 条件创建：并发已有图标 / 版本冲突 -------------------------------

    def test_concurrent_asset_created_during_fetch_is_not_overwritten(self):
        capture_id, site = self.capture()
        root = Path(self.temporary.name)
        content, key = b'concurrent-icon-bytes', f'1/{uuid.uuid4().hex}-icon.webp'
        owner = self.a
        site_id = site.pk

        def fake_fetch(*args, **kwargs):
            # 模拟另一次兜底在服务器抓取期间已落库：本次必须返回 icon_exists 且不覆盖。
            target = root / key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            SiteIconAsset.objects.create(owner=owner, site_id=site_id, storage_key=key,
                mime='image/webp', width=32, height=32, bytes=len(content),
                source_url='https://cdn.example.com/concurrent.png', revision=uuid.uuid4())
            return self.variant()

        with patch('workspace.favicons.public_endpoint', return_value={'url': PAGE}), \
                patch('workspace.favicons.fetch_icon', side_effect=fake_fetch):
            response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {'status': 'icon_exists', 'siteVersion': 1})
        asset = SiteIconAsset.objects.get(site=site)
        self.assertEqual(asset.storage_key, key)
        self.assertEqual(asset.source_url, 'https://cdn.example.com/concurrent.png')
        # 本次预发布的新文件已回收，只剩并发写入的那一张。
        self.assertEqual(self.media_files(), [key])
        site.refresh_from_db()
        self.assertEqual(site.version, 1)
        self.assertFalse(AuditEvent.objects.filter(event='icon_fallback_filled').exists())

    def test_version_conflict_during_fetch_leaves_no_dirty_write(self):
        capture_id, site = self.capture()
        site_id = site.pk

        def fake_fetch(*args, **kwargs):
            Site.objects.filter(pk=site_id).update(version=2)
            return self.variant()

        with patch('workspace.favicons.public_endpoint', return_value={'url': PAGE}), \
                patch('workspace.favicons.fetch_icon', side_effect=fake_fetch):
            response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()['code'], 'version_conflict')
        site.refresh_from_db()
        self.assertEqual(site.version, 2)
        self.assertFalse(SiteIconAsset.objects.exists())
        self.assertEqual(self.media_files(), [])
        self.assertFalse(AuditEvent.objects.filter(event='icon_fallback_filled').exists())

    # ---- 跨域候选 SSRF：逐候选拒绝且继续 --------------------------------

    def test_private_and_dangerous_port_candidates_are_skipped(self):
        capture_id, site = self.capture()
        links = (icon_link('http://127.0.0.1/secret.png'),
                 icon_link('http://192.168.1.9/secret.png'),
                 icon_link('http://169.254.1.1/secret.png'),
                 icon_link('https://cdn.example.com:22/icon.png'))
        # 声明的内网/危险端口候选在预筛阶段被拒绝（计入 rejected 而不占候选名额），
        # 随后继续走站点默认 favicon。
        calls = self.network(self.route_page(links, {FAVICON: ico_bytes()}))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sourceUrl'], FAVICON)
        self.assertEqual(calls, [PAGE, FAVICON])
        for url in calls:
            self.assertNotIn('127.0.0.1', url)
            self.assertNotIn('192.168.1.9', url)
            self.assertNotIn('169.254.1.1', url)
            self.assertNotIn(':22/', url)
        self.assertEqual(SiteIconAsset.objects.filter(site=site).count(), 1)

    def test_private_candidate_skipped_and_next_valid_candidate_used(self):
        capture_id, site = self.capture()
        valid = 'https://cdn.example.com/logo.png'
        links = (icon_link('http://127.0.0.1/secret.png'),
                 icon_link('https://cdn.example.com:6379/icon.png'),
                 icon_link(valid, sizes='128x128'))
        calls = self.network(self.route_page(links, {valid: png_bytes(128, 128)}))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sourceUrl'], valid)
        self.assertEqual(calls, [PAGE, valid])
        self.assertFalse(any('127.0.0.1' in url or ':6379/' in url for url in calls))

    def test_redirect_to_private_is_skipped_and_next_candidate_used(self):
        capture_id, site = self.capture()
        redirect = 'https://cdn.example.com/redirect.png'
        valid = 'https://cdn.example.com/logo.png'
        links = (icon_link(redirect, sizes='128x128'), icon_link(valid, sizes='128x128'))

        def routes(url):
            if url == PAGE:
                return 200, {'content-type': 'text/html'}, page_html(*links)
            if url == redirect:
                return 302, {'location': 'http://127.0.0.1/secret.png'}, b''
            if url == valid:
                return 200, {'content-type': 'image/png'}, png_bytes(128, 128)
            return 404, {}, b''

        calls = self.network(routes)
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sourceUrl'], valid)
        self.assertEqual(calls, [PAGE, redirect, valid])
        self.assertFalse(any('127.0.0.1' in url for url in calls))

    def test_dns_private_declared_candidate_is_skipped(self):
        capture_id, site = self.capture()
        intranet = 'https://intranet.example.com/icon.png'
        valid = 'https://cdn.example.com/logo.png'
        links = (icon_link(intranet), icon_link(valid, sizes='128x128'))

        def resolve(hostname):
            if hostname == 'intranet.example.com':
                raise favicons.FaviconError(favicons.PRIVATE_MESSAGE, 'icon_refresh_private', 400)
            return [PUBLIC_IP]

        calls = self.network(self.route_page(links, {valid: png_bytes(128, 128)}), resolve=resolve)
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sourceUrl'], valid)
        self.assertEqual(calls, [PAGE, valid])
        self.assertFalse(any('intranet.example.com' in url for url in calls))

    # ---- 候选/字节/像素/损坏/超时预算 -----------------------------------

    def test_candidate_cap_limits_requests(self):
        capture_id, site = self.capture()
        links = tuple(icon_link(f'https://cdn.example.com/i{index}.png') for index in range(6))
        calls = self.network(self.route_page(links))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 502, response.content)
        self.assertEqual(response.json()['code'], 'icon_refresh_failed')
        self.assertEqual(calls, [PAGE] + [f'https://cdn.example.com/i{index}.png' for index in range(4)])
        self.assert_no_writes(site)

    def test_cumulative_byte_budget_is_enforced(self):
        capture_id, site = self.capture()
        junk = b'\x00' * (900 * 1024)
        links = tuple(icon_link(f'https://cdn.example.com/{name}.png') for name in ('a', 'b', 'c'))
        calls = self.network(self.route_page(links, {
            f'https://cdn.example.com/{name}.png': junk for name in ('a', 'b', 'c')}))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 413, response.content)
        self.assertEqual(response.json()['code'], 'icon_refresh_too_large')
        self.assert_no_writes(site)
        self.assertEqual(len(calls), 4)

    def test_single_file_over_limit_is_rejected(self):
        capture_id, site = self.capture()
        oversized = b'\x00' * (favicons.MAX_ICON_FILE_BYTES + 1)
        links = (icon_link('https://cdn.example.com/huge.png'),)
        calls = self.network(self.route_page(links, {'https://cdn.example.com/huge.png': oversized}))
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 413, response.content)
        self.assertEqual(response.json()['code'], 'icon_refresh_too_large')
        self.assertEqual(calls, [PAGE, 'https://cdn.example.com/huge.png'])
        self.assert_no_writes(site)

    def test_pixel_limit_and_damaged_candidate_are_rejected(self):
        cases = {'pixels': None, 'garbage': b'not an image',
                 'html': b'<html><body>not an icon</body></html>'}
        output = io.BytesIO()
        Image.new('RGB', (1600, 1300), 'blue').save(output, 'PNG')
        self.assertGreater(1600 * 1300, favicons.MAX_PIXELS)
        cases['pixels'] = output.getvalue()
        for label, payload in cases.items():
            with self.subTest(label):
                page = f'https://example.com/{label}'
                capture_id, site = self.capture(url=page)
                url = f'https://cdn.example.com/{label}.png'
                links = (icon_link(url, sizes='128x128'),)
                self.network(self.route_page(links, {url: payload, FAVICON: payload,
                                                    APPLE_TOUCH: payload}, page=page))
                response = self.fallback(capture_id)
                self.assertEqual(response.status_code, 400, (label, response.content))
                self.assertEqual(response.json()['code'], 'icon_refresh_invalid')
                self.assert_no_writes(site)

    def test_timeout_maps_to_504_without_writes(self):
        capture_id, site = self.capture()

        def routes(url):
            if url == PAGE:
                return 200, {'content-type': 'text/html'}, page_html()
            raise favicons.FaviconError('获取网站图标超时', 'icon_refresh_timeout', 504)

        self.network(routes)
        response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 504, response.content)
        self.assertEqual(response.json()['code'], 'icon_refresh_timeout')
        self.assert_no_writes(site)

    def test_quota_exceeded_leaves_no_asset(self):
        capture_id, site = self.capture()
        self.network(self.route_page((), {FAVICON: ico_bytes()}))
        with override_settings(ICON_QUOTA_BYTES=1):
            response = self.fallback(capture_id)
        self.assertEqual(response.status_code, 413, response.content)
        self.assertEqual(response.json()['code'], 'icon_quota_exceeded')
        self.assert_no_writes(site)

    # ---- 请求体 URL 不生效 ----------------------------------------------

    def test_request_body_url_is_ignored_and_default_favicon_used(self):
        capture_id, site = self.capture()
        evil = 'https://evil.example.com/icon.png'
        calls = self.network(self.route_page((), {FAVICON: ico_bytes()}))
        response = self.fallback(capture_id, {'url': evil})
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['sourceUrl'], FAVICON)
        self.assertEqual(result['sourceHost'], 'example.com')
        self.assertEqual(result['sourceType'], 'favicon')
        self.assertEqual(result['frame'], 128)
        self.assertEqual(calls, [PAGE, FAVICON])
        self.assertFalse(any('evil.example.com' in url for url in calls))
        self.assertEqual(Site.objects.get(pk=site.pk).version, 2)

    # ---- 基础契约 -------------------------------------------------------

    def test_fallback_requires_bearer_device(self):
        capture_id, site = self.capture()
        anonymous = self.client
        anonymous.logout()
        response = self.send(FALLBACK.format(capture_id), {})
        self.assertEqual(response.status_code, 401, response.content)
        self.assertEqual(response.json()['code'], 'auth_required')

    def test_fallback_appends_audit_event_and_idempotent_retry_returns_icon_exists(self):
        capture_id, site = self.capture()
        self.network(self.route_page((), {FAVICON: ico_bytes()}))
        first = self.fallback(capture_id)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()['siteVersion'], 2)
        self.assertEqual(AuditEvent.objects.filter(event='icon_fallback_filled', actor_id=self.a.pk).count(), 1)
        second = self.fallback(capture_id)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(second.json()['status'], 'icon_exists')
        self.assertEqual(second.json()['siteVersion'], 2)
        self.assertEqual(SiteIconAsset.objects.count(), 1)
        self.assertEqual(AuditEvent.objects.filter(event='icon_fallback_filled').count(), 1)
