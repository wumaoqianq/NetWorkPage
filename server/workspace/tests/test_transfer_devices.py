from datetime import timedelta
from django.utils import timezone
from workspace.tests.base import ApiTest
from workspace.models import Device, PairingCode, Invite


class TransferDeviceTests(ApiTest):
    def test_capture_retries_and_repair_keep_owner_receipt(self):
        pairing = self.pair()
        headers = {'HTTP_AUTHORIZATION': 'Bearer ' + pairing['token']}
        data = {'clientCaptureId': 'capture-1', 'url': 'https://example.com', 'title': '测试', 'purpose': ''}
        first = self.send('/api/extension/captures', data, **headers).json()
        again = self.send('/api/extension/captures', data, **headers).json()
        self.assertEqual(first['site']['id'], again['site']['id'])
        repaired = self.pair()
        third = self.send('/api/extension/captures', data, HTTP_AUTHORIZATION='Bearer ' + repaired['token']).json()
        self.assertEqual(first['site']['id'], third['site']['id'])
        self.assertEqual(len(self.client.get('/api/workspace').json()['sites']), 1)
        self.assertNotEqual(Device.objects.first().token_hash, pairing['token'])

    def test_expired_pair_code_device_and_revoke(self):
        code = self.send('/api/extension/pairing-code').json()['code']
        PairingCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.send('/api/extension/pair', {'code': code, 'name': 'x'}).status_code, 400)
        pairing = self.pair()
        header = {'HTTP_AUTHORIZATION': 'Bearer ' + pairing['token']}
        self.assertEqual(self.client.get('/api/extension/lookup?url=https://a.com', **header).status_code, 200)
        self.send('/api/extension/devices/' + pairing['device']['id'], {}, 'delete')
        self.assertEqual(self.client.get('/api/extension/lookup?url=https://a.com', **header).status_code, 401)
        pairing = self.pair()
        Device.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.get('/api/extension/lookup?url=https://a.com', HTTP_AUTHORIZATION='Bearer '+pairing['token']).status_code, 401)

    def test_json_roundtrip_preserves_accounts_and_collections(self):
        collection = self.client.get('/api/workspace').json()['collections'][0]['id']
        self.site(accounts=[{'label': '私有', 'username': 'me@example.com', 'method': 'SSO', 'notes': '说明'}], collections=[collection])
        exported = self.client.get('/api/exports').json()
        self.client.force_login(self.b)
        preview = self.send('/api/imports/preview', {'format': 'json', 'content': exported}).json()
        self.assertEqual(preview['count'], 1)
        committed = self.send('/api/imports/' + preview['id'] + '/commit').json()
        self.assertEqual(committed['imported'], 1)
        self.assertEqual(self.send('/api/imports/' + preview['id'] + '/commit').json(), committed)
        result = self.client.get('/api/exports').json()
        self.assertEqual(result['sites'][0]['accounts'], exported['sites'][0]['accounts'])
        self.assertTrue(result['sites'][0]['collections'])
        self.assertNotEqual(result['sites'][0]['collections'], exported['sites'][0]['collections'])
        self.client.force_login(self.a)
        self.assertEqual(self.send('/api/imports/'+preview['id']+'/commit').status_code, 404)

    def test_html_duplicates_and_atomic_malicious_import(self):
        html = '<DL><DT><H3>工具</H3><DL><DT><A HREF="https://a.com">甲</A><DT><A HREF="https://a.com">重复</A></DL></DL>'
        preview = self.send('/api/imports/preview', {'format': 'html', 'content': html}).json()
        self.assertEqual(preview['count'], 1)
        self.assertEqual(preview['duplicates'], 1)
        self.assertEqual(self.send('/api/imports/'+preview['id']+'/commit').json()['imported'], 1)
        bad = {'sites': [{'name': 'bad', 'endpoints': [{'url': 'javascript:alert(1)'}]}]}
        self.assertEqual(self.send('/api/imports/preview', {'format': 'json', 'content': bad}).status_code, 400)
        self.assertEqual(len(self.client.get('/api/workspace').json()['sites']), 1)

    def test_html_nested_folder_paths_and_text_are_preserved(self):
        html = '<DL><DT><H3>开发</H3><DL><DT><H3>工具</H3><DL><DT><A HREF="https://a.com">甲 &amp; 乙</A></DL></DL></DL>'
        preview = self.send('/api/imports/preview', {'format': 'html', 'content': html}).json()
        self.assertEqual(preview['preview'][0]['name'], '甲 & 乙')
        self.assertIn('开发 / 工具', preview['preview'][0]['notes'])
