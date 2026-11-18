import json
from django.test import TestCase, override_settings
from django.contrib.auth.models import User

PASSWORD = 'Bright!River$Cloud8276'


@override_settings(RATE_LIMIT_ENABLED=False, SETUP_TOKEN='test-setup-secret', SETUP_ENABLED=True,
                   PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class ApiTest(TestCase):
    def setUp(self):
        self.a = User.objects.create_user('a@example.com', 'a@example.com', PASSWORD, is_staff=True)
        self.b = User.objects.create_user('b@example.com', 'b@example.com', PASSWORD)
        self.client.force_login(self.a)

    def send(self, path, data=None, method='post', **kwargs):
        return getattr(self.client, method)(path, json.dumps(data or {}), content_type='application/json', **kwargs)

    def site(self, url='https://example.com/tool', **extra):
        return self.send('/api/sites', {'name': '图片工具', 'purpose': '压缩图片',
            'endpoints': [{'id': 'main', 'url': url, 'label': '默认入口', 'scope': '公网'}], **extra}).json()

    def pair(self):
        code = self.send('/api/extension/pairing-code').json()['code']
        return self.send('/api/extension/pair', {'code': code, 'name': 'Chrome'}).json()
