"""通过真实HTTP验证前后端约定；只操作Django隔离测试库，不创建实际管理员。"""
import http.cookiejar
import io
import json
import urllib.error
import urllib.request
import uuid
from datetime import timedelta
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import LiveServerTestCase, override_settings
from django.utils import timezone


class BrowserClient:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, path, method='GET', data=None, bearer=None, csrf=True):
        headers = {'Accept': 'application/json', 'Origin': self.base}
        token = next((cookie.value for cookie in self.cookies if cookie.name == 'csrftoken'), '')
        if csrf:
            headers['X-CSRFToken'] = token
        if bearer:
            headers['Authorization'] = 'Bearer ' + bearer
        content = None if data is None else json.dumps(data).encode()
        if content is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, data=content, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())

    def multipart(self, path, fields, content, bearer):
        boundary = '----workspace-test-boundary'
        parts = []
        for name, value in fields.items():
            parts.extend([f'--{boundary}\r\n'.encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()])
        parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="preview.png"\r\n'
                      'Content-Type: image/png\r\n\r\n'.encode(), content, f'\r\n--{boundary}--\r\n'.encode()])
        request = urllib.request.Request(self.base + path, data=b''.join(parts), method='POST',
            headers={'Authorization': 'Bearer ' + bearer, 'Content-Type': f'multipart/form-data; boundary={boundary}'})
        try:
            with self.opener.open(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read())


