"""Build-only, hash-checked wheel bootstrap; no pip remains in the runtime.

Uses inherited managed proxy settings and normal CA verification. The optional
BuildKit CA secret augments system trust. No session artifact is required.
"""

import hashlib
import json
from pathlib import Path
import platform
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urlsplit


def verify_wheel(path, row):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    if path.stat().st_size != row["bytes"] or digest.hexdigest() != row["sha256"]:
        raise ValueError("Wheel integrity check failed")


class SecureRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        if (
            urlsplit(url).scheme != "https"
            or urlsplit(url).hostname != "files.pythonhosted.org"
        ):
            raise ValueError("Unexpected wheel redirect")
        return super().redirect_request(request, fp, code, message, headers, url)


def main():
    if sys.version_info[:2] != (3, 11) or platform.machine() not in ("x86_64", "AMD64"):
        raise SystemExit("This lock targets CPython 3.11 Linux amd64")
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    worker = source / "workers/restream"
    lock = json.loads((worker / "twitch-wheels.lock.json").read_text())
    context = ssl.create_default_context()
    ca = Path("/run/secrets/proxy_ca")
    if ca.exists():
        context.load_verify_locations(str(ca))
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=context), SecureRedirect()
    )
    with tempfile.TemporaryDirectory(prefix="twitch-build-") as directory:
        directory = Path(directory)
        for row in lock["wheels"]:
            if (
                urlsplit(row["url"]).scheme != "https"
                or urlsplit(row["url"]).hostname != "files.pythonhosted.org"
            ):
                raise ValueError("Unexpected wheel origin")
            path = directory / row["filename"]
            if path.name != row["filename"]:
                raise ValueError("Unexpected wheel filename")
            with (
                opener.open(row["url"], timeout=30) as response,
                path.open("wb") as output,
            ):
                count = 0
                while chunk := response.read(65536):
                    count += len(chunk)
                    if count > row["bytes"]:
                        raise ValueError("Wheel too large")
                    output.write(chunk)
            verify_wheel(path, row)
        bootstrap = next(row for row in lock["wheels"] if row["name"] == "pip")
        wheel = str(directory / bootstrap["filename"])
        # Execute the verified pip wheel without installing the installer itself.
        command = [
            sys.executable,
            "-I",
            "-S",
            "-c",
            'import runpy,sys;sys.path[:0]=[sys.argv.pop(1),"/opt/twitch"];runpy.run_module("pip",run_name="__main__")',
            wheel,
        ]
        subprocess.run(
            command
            + [
                "install",
                "--disable-pip-version-check",
                "--no-cache-dir",
                "--no-compile",
                "--no-deps",
                "--no-index",
                "--require-hashes",
                "--find-links",
                str(directory),
                "--target",
                "/opt/twitch",
                "-r",
                str(worker / "twitch-requirements.lock"),
            ],
            check=True,
        )
        subprocess.run(
            command + ["check"],
            check=True,
        )
    paths = json.loads((worker / "packaging-manifest.json").read_text())
    if len(paths) != len(set(paths)) or any(
        name.startswith("/") or ".." in Path(name).parts
        or "broadcast-capacity.mjs" == Path(name).name and name.startswith("workers/")
        for name in paths
    ):
        raise ValueError("Invalid explicit package manifest")
    files = [source / name for name in paths]
    # An explicit reviewed runtime bundle is optional for ordinary transport
    # coverage. Its absence never becomes measurement approval. K and Root's
    # external approval ledger are deliberately outside this packaged tree.
    runtime = worker / "native-binding/runtime"
    native_manifest = runtime / "manifest.json"
    if native_manifest.exists():
        if native_manifest.is_symlink() or native_manifest.stat().st_size > 65536:
            raise ValueError("Invalid native runtime manifest")
        native = json.loads(native_manifest.read_bytes())
        entries = native.get("entries")
        if native.get("schema") != "native-runtime-deps-v1" or not isinstance(entries, list) or not 1 <= len(entries) <= 256:
            raise ValueError("Invalid native runtime entries")
        names = set()
        for entry in entries:
            name = entry.get("relativePath", "")
            if not name or name.startswith("/") or any(part in ("", ".", "..") for part in name.split("/")) or name in names:
                raise ValueError("Invalid native runtime path")
            names.add(name)
            path = runtime / name
            if any((runtime.joinpath(*Path(name).parts[:i])).is_symlink() for i in range(1, len(Path(name).parts) + 1)) or not path.is_file() or not 0 < path.stat().st_size <= 196608:
                raise ValueError("Invalid native runtime file")
            data = path.read_bytes()
            if not 0 < len(data) <= 196608 or len(data) != entry.get("bytes") or hashlib.sha256(data).hexdigest() != entry.get("sha256"):
                raise ValueError("Changed native runtime file")
            files.append(path)
        files.append(native_manifest)
    manifest = {}
    for path in sorted(set(files)):
        relative = path.relative_to(source)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        manifest[str(relative)] = hashlib.sha256(path.read_bytes()).hexdigest()
    (target / "workers/restream/packaged-files.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n"
    )
    subprocess.run(
        [sys.executable, str(target / "workers/restream/twitch_image_smoke.py")],
        cwd=target,
        check=True,
    )


if __name__ == "__main__":
    main()
