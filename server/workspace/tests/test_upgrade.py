"""在线升级的信任边界与维护期行为回归：清单校验、签名、版本选择、安全解包、503 维护。"""
import io
import shutil
import sqlite3
import tarfile
import tempfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.test import TestCase, override_settings

from workspace import release_manifest as rm
from workspace import upgrade


def make_manifest(**overrides):
    data = {
        'formatVersion': 1,
        'project': 'website-workspace',
        'track': 'prerelease',
        'version': '1.10.0-rc.2',
        'tag': 'v1.10.0-rc.2',
        'commit': 'a' * 40,
        'builtAt': '2026-11-19T00:00:00+00:00',
        'releaseNotesUrl': 'https://example.com/releases/tag/v1.10.0-rc.2',
        'minUpgradeFrom': '1.0.0',
        'platform': {'os': 'linux', 'arch': ['x86_64'], 'python': '>=3.11'},
        'extension': {'version': '1.10.0', 'api': {'minExtension': '1.0.0'}},
        'assets': [
            {'name': 'website-workspace-v1.10.0-rc.2.tar.gz', 'kind': 'server',
             'bytes': 10, 'sha256': 'b' * 64},
            {'name': 'website-workspace-extension-1.10.0.zip', 'kind': 'extension',
             'bytes': 10, 'sha256': 'c' * 64},
        ],
    }
    data.update(overrides)
    return data


class ManifestValidationTests(TestCase):
    def test_accepts_well_formed_manifest(self):
        self.assertEqual(rm.validate_manifest(make_manifest())['version'], '1.10.0-rc.2')

    def test_rejects_bad_format_project_track_version(self):
        for overrides in ({'formatVersion': 2}, {'project': 'other'},
                          {'track': 'nightly'}, {'version': 'not-a-version'}):
            with self.assertRaises(rm.ManifestError):
                rm.validate_manifest(make_manifest(**overrides))

    def test_rejects_bad_commit_and_tag(self):
        for overrides in ({'commit': 'abc'}, {'tag': ''}):
            with self.assertRaises(rm.ManifestError):
                rm.validate_manifest(make_manifest(**overrides))

    def test_rejects_unsafe_duplicate_or_oversized_assets(self):
        bad_assets = [
            [{'name': '../escape.zip', 'kind': 'server', 'bytes': 1, 'sha256': 'd' * 64}],
            [{'name': 'ok.zip', 'kind': 'server', 'bytes': 1, 'sha256': 'd' * 64},
             {'name': 'ok.zip', 'kind': 'extension', 'bytes': 1, 'sha256': 'd' * 64}],
            [{'name': 'ok.zip', 'kind': 'server', 'bytes': 0, 'sha256': 'd' * 64}],
            [{'name': 'ok.zip', 'kind': 'server', 'bytes': 1, 'sha256': 'xyz'}],
            [{'name': 'ok.zip', 'kind': 'other', 'bytes': 1, 'sha256': 'd' * 64}],
        ]
        for assets in bad_assets:
            with self.assertRaises(rm.ManifestError):
                rm.validate_manifest(make_manifest(assets=assets))

    def test_rejects_missing_extension_block(self):
        with self.assertRaises(rm.ManifestError):
            rm.validate_manifest(make_manifest(extension={}))


class SignatureTests(TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.pem = self.key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo)
        self.payload = b'{"hello": "manifest"}'

    def test_valid_signature_passes(self):
        import base64
        signature = base64.b64encode(self.key.sign(self.payload)).decode()
        rm.verify_signature(self.payload, signature, self.pem)

    def test_tampered_manifest_rejected(self):
        import base64
        signature = base64.b64encode(self.key.sign(self.payload)).decode()
        with self.assertRaises(rm.ManifestError):
            rm.verify_signature(self.payload + b' ', signature, self.pem)

    def test_foreign_key_rejected(self):
        import base64
        other = Ed25519PrivateKey.generate()
        signature = base64.b64encode(other.sign(self.payload)).decode()
        with self.assertRaises(rm.ManifestError):
            rm.verify_signature(self.payload, signature, self.pem)

    def test_malformed_signature_and_key_rejected(self):
        for signature, pem in (('not-base64!!', self.pem), ('AAAA', b'not a key')):
            with self.assertRaises(rm.ManifestError):
                rm.verify_signature(self.payload, signature, pem)