@override_settings(DEBUG=False, SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False,
                   RATE_LIMIT_ENABLED=False, PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class LiveContractTests(LiveServerTestCase):
    host = '127.0.0.1'

    def setUp(self):
        self.password = 'Integration-Only!13579'
        self.owner = User.objects.create_user(username='owner@http.test', email='owner@http.test', password=self.password)
        self.other = User.objects.create_user(username='other@http.test', email='other@http.test', password=self.password)
        self.client_http = self.signin(self.owner.email)

    def signin(self, email):
        client = BrowserClient(self.live_server_url)
        self.assertEqual(client.request('/api/auth/session')[0], 200)
        self.assertEqual(client.request('/api/auth/login', 'POST', {'email': email, 'password': self.password})[0], 200)
        return client

    def add_site(self, client=None):
        data = {'name': 'HTTP保存验证', 'purpose': '实际请求后的持久化资料', 'notes': '不应出现在默认分享',
                'category': '开发工具', 'accounts': [{'label': '日常账号', 'username': 'private@example.test'}],
                'endpoints': [{'id': 'cloud', 'label': '云端', 'url': 'https://http-flow.example.test/', 'scope': '公网'}]}
        code, site = (client or self.client_http).request('/api/sites', 'POST', data)
        self.assertEqual(code, 200)
        return site

    def test_save_reload_edit_and_cross_user_are_real_http(self):
        site = self.add_site()
        code, workspace = self.client_http.request('/api/workspace')
        self.assertEqual(code, 200)
        self.assertEqual(workspace['sites'][0]['id'], site['id'])
        code, updated = self.client_http.request('/api/sites/' + site['id'], 'PATCH', {**site, 'purpose': '修改后仍然保存'})
        self.assertEqual(code, 200)
        self.assertGreater(updated['version'], site['version'])
        self.assertEqual(self.client_http.request('/api/sites/' + site['id'], 'PATCH', site)[0], 409)
        other_client = self.signin(self.other.email)
        self.assertEqual(other_client.request('/api/sites/' + site['id'])[0], 404)
        self.assertEqual(other_client.request('/api/workspace')[1]['sites'], [])
        self.assertEqual(self.client_http.request('/api/sites', 'POST', {'name': '无CSRF'}, csrf=False)[0], 403)
        self.client_http.request('/api/auth/logout', 'POST', {})
        again = self.signin(self.owner.email)
        self.assertEqual(again.request('/api/workspace')[1]['sites'][0]['purpose'], '修改后仍然保存')

    def test_extension_pairing_and_idempotent_capture_use_live_transport(self):
        code, pair = self.client_http.request('/api/extension/pairing-code', 'POST', {})
        self.assertEqual(code, 200)
        extension = BrowserClient(self.live_server_url)
        code, paired = extension.request('/api/extension/pair', 'POST', {'code': pair['code'], 'name': 'HTTP集成设备'}, csrf=False)
        self.assertEqual(code, 200)
        token = paired['token']
        capture = {'clientCaptureId': str(uuid.uuid4()), 'url': 'https://capture.example.test/path?q=1#view', 'title': '真实HTTP收藏', 'purpose': '记住用途'}
        first = extension.request('/api/extension/captures', 'POST', capture, bearer=token, csrf=False)
        second = extension.request('/api/extension/captures', 'POST', capture, bearer=token, csrf=False)
        self.assertEqual(first[0], 200)
        self.assertEqual(first[1]['site']['id'], second[1]['site']['id'])
        self.assertEqual(len(self.client_http.request('/api/workspace')[1]['sites']), 1)
        self.assertEqual(self.client_http.request('/api/extension/devices/' + paired['device']['id'], 'DELETE')[0], 200)
        self.assertEqual(extension.request('/api/extension/captures', 'POST', capture, bearer=token, csrf=False)[0], 401)

    def test_v2_text_preview_retry_revoke_and_repair_are_real_http(self):
        import tempfile
        from pathlib import Path
        from PIL import Image
        _, pair = self.client_http.request('/api/extension/pairing-code', 'POST', {})
        extension = BrowserClient(self.live_server_url)
        _, paired = extension.request('/api/extension/pair', 'POST', {'code': pair['code'],
            'name': '协议2 HTTP设备', 'extensionVersion': '1.2.0', 'protocolVersion': 2}, csrf=False)
        capture = {'clientCaptureId': str(uuid.uuid4()), 'url': 'https://capture-v2.example.test/',
            'title': '协议2图片', 'description': '文字独立确认', 'purpose': '', 'category': '',
            'tags': [], 'collectionIds': [], 'homepageUrl': 'https://capture-v2.example.test/'}
        code, created = extension.request('/api/extension/v2/captures', 'POST', capture,
            bearer=paired['token'], csrf=False)
        self.assertEqual(code, 200)
        output = io.BytesIO()
        Image.new('RGB', (960, 540), 'green').save(output, 'PNG')
        def fields(version, asset):
            return {'clientAssetId': asset, 'expectedVersion': version, 'sourceEndpointId': '',
                'sourceUrl': capture['url'], 'homepageUrl': '', 'pageKind': 'current',
                'userConfirmedHomepage': 'false', 'capturedAt': timezone.now().isoformat()}
        with tempfile.TemporaryDirectory() as temporary, override_settings(MEDIA_ROOT=Path(temporary)):
            path = '/api/extension/v2/captures/' + capture['clientCaptureId'] + '/preview'
            bad = extension.multipart(path, fields(1, 'bad-image'), b'not-image', paired['token'])
            self.assertEqual(bad[0], 400)
            good_fields = fields(1, 'asset-one')
            good = extension.multipart(path, good_fields, output.getvalue(), paired['token'])
            self.assertEqual(good[0], 200, good)
            retry = extension.multipart(path, good_fields, output.getvalue(), paired['token'])
            self.assertEqual(retry, good)
            self.client_http.request('/api/extension/devices/' + paired['device']['id'], 'DELETE')
            blocked = extension.multipart(path, fields(good[1]['siteVersion'], 'asset-two'), output.getvalue(), paired['token'])
            self.assertEqual(blocked[0], 401)
            _, code_data = self.client_http.request('/api/extension/pairing-code', 'POST', {})
            _, repaired = extension.request('/api/extension/pair', 'POST', {'code': code_data['code'],
                'name': '同账号新设备', 'protocolVersion': 2}, csrf=False)
            resumed = extension.multipart(path, fields(good[1]['siteVersion'], 'asset-two'),
                output.getvalue(), repaired['token'])
            self.assertEqual(resumed[0], 200, resumed)
            workspace = self.client_http.request('/api/workspace')[1]
            self.assertTrue(workspace['sites'][0]['presentation']['preview']['present'])
            self.assertEqual(workspace['sites'][0]['version'], 3)

    def test_native_bookmark_full_batch_retry_and_followup_are_real_http(self):
        from workspace.models import Site
        _, pair = self.client_http.request('/api/extension/pairing-code', 'POST', {})
        extension = BrowserClient(self.live_server_url)
        code, paired = extension.request('/api/extension/pair', 'POST',
            {'code': pair['code'], 'name': '书签整批HTTP设备'}, csrf=False)
        self.assertEqual(code, 200)
        items = [{'title': f'工具 {i}', 'url': f'https://batch.example.test/{i}',
                  'folder': '收藏栏 / 合成工具'} for i in range(500)]
        payload = {'batchId': str(uuid.uuid4()), 'items': items}
        def submit(data):
            return extension.request('/api/extension/bookmarks/import', 'POST', data,
                bearer=paired['token'], csrf=False)
        first = submit(payload)
        self.assertEqual(first[0], 200)
        self.assertEqual(first[1]['imported'], 500)
        self.assertEqual(submit(payload), first)
        second = submit({'batchId': str(uuid.uuid4()), 'items': [items[0],
            {'title': '新增', 'url': 'https://batch.example.test/500'}]})
        self.assertEqual(second[0], 200)
        self.assertEqual((second[1]['imported'], second[1]['skipped']), (1, 1))
        self.assertEqual(Site.objects.filter(owner=self.owner).count(), 501)
        self.assertEqual(Site.objects.filter(owner=self.other).count(), 0)

    def test_share_redaction_monitor_boundaries_and_due_notifications(self):
        site = self.add_site()
        code, share = self.client_http.request('/api/enhancements/shares', 'POST', {'siteId': site['id']})
        self.assertEqual(code, 200)
        anonymous = BrowserClient(self.live_server_url)
        code, public = anonymous.request('/api/enhancements/public/shares/' + share['token'])
        self.assertEqual(code, 200)
        self.assertNotIn('accounts', public['sites'][0])
        self.assertNotIn('notes', public['sites'][0])
        self.assertEqual(self.signin(self.other.email).request('/api/enhancements/shares')[1]['shares'], [])
        due = timezone.now() - timedelta(days=1)
        code, _ = self.client_http.request('/api/enhancements/reminders', 'POST', {'siteId': site['id'], 'dueAt': due.isoformat(), 'advanceDays': 0, 'description': '到期验证'})
        self.assertEqual(code, 200)
        call_command('runjobs', limit=10, stdout=io.StringIO())
        call_command('runjobs', limit=10, stdout=io.StringIO())
        notices = self.client_http.request('/api/enhancements/notifications')[1]['notifications']
        self.assertEqual(len(notices), 1)
        self.client_http.request('/api/enhancements/shares/' + share['id'], 'DELETE')
        self.assertEqual(anonymous.request('/api/enhancements/public/shares/' + share['token'])[0], 404)
