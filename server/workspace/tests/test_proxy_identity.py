from django.test import override_settings
from django.core.cache import cache
from workspace.tests.base import ApiTest


@override_settings(RATE_LIMIT_ENABLED=True, SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'))
class ProxyRateTests(ApiTest):
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)

    def attempt(self, remote, forwarded):
        return self.send('/api/auth/login', {'email': 'missing@example.test', 'password': 'bad'},
                         REMOTE_ADDR=remote, HTTP_X_REAL_IP=forwarded)

    def test_trusted_proxy_clients_have_separate_login_limits(self):
        self.client.logout()
        for _ in range(10):
            self.assertEqual(self.attempt('127.0.0.1', '198.51.100.10').status_code, 401)
        self.assertEqual(self.attempt('127.0.0.1', '198.51.100.10').status_code, 429)
        self.assertEqual(self.attempt('127.0.0.1', '198.51.100.11').status_code, 401)

    def test_direct_clients_cannot_spoof_their_limit_identity(self):
        self.client.logout()
        for index in range(10):
            self.assertEqual(self.attempt('198.51.100.10', f'203.0.113.{index + 1}').status_code, 401)
        self.assertEqual(self.attempt('198.51.100.10', '203.0.113.99').status_code, 429)