class VersionSelectionTests(TestCase):
    def test_semver_ordering(self):
        self.assertEqual(rm.compare_versions('1.9.0', '1.10.0'), -1)
        self.assertEqual(rm.compare_versions('1.10.0-rc.1', '1.10.0-rc.2'), -1)
        self.assertEqual(rm.compare_versions('1.10.0-rc.2', '1.10.0'), -1)
        self.assertEqual(rm.compare_versions('1.10.0', '1.10.0'), 0)

    def test_stable_track_ignores_prerelease(self):
        releases = [
            {'version': '1.11.0-rc.1', 'tag': 'v1.11.0-rc.1', 'prerelease': True, 'draft': False},
            {'version': '1.10.1', 'tag': 'v1.10.1', 'prerelease': False, 'draft': False},
        ]
        picked = rm.pick_update('1.10.0', releases, 'stable')
        self.assertEqual(picked['version'], '1.10.1')

    def test_prerelease_track_can_pick_rc(self):
        releases = [{'version': '1.11.0-rc.1', 'tag': 'v1.11.0-rc.1',
                     'prerelease': True, 'draft': False}]
        self.assertEqual(rm.pick_update('1.10.0', releases, 'prerelease')['version'], '1.11.0-rc.1')

    def test_draft_and_same_or_older_versions_skipped(self):
        releases = [
            {'version': '1.12.0', 'tag': 'v1.12.0', 'prerelease': False, 'draft': True},
            {'version': '1.10.0', 'tag': 'v1.10.0', 'prerelease': False, 'draft': False},
            {'version': '1.9.9', 'tag': 'v1.9.9', 'prerelease': False, 'draft': False},
        ]
        self.assertIsNone(rm.pick_update('1.10.0', releases, 'stable'))


class AssetVerificationTests(TestCase):
    def test_size_and_hash_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'asset.bin'
            path.write_bytes(b'payload')
            good = {'name': 'asset.bin', 'bytes': 7,
                    'sha256': __import__('hashlib').sha256(b'payload').hexdigest()}
            rm.verify_asset(path, good)
            with self.assertRaises(rm.ManifestError):
                rm.verify_asset(path, dict(good, bytes=8))
            with self.assertRaises(rm.ManifestError):
                rm.verify_asset(path, dict(good, sha256='e' * 64))


