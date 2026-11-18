import json
from datetime import timedelta
from io import StringIO
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from workspace.models import Site


class TaskTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='task-a')
        self.other = get_user_model().objects.create_user(username='task-b')
        self.site = Site.objects.create(owner=self.user, payload={'name': '我的站点', 'purpose': '我的用途',
            'notes': '我的笔记', 'endpoints': [{'id': 'main', 'url': 'https://example.com/', 'scope': '公网'}]})
        self.client.force_login(self.user)
        self.result = {'title': '抓取标题', 'description': '抓取描述', 'text': 'a' * 200000,
            'url': 'https://example.com/', 'checkedAt': timezone.now().isoformat(),
            'source': 'server', 'httpStatus': 200, 'status': 'available'}

    def post(self, path, data):
        return self.client.post('/api/enhancements/' + path, json.dumps(data), content_type='application/json')

    def test_metadata_cache_preserves_personal_fields_and_archive_is_bounded(self):
        path = f'sites/{self.site.pk}/metadata'
        self.assertEqual(self.client.get('/api/enhancements/' + path).status_code, 200)
        with patch('enhancements.metadata.fetch', return_value=self.result) as fetch:
            for _ in range(5):
                response = self.post(path, {'endpointId': 'main', 'archive': True})
                self.assertEqual(response.status_code, 200)
            self.assertEqual(fetch.call_count, 1)
        self.site.refresh_from_db()
        self.assertEqual(self.site.payload['purpose'], '我的用途')
        self.assertEqual(self.site.payload['notes'], '我的笔记')
        archives = self.client.get(f'/api/enhancements/sites/{self.site.pk}/archives').json()['archives']
        self.assertLessEqual(len(archives), 3)
        self.assertLessEqual(len(archives[0]['text'].encode()), 128 * 1024)
        self.client.force_login(self.other)
        for tail in ('metadata', 'archives', 'monitor'):
            self.assertEqual(self.client.get(f'/api/enhancements/sites/{self.site.pk}/{tail}').status_code, 404)

    def test_internal_endpoint_is_unsupported_and_never_faked_offline(self):
        self.site.payload['endpoints'][0]['scope'] = '内网'
        self.site.save()
        path = f'sites/{self.site.pk}/metadata'
        self.assertEqual(self.client.get('/api/enhancements/' + path).status_code, 200)
        with patch('enhancements.metadata.fetch') as fetch:
            response = self.post(path, {'endpointId': 'main'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['metadata']['status'], 'unsupported')
            self.assertIsNone(response.json()['metadata']['httpStatus'])
            fetch.assert_not_called()

    def test_reminders_are_owned_and_jobs_bounded_and_idempotent(self):
        response = self.post('reminders', {'siteId': str(self.site.pk),
            'dueAt': (timezone.now() - timedelta(days=1)).isoformat(), 'advanceDays': 0, 'description': '续费'})
        self.assertEqual(response.status_code, 200)
        reminder_id = response.json()['id']
        self.client.force_login(self.other)
        self.assertEqual(self.client.get('/api/enhancements/reminders').json()['reminders'], [])
        self.assertEqual(self.client.delete('/api/enhancements/reminders/' + str(reminder_id)).status_code, 404)
        self.assertEqual(self.post('reminders', {'siteId': str(self.site.pk), 'dueAt': timezone.now().isoformat()}).status_code, 404)
        self.client.force_login(self.user)
        from enhancements.models import Reminder, Notification
        for _ in range(4):
            Reminder.objects.create(owner=self.user, site=self.site, due_at=timezone.now(),
                trigger_at=timezone.now() - timedelta(hours=1), description='到期')
        call_command('runjobs', limit=2, stdout=StringIO())
        self.assertEqual(Notification.objects.count(), 2)
        call_command('runjobs', limit=10, stdout=StringIO())
        self.assertEqual(Notification.objects.count(), 5)
        call_command('runjobs', limit=10, stdout=StringIO())
        self.assertEqual(Notification.objects.count(), 5)
        notifications = self.client.get('/api/enhancements/notifications').json()['notifications']
        note_id = notifications[0]['id']
        self.client.force_login(self.other)
        self.assertEqual(self.client.get('/api/enhancements/notifications').json()['notifications'], [])
        self.assertEqual(self.client.patch(f'/api/enhancements/notifications/{note_id}', '{"read":true}', content_type='application/json').status_code, 404)

    def test_monitor_defaults_off_and_only_opted_in_site_is_fetched(self):
        path = f'/api/enhancements/sites/{self.site.pk}/monitor'
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['enabled'])
        with patch('enhancements.metadata.fetch', return_value=self.result) as fetch:
            call_command('runjobs', limit=10, stdout=StringIO())
            fetch.assert_not_called()
            enabled = self.client.put(path, json.dumps({'enabled': True, 'endpointId': 'main', 'intervalHours': 24}), content_type='application/json')
            self.assertEqual(enabled.status_code, 200)
            call_command('runjobs', limit=1, stdout=StringIO())
            self.assertEqual(fetch.call_count, 1)
            call_command('runjobs', limit=1, stdout=StringIO())
            self.assertEqual(fetch.call_count, 1)

    def test_job_lease_blocks_overlapping_runs(self):
        from enhancements.models import JobLease
        from enhancements.jobs import run_jobs
        JobLease.objects.create(pk=1, expires_at=timezone.now() + timedelta(minutes=1))
        with patch('enhancements.metadata.fetch') as fetch:
            self.assertEqual(run_jobs(10), {'processed': 0, 'skipped': 'another_run_active'})
            fetch.assert_not_called()

    def test_monitor_job_request_count_is_bounded_and_serial(self):
        from enhancements.models import Monitor
        from enhancements.jobs import run_jobs
        for index in range(4):
            site = Site.objects.create(owner=self.user, payload=self.site.payload)
            Monitor.objects.create(owner=self.user, site=site, enabled=True, endpoint_id='main',
                                   next_check_at=timezone.now() - timedelta(minutes=1))
        active, peak = 0, 0

        def fetch_one(url):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            active -= 1
            return self.result

        with patch('enhancements.metadata.fetch', side_effect=fetch_one) as fetch:
            self.assertEqual(run_jobs(2)['processed'], 2)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(peak, 1)

    def test_write_endpoints_require_csrf_and_private_reads_require_login(self):
        from django.test import Client
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.get('/api/enhancements/reminders').status_code, 401)
        client.force_login(self.user)
        self.assertEqual(client.post('/api/enhancements/shares', '{}', content_type='application/json').status_code, 403)

    def test_extreme_reminder_date_is_validation_error(self):
        response = self.post('reminders', {'siteId': str(self.site.pk), 'dueAt': '0001-01-01T00:00:00Z',
            'advanceDays': 365, 'description': '不支持的日期'})
        self.assertEqual(response.status_code, 400)
