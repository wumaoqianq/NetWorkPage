from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from workspace.models import Site


@override_settings(RATE_LIMIT_ENABLED=False, PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
class PaginationTests(TestCase):
    def test_workspace_and_site_reads_are_bounded_and_private(self):
        user = User.objects.create_user(username='pages@example.test', password='Temporary-Only!123')
        other = User.objects.create_user(username='other-pages@example.test', password='Temporary-Only!123')
        Site.objects.bulk_create([Site(owner=user, payload={'name': f'Site {index}'}) for index in range(501)])
        Site.objects.create(owner=other, payload={'name': 'Other user secret'})
        self.client.force_login(user)
        workspace = self.client.get('/api/workspace').json()
        self.assertEqual(workspace['siteCount'], 501)
        self.assertEqual(len(workspace['sites']), 250)
        self.assertEqual(workspace['nextSitePage'], 2)
        page = self.client.get('/api/sites?page=2&limit=250').json()
        self.assertEqual(len(page['sites']), 250)
        self.assertEqual(page['nextPage'], 3)
        self.assertEqual(page['userId'], user.pk)
        last = self.client.get('/api/sites?page=3&limit=250').json()
        self.assertEqual(len(last['sites']), 1)
        self.assertIsNone(last['nextPage'])
        self.assertNotIn('Other user secret', str(workspace) + str(page) + str(last))
