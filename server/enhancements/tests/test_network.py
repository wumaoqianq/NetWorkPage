import importlib
from unittest.mock import patch
from django.test import SimpleTestCase


class NetworkTests(SimpleTestCase):
    def module(self):
        import enhancements
        self.assertIsNotNone(importlib.util.find_spec('enhancements.safe_fetch'), '缺少受限抓取模块')
        return importlib.import_module('enhancements.safe_fetch')

    def test_private_and_ambiguous_addresses_are_never_connected(self):
        fetcher = self.module()
        bad = ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/',
               'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'https://user:pass@example.com/',
               'https://example.com:8443/', 'http://10.0.0.1/', 'http://2130706433/']
        with patch.object(fetcher, 'resolve', return_value=['127.0.0.1']), patch.object(fetcher, 'transport') as transport:
            for url in bad:
                with self.subTest(url=url), self.assertRaises(fetcher.FetchError):
                    fetcher.fetch(url)
            transport.assert_not_called()

    def test_all_dns_answers_and_redirects_are_revalidated(self):
        fetcher = self.module()
        with patch.object(fetcher, 'resolve', return_value=['93.184.216.34', '10.1.1.1']), patch.object(fetcher, 'transport') as transport:
            with self.assertRaises(fetcher.FetchError):
                fetcher.fetch('https://example.com')
            transport.assert_not_called()
        with patch.object(fetcher, 'resolve', side_effect=[['93.184.216.34'], ['127.0.0.1']]), patch.object(fetcher, 'transport', return_value=(302, {'location': 'http://localhost/'}, b'')) as transport:
            with self.assertRaises(fetcher.FetchError):
                fetcher.fetch('https://example.com')
            self.assertEqual(transport.call_count, 1)

    def test_transport_uses_validated_ip_and_parser_ignores_executable_text(self):
        fetcher = self.module()
        html = b'<title> Example </title><meta name="description" content="desc"><script>secret()</script><p>Hello</p>'
        with patch.object(fetcher, 'resolve', return_value=['93.184.216.34']), patch.object(fetcher, 'transport', return_value=(200, {'content-type': 'text/html'}, html)) as transport:
            result = fetcher.fetch('https://example.com/')
            self.assertEqual(transport.call_args.args[1], '93.184.216.34')
            self.assertEqual(result['title'], 'Example')
            self.assertNotIn('secret()', result['text'])
            self.assertEqual(result['source'], 'server')
            self.assertEqual(result['httpStatus'], 200)

    def test_response_size_and_redirect_count_are_bounded(self):
        fetcher = self.module()
        with patch.object(fetcher, 'resolve', return_value=['93.184.216.34']), patch.object(fetcher, 'transport', return_value=(200, {'content-type': 'text/html'}, b'x' * (512 * 1024 + 1))):
            with self.assertRaises(fetcher.FetchError):
                fetcher.fetch('https://example.com')
        with patch.object(fetcher, 'resolve', return_value=['93.184.216.34']), patch.object(fetcher, 'transport', return_value=(302, {'location': '/again'}, b'')) as transport:
            with self.assertRaises(fetcher.FetchError):
                fetcher.fetch('https://example.com')
            self.assertEqual(transport.call_count, 4)

    def test_ipv6_transition_and_site_local_addresses_are_blocked(self):
        fetcher = self.module()
        for address in ('64:ff9b::7f00:1', '64:ff9b:1::a00:1', '2002:7f00:1::', 'fec0::1', '2001::1'):
            with self.subTest(address=address), patch.object(fetcher, 'resolve', return_value=[address]), patch.object(fetcher, 'transport', return_value=(200, {}, b'')) as transport:
                with self.assertRaises(fetcher.FetchError):
                    fetcher.fetch('https://example.com')
                transport.assert_not_called()

    def test_closed_connection_response_still_reads_with_deadline(self):
        from unittest.mock import MagicMock
        import time
        from urllib.parse import urlsplit
        from enhancements import network
        connection = MagicMock()
        live_socket = connection.sock
        response = MagicMock(status=200)
        response.getheaders.return_value = [('Content-Type', 'text/html')]
        response.read1.side_effect = [b'<title>test</title>', b'']

        def receive():
            connection.sock = None  # HTTPConnection 会在 Connection: close 时移交套接字。
            return response

        connection.getresponse.side_effect = receive
        with patch.object(network, 'PinnedHTTP', return_value=connection):
            result = network.transport(urlsplit('https://example.com'), '93.184.216.34', time.monotonic() + 5)
        self.assertEqual(result[2], b'<title>test</title>')
        self.assertGreaterEqual(live_socket.settimeout.call_count, 2)
        connection.close.assert_called_once()

    def test_socket_connection_pins_ip_and_tls_keeps_hostname(self):
        import time
        from enhancements import network
        with patch.object(network, 'DeadlineSocket') as constructor, patch.object(network.ssl, 'create_default_context') as context:
            sock = constructor.return_value
            connection = network.PinnedHTTP('example.com', '93.184.216.34', 443, time.monotonic() + 5, True)
            connection.connect()
            sock.connect.assert_called_once_with(('93.184.216.34', 443))
            context.return_value.wrap_socket.assert_called_once_with(sock, server_hostname='example.com')

    def test_headers_also_count_toward_response_budget(self):
        from io import BytesIO
        from unittest.mock import MagicMock
        from enhancements import network
        self.assertTrue(hasattr(network, 'BoundedResponse'), '响应头也必须有总字节限制')
        sock = MagicMock()
        sock.makefile.return_value = BytesIO(b'HTTP/1.1 200 OK\r\n' + (b'X-Fill: ' + b'a' * 60000 + b'\r\n') * 9 + b'\r\n')
        response = network.BoundedResponse(sock)
        with self.assertRaises(network.FetchError):
            response.begin()

    def test_malformed_redirect_returns_fetch_error(self):
        fetcher = self.module()
        with patch.object(fetcher, 'resolve', return_value=['93.184.216.34']), patch.object(fetcher, 'transport', return_value=(302, {'location': 'http://[invalid/'}, b'')):
            with self.assertRaises(fetcher.FetchError):
                fetcher.fetch('https://example.com')
