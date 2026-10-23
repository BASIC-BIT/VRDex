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
