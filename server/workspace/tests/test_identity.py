import json
from datetime import timedelta
from django.contrib.auth.models import User
from django.contrib.sessions.models import Session
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from workspace.models import RecoveryToken, Invite, Device, SetupState
from workspace.tests.base import ApiTest, PASSWORD


class IdentityTests(ApiTest):
    def test_invite_single_use_email_bound_and_expiry(self):
        invite = self.send('/api/auth/invites', {'email': 'new@example.com'}).json()
        self.assertEqual(self.client.get('/api/auth/invites/'+invite['token']).status_code, 200)
        self.assertNotEqual(Invite.objects.first().token_hash, invite['token'])
        data = {'token': invite['token'], 'email': 'wrong@example.com', 'password': PASSWORD}
        self.assertEqual(self.send('/api/auth/register', data).status_code, 400)
        data['email'] = 'new@example.com'
        self.assertEqual(self.send('/api/auth/register', data).status_code, 200)
        self.assertEqual(self.send('/api/auth/register', data).status_code, 400)
        self.assertEqual(self.send('/api/auth/invites').status_code, 403)
        self.client.force_login(self.a)
        invite = self.send('/api/auth/invites').json()
        Invite.objects.filter(used_at=None).update(expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(self.client.get('/api/auth/invites/'+invite['token']).status_code, 400)

    def test_password_validation_login_and_logout(self):
        invite = self.send('/api/auth/invites').json()
        for weak in ['short', '1234567890123', 'passwordpassword']:
            self.assertEqual(self.send('/api/auth/register', {'token': invite['token'], 'email': 'new@example.com', 'password': weak}).status_code, 400)
        self.send('/api/auth/logout')
        self.assertIsNone(self.client.get('/api/auth/session').json()['user'])
        self.assertEqual(self.send('/api/auth/login', {'email': self.a.email, 'password': 'wrong'}).status_code, 401)
        self.assertEqual(self.send('/api/auth/login', {'email': self.a.email.upper(), 'password': PASSWORD}).status_code, 200)

    def test_self_lockout_admin_permission_and_disable_revokes(self):
        self.assertEqual(self.send(f'/api/auth/users/{self.a.pk}', {'isActive': False}, 'patch').status_code, 409)
        self.assertEqual(self.send(f'/api/auth/users/{self.a.pk}', {'isAdmin': False}, 'patch').status_code, 409)
        second = Client()
        second.force_login(self.b)
        self.client.force_login(self.b)
        pairing = self.pair()
        self.assertEqual(self.client.get('/api/auth/users').status_code, 403)
        self.client.force_login(self.a)
        self.assertEqual(self.send(f'/api/auth/users/{self.b.pk}', {'isActive': False}, 'patch').status_code, 200)
        self.assertEqual(second.get('/api/workspace').status_code, 401)
        self.send(f'/api/auth/users/{self.b.pk}', {'isActive': True}, 'patch')
        self.assertEqual(second.get('/api/workspace').status_code, 401)
        self.assertEqual(self.client.get('/api/extension/lookup?url=https://a.com', HTTP_AUTHORIZATION='Bearer '+pairing['token']).status_code, 401)

    def test_password_change_revokes_all_sessions_and_devices(self):
        second = Client()
        second.force_login(self.a)
        pairing = self.pair()
        result = self.send('/api/auth/password', {'currentPassword': PASSWORD, 'password': 'Different!Strong$49282'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.client.get('/api/workspace').status_code, 401)
        self.assertEqual(second.get('/api/workspace').status_code, 401)
        self.assertEqual(self.client.get('/api/extension/lookup?url=https://a.com', HTTP_AUTHORIZATION='Bearer '+pairing['token']).status_code, 401)

    def test_password_change_revokes_pending_pair_codes(self):
        code = self.send('/api/extension/pairing-code').json()['code']
        self.send('/api/auth/password', {'currentPassword': PASSWORD, 'password': 'Different!Strong$49282'})
        self.assertEqual(self.send('/api/extension/pair', {'code': code, 'name': '旧配对码'}).status_code, 400)

    def test_password_preserves_intentional_whitespace(self):
        replacement = ' Space!Bright$7777 '
        self.assertEqual(self.send('/api/auth/password', {'currentPassword': PASSWORD, 'password': replacement}).status_code, 200)
        self.assertEqual(self.send('/api/auth/login', {'email': self.a.email, 'password': replacement.strip()}).status_code, 401)
        self.assertEqual(self.send('/api/auth/login', {'email': self.a.email, 'password': replacement}).status_code, 200)

    def test_recovery_one_time_expiration_and_admin_gate(self):
        token = self.send(f'/api/auth/users/{self.b.pk}/recovery').json()['token']
        self.assertNotEqual(RecoveryToken.objects.first().token_hash, token)
        self.assertEqual(self.send('/api/auth/recover', {'token': token, 'password': 'Different!Strong$49282'}).status_code, 200)
        self.assertEqual(self.send('/api/auth/recover', {'token': token, 'password': PASSWORD}).status_code, 400)
        self.client.force_login(self.a)
        token = self.send(f'/api/auth/users/{self.b.pk}/recovery').json()['token']
        RecoveryToken.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(self.send('/api/auth/recover', {'token': token, 'password': PASSWORD}).status_code, 400)


@override_settings(RATE_LIMIT_ENABLED=False, SETUP_TOKEN='test-setup-secret', SETUP_ENABLED=True,
                   PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SetupTests(TestCase):
    def setup_request(self, **extra):
        return self.client.post('/api/auth/setup', json.dumps({'setupToken': 'test-setup-secret',
            'email': 'admin@example.com', 'password': PASSWORD, **extra}), content_type='application/json')

    def test_setup_requires_token_and_only_once(self):
        self.assertEqual(self.setup_request(setupToken='wrong').status_code, 403)
        self.assertEqual(self.setup_request().status_code, 200)
        self.assertEqual(User.objects.count(), 1)
        self.assertTrue(User.objects.first().is_staff)
        self.assertFalse(self.client.get('/api/auth/session').json()['setupRequired'])
        self.assertEqual(self.setup_request(email='second@example.com').status_code, 409)
        User.objects.all().delete()
        self.assertEqual(self.setup_request().status_code, 409)

    @override_settings(SETUP_ENABLED=False)
    def test_setup_closed_by_configuration(self):
        self.assertFalse(self.client.get('/api/auth/session').json()['setupRequired'])
        self.assertEqual(self.setup_request().status_code, 409)

    def test_real_csrf_login_rotates_token(self):
        client = Client(enforce_csrf_checks=True)
        csrf = client.get('/api/auth/session').json()['csrfToken']
        data = {'setupToken': 'test-setup-secret', 'email': 'admin@example.com', 'password': PASSWORD}
        response = client.post('/api/auth/setup', json.dumps(data), content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.post('/api/auth/logout', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=csrf).status_code, 403)
        csrf = client.get('/api/auth/session').json()['csrfToken']
        self.assertEqual(client.post('/api/auth/logout', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=csrf).status_code, 200)

    @override_settings(DEBUG=True, ALLOW_LOCAL_SETUP=True)
    def test_explicit_local_development_setup_without_token(self):
        self.assertFalse(self.client.get('/api/auth/session').json()['setupTokenRequired'])
        self.assertEqual(self.setup_request(setupToken='').status_code, 200)

    @override_settings(DEBUG=False, ALLOW_LOCAL_SETUP=True)
    def test_local_setup_never_bypasses_production_token(self):
        self.assertTrue(self.client.get('/api/auth/session').json()['setupTokenRequired'])
        self.assertEqual(self.setup_request(setupToken='').status_code, 403)

    @override_settings(DEBUG=True, ALLOW_LOCAL_SETUP=True)
    def test_local_setup_never_trusts_remote_or_forwarded_ip(self):
        data = {'email': 'admin@example.com', 'password': PASSWORD}
        response = self.client.post('/api/auth/setup', json.dumps(data), content_type='application/json',
            REMOTE_ADDR='192.168.1.2', HTTP_X_FORWARDED_FOR='127.0.0.1')
        self.assertEqual(response.status_code, 403)
