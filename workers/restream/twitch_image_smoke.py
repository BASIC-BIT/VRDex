"""Run on the actual immutable image. Host results are not image acceptance."""

import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile


def main():
    root = Path(__file__).resolve().parents[2]
    assert sys.version_info[:2] == (3, 11), "Expected image CPython 3.11"
    assert platform.machine() in ("x86_64", "AMD64")
    sys.path.insert(0, str(root))
    import workers.restream  # Activates only this process's private wheels.

    lock = json.loads((root / "workers/restream/twitch-wheels.lock.json").read_text())
    for row in lock["wheels"]:
        if row["name"] != "pip":
            assert metadata.version(row["name"]) == row["version"], row["name"]
    manifest = json.loads((root / "workers/restream/packaged-files.json").read_text())
    for relative, digest in manifest.items():
        assert (
            hashlib.sha256((root / relative).read_bytes()).hexdigest() == digest
        ), relative
    for name in (
        "__init__.py",
        "twitch_input.py",
        "twitch_transport.py",
        "twitch-input.mjs",
        "twitch-requirements.lock",
        "twitch-wheels.lock.json",
    ):
        assert "workers/restream/" + name in manifest, name
    from workers.restream.twitch_input import remux_command
    from workers.restream.twitch_transport import PINNED

    subprocess.run(["aws", "--version"], check=True, capture_output=True, timeout=10)
    subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "await import('./workers/restream/twitch-input.mjs')",
        ],
        cwd=root,
        check=True,
    )
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "source.mp4"
        output = Path(directory) / "normalized.ts"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000",
                "-t",
                "2",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-c:a",
                "aac",
                "-ac",
                "2",
                "-movflags",
                "frag_keyframe+empty_moov",
                str(source),
            ],
            check=True,
            timeout=20,
        )
        with source.open("rb") as inp, output.open("wb") as out:
            subprocess.run(
                remux_command(), stdin=inp, stdout=out, check=True, timeout=15
            )
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,sample_rate,channels",
                "-of",
                "json",
                str(output),
            ],
            capture_output=True,
            check=True,
            timeout=10,
        )
        streams = json.loads(result.stdout)["streams"]
        assert any(s["codec_name"] == "h264" for s in streams)
        assert any(
            s["codec_name"] == "aac"
            and s["sample_rate"] == "48000"
            and s["channels"] == 2
            for s in streams
        )
    print(
        json.dumps(
            {
                "kind": "image_smoke_pass",
                "python": platform.python_version(),
                "dependencies": PINNED,
                "node": subprocess.check_output(
                    ["node", "--version"], text=True
                ).strip(),
                "ffmpeg": subprocess.check_output(
                    ["ffmpeg", "-version"], text=True
                ).splitlines()[0],
                "packagedFileCount": len(manifest),
            }
        )
    )


if __name__ == "__main__":
    main()
