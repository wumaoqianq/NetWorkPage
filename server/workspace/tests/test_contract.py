import json
from django.test import TestCase, Client, override_settings


@override_settings(RATE_LIMIT_ENABLED=False, SETUP_TOKEN='test-setup-secret', SETUP_ENABLED=True)
class InitialContractTests(TestCase):
    def test_anonymous_sites_requires_authentication(self):
        self.assertEqual(self.client.get('/api/sites').status_code, 401)

    def test_session_bootstraps_csrf(self):
        response = self.client.get('/api/auth/session')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['setupRequired'])
        self.assertTrue(response.json()['csrfToken'])

    def test_setup_requires_csrf(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post('/api/auth/setup', json.dumps({'email': 'one@example.com'}), content_type='application/json')
        self.assertEqual(response.status_code, 403)