class SafeExtractTests(TestCase):
    def _archive(self, directory, entries):
        path = Path(directory) / 'bundle.tar.gz'
        with tarfile.open(path, 'w:gz') as bundle:
            for name, payload in entries.items():
                info = tarfile.TarInfo(name)
                info.size = len(payload)
                bundle.addfile(info, io.BytesIO(payload))
        return path

    def test_extracts_regular_files(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = self._archive(directory, {'pkg/server/manage.py': b'x'})
            target = Path(directory) / 'out'
            upgrade.safe_extract(archive, target)
            self.assertTrue((target / 'pkg/server/manage.py').is_file())

    def test_rejects_path_traversal_and_absolute(self):
        for name in ('../evil.txt', '/etc/evil.txt'):
            with tempfile.TemporaryDirectory() as directory:
                archive = self._archive(directory, {name: b'x'})
                with self.assertRaises(rm.ManifestError):
                    upgrade.safe_extract(archive, Path(directory) / 'out')

    def test_rejects_symlink_member(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bundle.tar.gz'
            with tarfile.open(path, 'w:gz') as bundle:
                info = tarfile.TarInfo('link')
                info.type = tarfile.SYMTYPE
                info.linkname = '/etc/passwd'
                bundle.addfile(info)
            with self.assertRaises(rm.ManifestError):
                upgrade.safe_extract(path, Path(directory) / 'out')

    def test_rejects_expansion_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = self._archive(directory, {'big.bin': b'0' * 4096})
            with self.assertRaises(rm.ManifestError):
                upgrade.safe_extract(archive, Path(directory) / 'out', max_bytes=1024)


    def test_release_wrapper_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = self._archive(directory, {'website-workspace/server/manage.py': b'x'})
            target = Path(directory) / 'out'
            upgrade.safe_extract(archive, target, wrapped=True)
            self.assertEqual((target / 'server/manage.py').read_bytes(), b'x')


class UpgradeRecoveryTests(TestCase):
    def test_migration_failure_restores_committed_changes_before_reopening(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = root / 'releases' / '1.10.0-rc.10'
            previous.mkdir(parents=True)
            database = root / 'catalog.sqlite3'
            media = root / 'media'
            media.mkdir()
            (media / 'preview.webp').write_bytes(b'original')
            with closing(sqlite3.connect(database)) as connection, connection:
                connection.execute('CREATE TABLE test_bookmark (title TEXT)')
                connection.execute("INSERT INTO test_bookmark VALUES ('original')")
            snapshot = shutil.copyfile(database, root / 'snapshot.sqlite3')

            def restore(backup, folder, **kwargs):
                restored_media = folder / 'media'
                restored_media.mkdir(parents=True)
                (restored_media / 'preview.webp').write_bytes(b'original')
                restored_db = shutil.copyfile(snapshot, folder / 'restored.sqlite3')
                return {'database': restored_db, 'media': restored_media, 'workdir': folder, 'mediaFiles': 1}

            def migrate(release):
                self.assertTrue(upgrade.is_maintenance())
                with closing(sqlite3.connect(database)) as connection, connection:
                    connection.execute("UPDATE test_bookmark SET title = 'changed'")
                (media / 'preview.webp').write_bytes(b'changed')
                raise RuntimeError('after a committed migration')

            def health(version):
                self.assertEqual(version, previous.name)
                self.assertTrue(upgrade.is_maintenance())
                with closing(sqlite3.connect(database)) as connection:
                    self.assertEqual(connection.execute('SELECT title FROM test_bookmark').fetchone(), ('original',))
                self.assertEqual((media / 'preview.webp').read_bytes(), b'original')
                return True

            timer = 'website-workspace-jobs.timer'
            with (override_settings(DATA_DIR=root, MEDIA_ROOT=media),
                  patch.dict(upgrade.settings.DATABASES['default'], {'NAME': database}),
                  patch.object(upgrade, 'app_root', return_value=root),
                  patch.object(upgrade, 'current_release', return_value=previous),
                  patch.object(upgrade, '_enabled_timers', return_value=[timer]),
                  patch.object(upgrade, 'precheck'), patch.object(upgrade, 'install_release'),
                  patch.object(upgrade, '_migrate', side_effect=migrate),
                  patch.object(upgrade, 'create_backup', return_value=root / 'backup.wwb'),
                  patch.object(upgrade, 'verify_backup', return_value={'integrity': 'ok'}),
                  patch.object(upgrade, '_restore_into', side_effect=restore),
                  patch.object(upgrade, '_systemctl') as systemctl, patch.object(upgrade, '_run'),
                  patch.object(upgrade, '_switch'), patch.object(upgrade, '_health_ok', side_effect=health)):
                with self.assertRaisesRegex(RuntimeError, '升级失败已回退'):
                    upgrade._apply('1.10.0-rc.11', None)
                self.assertEqual(upgrade.read_state()['stage'], 'rolled_back')
                self.assertFalse(upgrade.is_maintenance())
                systemctl.assert_any_call('stop', timer)
                systemctl.assert_any_call('start', timer)


@override_settings(DATA_DIR=tempfile.mkdtemp(prefix='ww-maint-'))
class MaintenanceMiddlewareTests(TestCase):
    def setUp(self):
        self.middleware = upgrade.MaintenanceMiddleware(lambda request: 'served')

    def _request(self, method, path):
        from django.test import RequestFactory
        request = RequestFactory().generic(method, path)
        request.path_info = path
        return request

    def test_normal_mode_serves_requests(self):
        upgrade.clear_maintenance()
        self.assertEqual(self.middleware(self._request('POST', '/api/sites')), 'served')

    def test_maintenance_returns_retryable_503_for_writes(self):
        upgrade.set_maintenance('upgrading')
        try:
            response = self.middleware(self._request('POST', '/api/sites'))
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response['Retry-After'], '60')
            self.assertIn(b'maintenance', response.content)
        finally:
            upgrade.clear_maintenance()

    def test_maintenance_allows_reads_and_exempt_paths(self):
        upgrade.set_maintenance('upgrading')
        try:
            self.assertEqual(self.middleware(self._request('GET', '/api/sites')), 'served')
            self.assertEqual(self.middleware(self._request('POST', '/api/update/status')), 'served')
        finally:
            upgrade.clear_maintenance()
