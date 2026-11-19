from django.test import Client, override_settings
from workspace.tests.base import ApiTest


class LibraryTests(ApiTest):
    def test_combined_site_payload_is_bounded(self):
        response = self.send('/api/sites', {'name': 'large', 'endpoints': [{'url': 'https://large.test'}],
            'accounts': [{'username': 'u' * 2000, 'notes': '记' * 2000} for _ in range(20)]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'site_payload_limit')

    def test_empty_private_defaults_and_isolation(self):
        first = self.client.get('/api/workspace').json()
        self.assertEqual(first['sites'], [])
        self.assertEqual(len(first['collections']), 2)
        self.assertEqual(len(first['categories']), 3)
        site = self.site()
        self.client.force_login(self.b)
        second = self.client.get('/api/workspace').json()
        self.assertNotEqual(first['collections'][0]['id'], second['collections'][0]['id'])
        self.assertEqual(second['sites'], [])
        for method in ('get', 'patch', 'delete'):
            response = self.client.get('/api/sites/' + site['id']) if method == 'get' else self.send(
                '/api/sites/' + site['id'], {'version': 1, 'name': '偷改'}, method)
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.get('/api/exports').json()['sites'], [])

    def test_nested_ownership_and_owner_spoofing(self):
        other = self.client.get('/api/workspace').json()['collections'][0]['id']
        self.client.force_login(self.b)
        self.assertEqual(self.send('/api/sites', {'name': 'x', 'endpoints': [{'url': 'https://a.com'}],
            'collections': [other], 'owner': self.a.pk}).status_code, 400)
        site = self.site(owner=self.a.pk)
        self.assertEqual(self.client.get('/api/sites/' + site['id']).status_code, 200)
        self.client.force_login(self.a)
        self.assertEqual(self.client.get('/api/sites/' + site['id']).status_code, 404)

    def test_version_conflict_and_trash_requirement(self):
        site = self.site()
        path = '/api/sites/' + site['id']
        self.assertEqual(self.send(path, {}, 'delete').status_code, 409)
        updated = self.send(path, {'version': 1, 'notes': '私有备注', 'deleted': True}, 'patch')
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(self.send(path, {'version': 1, 'name': '旧值'}, 'patch').status_code, 409)
        self.assertEqual(self.send(path, {'version': 2}, 'delete').status_code, 200)

    def test_reject_unsafe_urls_and_invalid_shapes(self):
        for url in ['javascript:alert(1)', 'data:text/html,a', 'https://a:b@example.com', 'https://example.com\nX:x', 'ftp://a.com']:
            self.assertEqual(self.send('/api/sites', {'name': 'x', 'endpoints': [{'url': url}]}).status_code, 400)
        for data in [{'name': 'x', 'endpoints': 'bad'}, {'name': 'x', 'accounts': [{'password': 'secret'}],
            'endpoints': [{'url': 'https://a.com'}]}]:
            self.assertEqual(self.send('/api/sites', data).status_code, 400)
        self.assertEqual(self.client.post('/api/sites', '{bad', content_type='application/json').status_code, 400)

    def test_default_endpoint_and_visit_ownership(self):
        site = self.site(endpoints=[{'id': 'a', 'url': 'http://localhost:3000'}, {'id': 'b', 'url': 'https://b.com'}],
                         defaultEndpointId='b')
        self.assertEqual(site['defaultEndpointId'], 'b')
        self.assertEqual(self.send('/api/visits', {'siteId': site['id'], 'endpointId': 'x'}).status_code, 400)
        self.assertEqual(self.send('/api/visits', {'siteId': site['id'], 'endpointId': 'b'}).status_code, 200)
        self.client.force_login(self.b)
        self.assertEqual(self.send('/api/visits', {'siteId': site['id'], 'endpointId': 'b'}).status_code, 404)

    def test_cookie_csrf_and_device_requires_bearer(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.a)
        self.assertEqual(client.post('/api/sites', '{}', content_type='application/json').status_code, 403)
        csrf = client.get('/api/auth/session').json()['csrfToken']
        response = client.post('/api/extension/pairing-code', '{}', content_type='application/json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get('/api/extension/lookup?url=https://a.com').status_code, 401)

    @override_settings(MAX_SITES=1)
    def test_site_limit_and_url_uniqueness(self):
        self.site()
        self.assertEqual(self.send('/api/sites', {'name': 'x', 'endpoints': [{'url': 'https://other.com'}]}).status_code, 409)


    def test_revision_and_optional_inbox_completion_preserve_fields(self):
        initial = self.client.get('/api/workspace').json()
        self.assertEqual(self.client.get('/api/workspace/revision').json()['revision'], initial['revision'])
        site = self.site(inbox=True, notes='保留备注', category='办公协作')
        changed = self.client.get('/api/workspace/revision').json()['revision']
        self.assertNotEqual(changed, initial['revision'])
        self.assertEqual(self.client.get('/api/workspace/revision').json()['revision'], changed)
        completed = self.send('/api/inbox/complete', {'count': 1})
        self.assertEqual(completed.status_code, 200, completed.content)
        self.assertEqual(completed.json()['completed'], 1)
        current = self.client.get('/api/sites/' + site['id']).json()
        self.assertFalse(current['inbox'])
        self.assertEqual(current['notes'], '保留备注')
        self.assertEqual(current['category'], '办公协作')
        self.assertEqual(self.send('/api/inbox/complete', {'count': 0}).json()['completed'], 0)
