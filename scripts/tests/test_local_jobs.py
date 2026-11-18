"""本机轻量调度器：日志/PID/stop 文件与有界 runjobs 调用。不启动真实 Django 进程。"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import local_jobs


class LocalJobsTests(unittest.TestCase):
    def test_run_cycle_writes_log_and_returns_output(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'jobs.log'
            completed = mock.Mock(returncode=0, stdout='{"processed": 1, "iconJobs": {"processed": 1}}')
            with mock.patch.object(local_jobs.subprocess, 'run', return_value=completed) as run:
                rc, out = local_jobs.run_cycle('python', 4, 90, log)
            self.assertEqual(rc, 0)
            self.assertIn('"processed": 1', out)
            text = log.read_text(encoding='utf-8')
            self.assertIn('cycle start limit=4', text)
            self.assertIn('cycle end rc=0', text)
            args, kwargs = run.call_args
            self.assertIn('runjobs', args[0])
            self.assertIn('--limit', args[0])
            self.assertLessEqual(int(args[0][args[0].index('--limit') + 1]), 100)

    def test_run_cycle_timeout_is_recorded_not_crash(self):
        with tempfile.TemporaryDirectory() as folder:
            log = Path(folder) / 'jobs.log'
            with mock.patch.object(local_jobs.subprocess, 'run',
                                   side_effect=local_jobs.subprocess.TimeoutExpired(['runjobs'], 90, output=b'partial')):
                rc, out = local_jobs.run_cycle('python', 4, 90, log)
            self.assertEqual(rc, 124)
            self.assertIn('[TIMEOUT]', out)
            self.assertIn('cycle end rc=124', log.read_text(encoding='utf-8'))

    def test_env_paths_point_into_local_manual_test_data(self):
        paths = local_jobs.env_paths()
        self.assertEqual(paths['log'].name, 'jobs.log')
        self.assertEqual(paths['pid'].name, 'jobs.pid')
        self.assertEqual(paths['stop'].name, 'jobs.stop')
        self.assertTrue(str(paths['data']).endswith('manual-test'))
        self.assertTrue(local_jobs.LAUNCHER.name == 'manual-test-server.py')


if __name__ == '__main__':
    unittest.main()
