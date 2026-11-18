import json
from datetime import timedelta
from django.test import override_settings, TransactionTestCase, Client
from django.contrib.auth.models import User
from django.db import connections
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from django.utils import timezone
from workspace.models import Collection, Category, ImportJob, Site
from workspace.tests.base import ApiTest, PASSWORD


class HardeningTests(ApiTest):
    def test_direct_backend_responses_deny_framing(self):
        response = self.client.get('/api/auth/session')
        self.assertEqual(response.headers.get('X-Frame-Options'), 'DENY')

    def test_deleted_defaults_do_not_reappear(self):
        data = self.client.get('/api/workspace').json()
        for collection in data['collections']:
            self.send('/api/collections/' + collection['id'], {}, 'delete')
        for category in data['categories']:
            self.send('/api/categories/' + category, {}, 'delete')
        after = self.client.get('/api/workspace').json()
        self.assertEqual(after['collections'], [])
        self.assertEqual(after['categories'], [])

    def test_organization_mutation_updates_only_own_references(self):
        collection = self.client.get('/api/workspace').json()['collections'][0]
        site = self.site(collections=[collection['id']], category='开发工具')
        self.client.force_login(self.b)
        self.assertEqual(self.send('/api/collections/'+collection['id'], {'name': '偷改'}, 'patch').status_code, 404)
        self.client.force_login(self.a)
        self.assertEqual(self.send('/api/collections/'+collection['id'], {}, 'delete').status_code, 200)
        updated = self.client.get('/api/sites/'+site['id']).json()
        self.assertEqual(updated['collections'], [])
        self.assertEqual(updated['version'], 2)
        self.send('/api/categories/开发工具', {'name': '编程'}, 'patch')
        self.assertEqual(self.client.get('/api/sites/'+site['id']).json()['category'], '编程')

    def test_import_atomic_capacity_and_expiry(self):
        data = {'sites': [{'name': str(i), 'endpoints': [{'url': f'https://item{i}.com'}]} for i in range(2)]}
        preview = self.send('/api/imports/preview', {'format': 'json', 'content': data}).json()
        with override_settings(MAX_SITES=1):
            self.assertEqual(self.send('/api/imports/'+preview['id']+'/commit').status_code, 409)
        self.assertEqual(Site.objects.filter(owner=self.a).count(), 0)
        ImportJob.objects.update(expires_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(self.send('/api/imports/'+preview['id']+'/commit').status_code, 410)

    def test_capture_user_and_device_isolation(self):
        first = self.pair()
        data = {'clientCaptureId': 'same-id', 'url': 'https://a.com', 'title': '甲', 'purpose': ''}
        a_site = self.send('/api/extension/captures', data, HTTP_AUTHORIZATION='Bearer '+first['token']).json()['site']
        self.client.force_login(self.b)
        self.assertEqual(self.send('/api/extension/devices/'+first['device']['id'], {}, 'delete').status_code, 404)
        second = self.pair()
        header = {'HTTP_AUTHORIZATION': 'Bearer '+second['token']}
        self.assertIsNone(self.client.get('/api/extension/lookup?url=https://a.com', **header).json()['site'])
        b_site = self.send('/api/extension/captures', data, **header).json()['site']
        self.assertNotEqual(a_site['id'], b_site['id'])

    def test_invalid_default_endpoint_is_rejected(self):
        response = self.send('/api/sites', {'name': 'x', 'defaultEndpointId': 'missing',
            'endpoints': [{'id': 'main', 'url': 'https://a.com'}]})
        self.assertEqual(response.status_code, 400)

    @override_settings(RATE_LIMIT_ENABLED=True)
    def test_login_rate_limit(self):
        self.client.logout()
        for _ in range(10):
            response = self.send('/api/auth/login', {'email': 'missing@example.com', 'password': 'bad'})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.send('/api/auth/login', {'email': 'missing@example.com', 'password': 'bad'}).status_code, 429)

    def test_deeply_nested_json_returns_stable_error(self):
        malformed = '{"name":' + '['*5000 + '0' + ']'*5000 + '}'
        response = self.client.post('/api/sites', malformed, content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('code', response.json())


@override_settings(RATE_LIMIT_ENABLED=False, SETUP_TOKEN='test-setup-secret', SETUP_ENABLED=True,
                   PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class SetupRaceTests(TransactionTestCase):
    def test_first_setup_requests_cannot_create_two_admins(self):
        barrier = Barrier(2)

        def initialize(index):
            try:
                client = Client()
                barrier.wait(timeout=5)
                response = client.post('/api/auth/setup', json.dumps({'setupToken': 'test-setup-secret',
                    'email': f'admin{index}@example.com', 'password': PASSWORD}), content_type='application/json')
                return response.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(initialize, range(2)))
        self.assertEqual(User.objects.filter(is_staff=True).count(), 1)
        self.assertEqual(results.count(200), 1)
        self.assertTrue(all(status in (200, 409, 503) for status in results))
