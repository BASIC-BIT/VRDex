import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from workers.restream import install_twitch


class PackagingContracts(unittest.TestCase):
    def test_exact_locked_wheel_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "example.whl"
            path.write_bytes(b"wheel")
            row = {"bytes": 5, "sha256": hashlib.sha256(b"wheel").hexdigest()}
            install_twitch.verify_wheel(path, row)
            path.write_bytes(b"other")
            with self.assertRaises(ValueError):
                install_twitch.verify_wheel(path, row)

    def test_target_lock_covers_native_wheels_and_exact_required_versions(self):
        lock = json.loads(Path("workers/restream/twitch-wheels.lock.json").read_text())
        versions = {r["name"].lower(): r["version"] for r in lock["wheels"]}
        self.assertEqual(versions["streamlink"], "8.6.2")
        self.assertEqual(versions["requests"], "2.34.2")
        self.assertEqual(versions["urllib3"], "2.8.0")
        for row in lock["wheels"]:
            self.assertEqual(len(row["sha256"]), 64)
            self.assertTrue(row["url"].startswith("https://files.pythonhosted.org/"))
            self.assertNotIn("cp312", row["filename"])
        self.assertEqual(len(versions), 21)

class OfflineCacheContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / 'source'
        self.source.mkdir()
        self.cache = self.source / '.twitch-wheelhouse'
        self.cache.mkdir()
        self.staged = Path(self.temp.name) / 'staged'
        self.staged.mkdir()
        self.rows = [{'filename': 'one.whl', 'url': 'https://files.pythonhosted.org/one.whl',
                      'bytes': 5, 'sha256': hashlib.sha256(b'wheel').hexdigest()}]
        (self.cache / 'one.whl').write_bytes(b'wheel')
        self.network_calls = []
        owner = self
        class OfflineOpener:
            def open(self, *args, **kwargs):
                owner.network_calls.append(args)
                raise AssertionError('Cache must not fall back to network')
        self.opener = OfflineOpener()

    def stage(self):
        return install_twitch.stage_wheels(self.source, self.staged, self.rows, self.opener)

    def test_verified_cache_is_copied_without_network(self):
        self.stage()
        self.assertEqual((self.staged / 'one.whl').read_bytes(), b'wheel')
        self.assertEqual(self.network_calls, [])

    def test_missing_required_entry_fails_without_network(self):
        (self.cache / 'one.whl').unlink()
        with self.assertRaises((ValueError, OSError)):
            self.stage()
        self.assertEqual(self.network_calls, [])

    def test_wrong_size_and_same_size_corruption_fail_without_network(self):
        for data in (b'too large', b'bad', b'other'):
            with self.subTest(data=data):
                (self.cache / 'one.whl').write_bytes(data)
                with self.assertRaises(ValueError):
                    self.stage()
                (self.staged / 'one.whl').unlink(missing_ok=True)
        self.assertEqual(self.network_calls, [])

    def test_symlink_file_is_rejected_even_with_exact_matching_bytes(self):
        wheel = self.cache / 'one.whl'
        wheel.rename(self.source / 'actual.whl')
        wheel.symlink_to(self.source / 'actual.whl')
        with self.assertRaises((ValueError, OSError)):
            self.stage()
        self.assertEqual(self.network_calls, [])

    def test_nonregular_file_and_symlink_cache_are_rejected(self):
        wheel = self.cache / 'one.whl'
        wheel.unlink()
        wheel.mkdir()
        with self.assertRaises(ValueError):
            self.stage()
        wheel.rmdir()
        self.cache.rmdir()
        self.cache.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.stage()
        self.assertEqual(self.network_calls, [])

    def test_absent_cache_retains_verified_https_path(self):
        import io
        (self.cache / 'one.whl').unlink()
        self.cache.rmdir()
        calls = []
        class Opener:
            def open(self, url, timeout):
                calls.append((url, timeout))
                return io.BytesIO(b'wheel')
        install_twitch.stage_wheels(self.source, self.staged, self.rows, Opener())
        self.assertEqual(calls, [(self.rows[0]['url'], 30)])
        self.assertEqual((self.staged / 'one.whl').read_bytes(), b'wheel')
