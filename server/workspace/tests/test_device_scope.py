from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from workspace.models import Device
from workspace.http import digest
from workspace.library import defaults, save_site
from django.db import transaction


@override_settings(RATE_LIMIT_ENABLED=False, PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class DeviceScopeTests(TestCase):
    def test_lookup_does_not_reveal_private_accounts_or_notes_to_capture_extension(self):
        user = User.objects.create_user(username='scope@example.test', password='Test-Password!1234')
        defaults(user)
        with transaction.atomic():
            save_site(user, {'name': '私有资料', 'purpose': '常用用途', 'notes': '个人备注',
                'accounts': [{'label': '管理', 'username': 'private@example.test'}],
                'endpoints': [{'url': 'https://scoped.example.test/', 'scope': '公网'}]})
        token = 'disposable-test-device-token'
        Device.objects.create(owner=user, name='test', token_hash=digest(token), auth_hash=user.get_session_auth_hash(), expires_at=timezone.now()+timedelta(days=1))
        response = self.client.get('/api/extension/lookup', {'url': 'https://scoped.example.test/'}, HTTP_AUTHORIZATION='Bearer '+token)
        self.assertEqual(response.status_code, 200)
        value = response.json()['site']
        self.assertEqual(value['purpose'], '常用用途')
        self.assertNotIn('accounts', value)
        self.assertNotIn('notes', value)
        self.assertNotIn('collections', value)
