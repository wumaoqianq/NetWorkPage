"""阶段 D：服务端公开图标 Job 层端到端测试。

全部注入 fetcher 或 patch 默认抓取，不访问真实外网；夹具沿用 test_icon_fallback.py
的 Bearer 设备 + v2 收藏 + CaptureReceipt 模式。
"""
import io
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image

from workspace import favicons
from workspace.asset_baseline import site_source_fingerprint, source_url_fingerprint
from workspace.icon_jobs import (MAX_ATTEMPTS, enqueue_icon_job, icon_job_dto,
                                 requeue_icon_job, run_icon_jobs)
from workspace.models import CaptureReceipt, IconJob, Site, SiteIconAsset
from workspace.tests.base import ApiTest

PAGE = 'https://example.com/tool'
FAVICON = 'https://example.com/favicon.ico'


def png_bytes(width=32, height=32, color='green'):
    output = io.BytesIO()
    Image.new('RGBA', (width, height), color).save(output, 'PNG')
    return output.getvalue()


class IconJobTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.override = override_settings(MEDIA_ROOT=Path(self.temporary.name),
                                          ICON_QUOTA_BYTES=1024 * 1024)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.headers = self.connect(self.a)

    # ---- 夹具 -------------------------------------------------------------

    def connect(self, user):
        self.client.force_login(user)
        code = self.send('/api/extension/pairing-code').json()['code']
        paired = self.send('/api/extension/pair', {'code': code, 'name': 'Chrome',
            'protocolVersion': 2}).json()
        return {'HTTP_AUTHORIZATION': 'Bearer ' + paired['token']}

    def capture(self, url=PAGE, scope='公网', auto_icon=None, headers=None):
        capture_id = str(uuid.uuid4())
        data = {'clientCaptureId': capture_id, 'url': url, 'title': '示例站点', 'description': '',
            'descriptionSource': 'manual', 'purpose': '', 'category': '', 'tags': [],
            'collectionIds': [], 'pinned': False, 'later': False, 'homepageUrl': '', 'scope': scope}
        if auto_icon is not None:
            data['autoIcon'] = auto_icon
        response = self.send('/api/extension/v2/captures', data, **(headers or self.headers))
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        site = Site.objects.get(pk=result['site']['id'])
        return capture_id, result, site

    def variant(self, color='green'):
        """模拟 favicons.fetch_icon 的完整返回（真实 WebP 内容）。"""
        item = favicons.decode_icon(png_bytes(32, 32, color))
        item.update({'source_url': FAVICON, 'source_host': 'example.com',
                     'source_type': 'favicon', 'frame': None, 'diagnostics': []})
        return item

    def add_icon(self, site):
        key = f'{site.owner_id}/{uuid.uuid4().hex}-icon.webp'
        target = Path(self.temporary.name) / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b'custom-icon-content')
        return SiteIconAsset.objects.create(owner_id=site.owner_id, site=site, storage_key=key,
            mime='image/webp', width=16, height=16, bytes=len(b'custom-icon-content'),
            source_url='https://example.com/custom.png', revision=uuid.uuid4())

    def media_files(self):
        root = Path(self.temporary.name)
        if not root.exists():
            return []
        return sorted(path.relative_to(root).as_posix() for path in root.rglob('*')
                      if path.is_file() and not path.name.startswith('.'))

    def assert_dt(self, actual, expected):
        self.assertLess(abs((actual - expected).total_seconds()), 1.0)

    # ---- 1. 收藏同事务入队、HTTP 不抓外网 --------------------------------

    def test_capture_enqueues_without_network_fetch(self):
        with patch('workspace.icon_jobs._default_fetcher') as default_fetch, \
                patch('workspace.favicons.fetch_icon') as net_fetch:
            capture_id, result, site = self.capture()
        default_fetch.assert_not_called()
        net_fetch.assert_not_called()
        job = IconJob.objects.get(site=site)
        self.assertEqual(job.owner_id, self.a.pk)
        self.assertEqual(job.capture_id, capture_id)
        self.assertEqual(job.phase, 'pending')
        self.assertEqual(job.attempts, 0)
        self.assertEqual(job.source_version, site_source_fingerprint(site))
        self.assertTrue(CaptureReceipt.objects.filter(owner=self.a, client_capture_id=capture_id).exists())
        self.assertEqual(result['site']['iconJob'],
                         {'queued': True, 'phase': 'pending', 'attempts': 0})

    # ---- 2. autoIcon=False / 非 bool -------------------------------------

    def test_auto_icon_false_does_not_enqueue(self):
        _, result, site = self.capture(auto_icon=False)
        self.assertFalse(IconJob.objects.filter(site=site).exists())
        self.assertEqual(result['site']['iconJob'],
                         {'queued': False, 'phase': '', 'attempts': 0})

    def test_auto_icon_non_bool_is_rejected(self):
        response = self.send('/api/extension/v2/captures', {
            'clientCaptureId': str(uuid.uuid4()), 'url': PAGE, 'title': 'x',
            'autoIcon': 'yes'}, **self.headers)
        self.assertEqual(response.status_code, 400)

    # ---- 3. 已有图标的重复收藏不入队 ------------------------------------

    def test_existing_icon_duplicate_capture_does_not_enqueue(self):
        _, _, site = self.capture()
        self.add_icon(site)
        IconJob.objects.filter(site=site).delete()  # 隔离：只看重复收藏是否新入队
        _, result2, _ = self.capture(url=PAGE)
        self.assertFalse(IconJob.objects.filter(site=site).exists())
        self.assertFalse(result2['site']['iconJob']['queued'])

    # ---- 4. 本机/局域网不入队 -------------------------------------------

    def test_private_scope_or_local_url_not_enqueued(self):
        cases = [(f'https://private{i}.example.com/app', scope)
                 for i, scope in enumerate(('内网', '局域网'))]
        cases.append(('http://127.0.0.1:8080/app', '公网'))
        for url, scope in cases:
            with self.subTest(url=url, scope=scope):
                _, result, site = self.capture(url=url, scope=scope)
                self.assertFalse(IconJob.objects.filter(site=site).exists())
                self.assertFalse(result['site']['iconJob']['queued'])

    # ---- 5. (site, fp) 去重：终态不重置 ---------------------------------

    def test_duplicate_capture_does_not_reset_terminal_job(self):
        _, _, site = self.capture()
        job = IconJob.objects.get(site=site)
        job.phase = 'no_icon'
        job.attempts = MAX_ATTEMPTS
        job.result = {'status': 'no_icon', 'code': 'icon_svg_only'}
        job.last_error_code = 'icon_svg_only'
        job.save()
        self.capture(url=PAGE)  # existing 分支，重复收藏
        job.refresh_from_db()
        self.assertEqual(IconJob.objects.filter(site=site).count(), 1)
        self.assertEqual(job.phase, 'no_icon')
        self.assertEqual(job.attempts, MAX_ATTEMPTS)
        self.assertEqual(job.result, {'status': 'no_icon', 'code': 'icon_svg_only'})

    # ---- 6. 成功：只填空创建、version+1 ---------------------------------

    def test_run_success_fills_icon_and_bumps_version(self):
        _, _, site = self.capture()
        start_version = site.version

        def fetcher(_site):
            return self.variant()

        outcome = run_icon_jobs(limit=4, fetcher=fetcher)
        self.assertEqual(outcome['processed'], 1)
        self.assertEqual(len(outcome['results']), 1)
        job = IconJob.objects.get(site=site)
        self.assertEqual(job.phase, 'complete')
        self.assertEqual(job.result['status'], 'complete')
        asset = SiteIconAsset.objects.get(site=site)
        self.assertEqual(job.result['assetId'], str(asset.pk))
        self.assertEqual(asset.owner_id, self.a.pk)
        self.assertEqual(asset.source_url, FAVICON)
        self.assertEqual(asset.source_fingerprint, source_url_fingerprint(FAVICON))
        self.assertTrue((Path(self.temporary.name) / asset.storage_key).is_file())
        site.refresh_from_db()
        self.assertEqual(site.version, start_version + 1)
        self.assertEqual(outcome['results'][0],
                         {'jobId': str(job.pk), 'phase': 'complete', 'code': 'complete'})

    # ---- 7. 明确拿不到图的 code 直接终态 --------------------------------

    def test_fatal_codes_are_terminal_without_retry(self):
        for index, code in enumerate(('icon_svg_only', 'icon_refresh_private',
                                      'icon_refresh_timeout', 'icon_refresh_too_large')):
            with self.subTest(code=code):
                _, _, site = self.capture(url=f'https://fatal{index}.example.com/app')

                def fetcher(_site, code=code):
                    raise favicons.FaviconError('拿不到图', code)

                run_icon_jobs(limit=4, fetcher=fetcher)
                job = IconJob.objects.get(site=site)
                self.assertEqual(job.phase, 'no_icon')
                self.assertEqual(job.last_error_code, code)
                self.assertEqual(job.result, {'status': 'no_icon', 'code': code})
                self.assertFalse(SiteIconAsset.objects.filter(site=site).exists())
                # 终态不再进入执行器
                self.assertEqual(run_icon_jobs(limit=4, fetcher=fetcher)['processed'], 0)

    # ---- 8. 可重试错误：有界退避，到 MAX_ATTEMPTS 转 no_icon ------------

    def test_retryable_error_uses_bounded_backoff(self):
        now = timezone.now()
        _, _, site = self.capture()
        job = IconJob.objects.get(site=site)
        job.next_attempt_at = now
        job.save(update_fields=['next_attempt_at'])

        def fetcher(_site):
            raise favicons.FaviconError('网络失败', 'icon_refresh_failed')

        run_icon_jobs(limit=4, now=now, fetcher=fetcher)
        job.refresh_from_db()
        self.assertEqual(job.phase, 'pending')
        self.assertEqual(job.attempts, 1)
        self.assert_dt(job.next_attempt_at, now + timedelta(seconds=60 * 2 ** 1))
        now2 = job.next_attempt_at
        run_icon_jobs(limit=4, now=now2, fetcher=fetcher)
        job.refresh_from_db()
        self.assertEqual(job.phase, 'pending')
        self.assertEqual(job.attempts, 2)
        self.assert_dt(job.next_attempt_at, now2 + timedelta(seconds=60 * 2 ** 2))
        now3 = job.next_attempt_at
        run_icon_jobs(limit=4, now=now3, fetcher=fetcher)
        job.refresh_from_db()
        self.assertEqual(job.attempts, MAX_ATTEMPTS)
        self.assertEqual(job.phase, 'no_icon')
        self.assertEqual(job.result, {'status': 'no_icon', 'code': 'icon_refresh_failed'})
        self.assertEqual(run_icon_jobs(limit=4, now=now3, fetcher=fetcher)['processed'], 0)

    # ---- 9. 抓取期间已有图标 -> kept_existing，不覆盖、不 bump、无孤立媒体

    def test_concurrent_icon_during_fetch_is_kept_existing(self):
        _, _, site = self.capture()
        content = b'concurrent-icon'
        key = f'{self.a.pk}/{uuid.uuid4().hex}-icon.webp'
        target = Path(self.temporary.name) / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        site_id, owner_id = site.pk, self.a.pk

        def fetcher(_site):
            SiteIconAsset.objects.create(owner_id=owner_id, site_id=site_id, storage_key=key,
                mime='image/webp', width=16, height=16, bytes=len(content),
                source_url='https://cdn.example.com/concurrent.png', revision=uuid.uuid4())
            return self.variant()

        run_icon_jobs(limit=4, fetcher=fetcher)
        job = IconJob.objects.get(site=site)
        self.assertEqual(job.phase, 'kept_existing')
        self.assertEqual(job.result, {'status': 'kept_existing'})
        asset = SiteIconAsset.objects.get(site=site)
        self.assertEqual(asset.storage_key, key)
        self.assertEqual(asset.source_url, 'https://cdn.example.com/concurrent.png')
        site.refresh_from_db()
        self.assertEqual(site.version, 1)  # 未 bump
        self.assertEqual(self.media_files(), [key])  # 预发布文件已回收

    # ---- 10. 基线变化 -> cancelled，不写图 ------------------------------

    def test_baseline_change_cancels_job(self):
        _, _, site = self.capture()
        job = IconJob.objects.get(site=site)
        site.payload['endpoints'][0]['url'] = 'https://changed.example.com/tool'
        site.save(update_fields=['payload'])

        def fetcher(_site):
            self.fail('基线变化后不应抓取')

        run_icon_jobs(limit=4, fetcher=fetcher)
        job.refresh_from_db()
        self.assertEqual(job.phase, 'cancelled')
        self.assertEqual(job.result['status'], 'cancelled')
        self.assertFalse(SiteIconAsset.objects.filter(site=site).exists())
        self.assertEqual(site.version, 1)

    # ---- 11. requeue 把终态重置为 pending，不改已有图标 -----------------

    def test_requeue_resets_terminal_without_touching_icon(self):
        _, _, site = self.capture()
        job = IconJob.objects.get(site=site)
        job.phase = 'no_icon'
        job.attempts = MAX_ATTEMPTS
        job.result = {'status': 'no_icon', 'code': 'icon_svg_only'}
        job.last_error_code = 'icon_svg_only'
        job.last_error = 'x'
        job.save()
        asset = self.add_icon(site)
        revision = str(asset.revision)

        requeued = requeue_icon_job(self.a, site)
        self.assertEqual(requeued.phase, 'pending')
        self.assertEqual(requeued.attempts, 0)
        self.assertIsNone(requeued.result)
        self.assertEqual(requeued.last_error_code, '')
        self.assertEqual(requeued.last_error, '')
        asset.refresh_from_db()
        self.assertEqual(str(asset.revision), revision)
        self.assertEqual(SiteIconAsset.objects.filter(site=site).count(), 1)
        self.assertTrue(icon_job_dto(site)['queued'])

    # ---- 12. refetch / upload_local 端点 --------------------------------

    def test_refetch_and_upload_local_endpoints(self):
        _, _, site = self.capture()
        # refetch：只排队
        refetch = self.send(f'/api/sites/{site.pk}/icon/refetch', {})
        self.assertEqual(refetch.status_code, 200, refetch.content)
        self.assertTrue(refetch.json()['queued'])
        self.assertTrue(refetch.json()['iconJob']['queued'])
        self.assertFalse(SiteIconAsset.objects.filter(site=site).exists())
        self.assertEqual(Site.objects.get(pk=site.pk).version, 1)
        # upload_local：真实小 PNG
        upload = self.client.post(f'/api/sites/{site.pk}/icon/upload',
            {'file': SimpleUploadedFile('icon.png', png_bytes(32, 32, 'blue'),
                                        content_type='image/png'),
             'version': str(site.version)})
        self.assertEqual(upload.status_code, 200, upload.content)
        body = upload.json()
        self.assertEqual(body['status'], 'complete')
        self.assertEqual(body['sourceUrl'], 'local-upload')
        self.assertEqual(body['sourceType'], 'local')
        self.assertEqual(body['siteVersion'], 2)
        asset = SiteIconAsset.objects.get(site=site)
        self.assertEqual(asset.source_url, 'local-upload')
        self.assertEqual(asset.source_fingerprint, source_url_fingerprint('local-upload'))
        self.assertTrue((Path(self.temporary.name) / asset.storage_key).is_file())
        # 随后 run_icon_jobs 遇到已有图 -> kept_existing
        def fetcher(_site):
            self.fail('已有图时不应抓取')

        run_icon_jobs(limit=4, fetcher=fetcher)
        self.assertEqual(IconJob.objects.get(site=site).phase, 'kept_existing')
        self.assertEqual(Site.objects.get(pk=site.pk).version, 2)

    # ---- 13. run_jobs 融入 ----------------------------------------------

    def test_run_jobs_integrates_icon_jobs(self):
        from enhancements.jobs import run_jobs
        _, _, site = self.capture()
        with patch('workspace.icon_jobs._default_fetcher', return_value=self.variant()) as fetcher:
            outcome = run_jobs(2)
        self.assertIn('iconJobs', outcome)
        self.assertEqual(outcome['processed'], 0)  # 既有语义不变（无提醒/监控）
        self.assertEqual(outcome['iconJobs']['processed'], 1)
        self.assertEqual(IconJob.objects.get(site=site).phase, 'complete')
        self.assertEqual(fetcher.call_count, 1)

    # ---- 14. 跨账号隔离 -------------------------------------------------

    def test_cross_account_owner_isolation(self):
        _, _, site_a = self.capture(url='https://a-iso.example.com/app', headers=self.headers)
        headers_b = self.connect(self.b)
        _, _, site_b = self.capture(url='https://b-iso.example.com/app', headers=headers_b)
        job_a = IconJob.objects.get(site=site_a)
        job_b = IconJob.objects.get(site=site_b)
        self.assertEqual(job_a.owner_id, self.a.pk)
        self.assertEqual(job_b.owner_id, self.b.pk)

        # B 的 requeue 不能改动/重置 A 的任务
        job_a.phase = 'no_icon'
        job_a.save(update_fields=['phase'])
        requeue_icon_job(self.b, site_a)
        job_a.refresh_from_db()
        self.assertEqual(job_a.phase, 'no_icon')
        self.assertEqual(job_a.owner_id, self.a.pk)

        # 执行器把写入绑定到各 job 的 owner
        job_a.phase = 'pending'
        job_a.save(update_fields=['phase'])

        def fetcher(_site):
            return self.variant()

        run_icon_jobs(limit=4, fetcher=fetcher)
        for site, owner in ((site_a, self.a.pk), (site_b, self.b.pk)):
            self.assertEqual(SiteIconAsset.objects.get(site=site).owner_id, owner)
        self.assertEqual(Site.objects.get(pk=site_a.pk).owner_id, self.a.pk)
