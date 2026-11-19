import json
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from workspace.models import Site, Collection


class ShareTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='a', email='secret@example.com')
        self.other = get_user_model().objects.create_user(username='b')
        self.site = Site.objects.create(owner=self.user, payload={
            'name': '站点', 'purpose': '公开用途', 'notes': '私人笔记', 'aliases': ['别名'],
            'tags': ['开发'], 'category': '', 'kind': 'external', 'icon': 'code',
            'accounts': [{'username': 'private-login', 'notes': '私密说明'}],
            'endpoints': [{'id': 'e', 'url': 'https://example.com/', 'label': '主站', 'scope': '公网'}],
            'collections': [], 'deleted': False, 'archived': False})
        self.client.force_login(self.user)

    def create(self, **extra):
        return self.client.post('/api/enhancements/shares',
            json.dumps({'siteId': str(self.site.pk), **extra}), content_type='application/json')

    def test_default_share_is_whitelisted_and_token_hash_only(self):
        response = self.create()
        self.assertEqual(response.status_code, 200)
        value = response.json()
        self.client.logout()
        shared = self.client.get('/api/enhancements/public/shares/' + value['token'])
        self.assertEqual(shared.status_code, 200)
        content = shared.content.decode()
        for private in ['私人笔记', 'private-login', 'secret@example.com', str(self.user.pk) + 'owner']:
            self.assertNotIn(private, content)
        self.assertNotIn('accounts', shared.json()['sites'][0])
        from enhancements.models import Share
        stored = Share.objects.get(pk=value['id'])
        self.assertNotEqual(stored.token_hash, value['token'])
        self.assertNotIn(value['token'], str(stored.snapshot))

    def test_accounts_require_explicit_confirmation(self):
        self.assertEqual(self.create(includeAccounts=True).status_code, 400)
        accepted = self.create(includeAccounts=True, confirmAccounts=True)
        self.assertEqual(accepted.status_code, 200)
        public = self.client.get('/api/enhancements/public/shares/' + accepted.json()['token'])
        self.assertEqual(public.json()['sites'][0]['accounts'][0]['username'], 'private-login')
        self.assertNotIn('notes', public.json()['sites'][0])

    def test_share_owner_expiry_revoke_and_source_delete(self):
        created = self.create()
        self.assertEqual(created.status_code, 200)
        value = created.json()
        self.client.force_login(self.other)
        self.assertEqual(self.create().status_code, 404)
        self.assertEqual(self.client.delete('/api/enhancements/shares/' + value['id']).status_code, 404)
        self.assertEqual(self.client.get('/api/enhancements/shares').json()['shares'], [])
        self.client.force_login(self.user)
        self.assertEqual(self.client.delete('/api/enhancements/shares/' + value['id']).status_code, 200)
        url = '/api/enhancements/public/shares/' + value['token']
        self.assertEqual(self.client.get(url).status_code, 404)
        fresh = self.create().json()
        from enhancements.models import Share
        Share.objects.filter(pk=fresh['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.client.get('/api/enhancements/public/shares/' + fresh['token']).status_code, 404)
        latest = self.create().json()
        self.site.payload['deleted'] = True
        self.site.save()
        self.assertEqual(self.client.get('/api/enhancements/public/shares/' + latest['token']).status_code, 404)

    def test_collection_share_filters_and_checks_owner(self):
        collection = Collection.objects.create(owner=self.user, name='合集')
        foreign = Collection.objects.create(owner=self.other, name='别人的')
        self.site.payload['collections'] = [str(collection.pk)]
        self.site.save()
        Site.objects.create(owner=self.other, payload=self.site.payload)
        Site.objects.create(owner=self.user, payload={**self.site.payload, 'archived': True})
        response = self.client.post('/api/enhancements/shares', json.dumps({'collectionId': str(collection.pk)}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        public = self.client.get('/api/enhancements/public/shares/' + response.json()['token']).json()
        self.assertEqual(len(public['sites']), 1)
        forbidden = self.client.post('/api/enhancements/shares', json.dumps({'collectionId': str(foreign.pk)}), content_type='application/json')
        self.assertEqual(forbidden.status_code, 404)

    def test_share_snapshot_has_storage_limit(self):
        collection = Collection.objects.create(owner=self.user, name='大工作集')
        for number in range(10):
            payload = {**self.site.payload, 'collections': [str(collection.pk)],
                       'accounts': [{'notes': 'a' * 150000}], 'name': str(number)}
            Site.objects.create(owner=self.user, payload=payload)
        response = self.client.post('/api/enhancements/shares', json.dumps({'collectionId': str(collection.pk),
            'includeAccounts': True, 'confirmAccounts': True}), content_type='application/json')
        self.assertEqual(response.status_code, 400)
