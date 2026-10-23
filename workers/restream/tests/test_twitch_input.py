import io
import unittest
from unittest.mock import patch
from types import SimpleNamespace as NS
from workers.restream import twitch_input as adapter


def stream(height, fps=60, codecs=("avc1.64002a", "mp4a.40.2")):
    info = NS(
        resolution=NS(width=1920 if height == 1080 else 1280, height=height),
        framerate=fps,
        codecs=codecs,
    )
    return NS(
        url="https://video.ttvnw.net/" + str(height) + "/" + str(fps),
        multivariant=NS(
            playlists=[
                NS(
                    uri="https://video.ttvnw.net/" + str(height) + "/" + str(fps),
                    stream_info=info,
                )
            ]
        ),
    )


class InputContracts(unittest.TestCase):
    def test_1080_only_all_presets(self):
        source = stream(1080)
        for preset in adapter.PRESETS:
            self.assertIs(
                adapter.select_rendition({"source": source, "best": source}, preset),
                source,
            )

    def test_resolution_then_requested_fps(self):
        a, b, c = stream(720, 30), stream(720, 60), stream(1080, 60)
        self.assertIs(adapter.select_rendition({"a": a, "b": b, "c": c}, "720p30"), a)
        self.assertIs(adapter.select_rendition({"a": a, "b": b, "c": c}, "480p60"), b)
        self.assertIs(adapter.select_rendition({"a": a, "b": b, "c": c}, "1080p30"), c)

    def test_reject_unsupported_audio_and_video(self):
        for item in [
            stream(1080, 120),
            stream(2160),
            stream(720, 60, ("hvc1", "mp4a.40.2")),
            stream(720, 60, ("avc1", "opus")),
        ]:
            with self.assertRaises(adapter.InputError):
                adapter.select_rendition({"a": item}, "1080p60")

    def test_reservoir_backpressure_accounting(self):
        reservoir = adapter.Reservoir(64)
        self.assertTrue(reservoir.put(b"a" * 64, timeout=0.01))
        self.assertFalse(reservoir.put(b"b", timeout=0.01))
        self.assertEqual(reservoir.take(), b"a" * 64)
        self.assertEqual(reservoir.high_water, 64)
        self.assertLessEqual(adapter.APPLICATION_BUFFER_BOUND, 4 * 1024 * 1024)

    def test_ffmpeg_pipe_only_copy_remux(self):
        args = adapter.remux_command()
        self.assertEqual(args[args.index("-i") + 1], "pipe:0")
        self.assertEqual(args[args.index("-protocol_whitelist") + 1], "pipe")
        self.assertIn("copy", args)
        self.assertEqual(args[-1], "pipe:1")


import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from test_twitch_transport import TLSFixture
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad


class SyntheticHLSContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        for kind in ("mpegts", "fmp4"):
            directory = cls.root / kind
            directory.mkdir()
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
                    "4",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-g",
                    "30",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-ac",
                    "2",
                    "-hls_time",
                    "1",
                    "-hls_list_size",
                    "0",
                    "-hls_segment_type",
                    kind,
                    "-f",
                    "hls",
                    str(directory / "index.m3u8"),
                ],
                check=True,
            )

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.fixture = TLSFixture()
        for kind in ("mpegts", "fmp4"):
            for path in (self.root / kind).iterdir():
                self.fixture.routes["/" + kind + "/" + path.name] = (
                    200,
                    {},
                    path.read_bytes(),
                )

    def tearDown(self):
        self.fixture.close()

    def read_hls(self, path):
        session = self.fixture.session()
        reservoir = adapter.Reservoir()
        events = []
        reader = adapter.HLSReader(
            session.http,
            "https://video.ttvnw.net" + path,
            reservoir,
            lambda kind, **kw: events.append(kind),
        )
        thread = threading.Thread(target=reader.run)
        thread.start()
        chunks = []
        while data := reservoir.take():
            chunks.append(data)
        thread.join(10)
        self.assertFalse(thread.is_alive())
        session.http.close()
        return reader, b"".join(chunks), events

    def test_ts_fmp4_normalize_real_audio_video(self):
        for kind in ("mpegts", "fmp4"):
            with self.subTest(kind=kind):
                reader, data, _ = self.read_hls("/" + kind + "/index.m3u8")
                self.assertIsNone(reader.failure)
                result = subprocess.run(
                    adapter.remux_command(),
                    input=data,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=12,
                )
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                with tempfile.NamedTemporaryFile(suffix=".ts") as output:
                    output.write(result.stdout)
                    output.flush()
                    probe = subprocess.run(
                        [
                            "ffprobe",
                            "-v",
                            "error",
                            "-show_entries",
                            "stream=codec_name",
                            "-of",
                            "csv=p=0",
                            output.name,
                        ],
                        capture_output=True,
                        check=True,
                    )
                    self.assertIn(b"h264", probe.stdout)
                    self.assertIn(b"aac", probe.stdout)
                    decoded = subprocess.run(
                        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", output.name,
                         "-t", "1", "-vn", "-ac", "2", "-ar", "48000", "-f", "s16le", "pipe:1"],
                        capture_output=True, timeout=12,
                    )
                    self.assertEqual(decoded.returncode, 0)
                    self.assertGreater(len(decoded.stdout), 96000, "Normalized AAC must actually decode")
                    self.assertEqual(decoded.stderr, b"", "No AAC corruption after normalization")
                self.assertLessEqual(
                    reader.reservoir.high_water
                    + adapter.PYTHON_STAGING_BOUND
                    + adapter.NODE_BUFFER_BOUND,
                    4 * 1024 * 1024,
                )

    def test_aes_key_and_discontinuity_map(self):
        data = (self.root / "mpegts" / "index0.ts").read_bytes()
        key = b"0123456789abcdef"
        iv = bytes(16)
        encrypted = AES.new(key, AES.MODE_CBC, iv).encrypt(pad(data, 16))
        self.fixture.routes["/key"] = (200, {}, key)
        self.fixture.routes["/encrypted"] = (200, {}, encrypted)
        manifest = b'#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI="/key",IV=0x00000000000000000000000000000000\n#EXTINF:1,\n/encrypted\n#EXT-X-ENDLIST\n'
        self.fixture.routes["/encrypted.m3u8"] = (200, {}, manifest)
        reader, actual, _ = self.read_hls("/encrypted.m3u8")
        self.assertIsNone(reader.failure)
        self.assertEqual(actual, data)
        self.assertIn("/key", self.fixture.hits)
        text = (
            (self.root / "fmp4" / "index.m3u8")
            .read_text()
            .replace("#EXTINF:1.000000,", "#EXT-X-DISCONTINUITY\n#EXTINF:1.000000,")
        )
        self.fixture.routes["/fmp4/index.m3u8"] = (200, {}, text.encode())
        reader, actual, _ = self.read_hls("/fmp4/index.m3u8")
        self.assertIsNone(reader.failure)
        self.assertGreaterEqual(self.fixture.hits.count("/fmp4/init.mp4"), 2)

    def test_redirect_final_url_bases_relative_encrypted_map_key_and_segment(self):
        self.fixture.close()
        self.fixture = TLSFixture(san="*.ttvnw.net")
        key, iv = b"0123456789abcdef", bytes(16)
        init = (self.root / "fmp4" / "init.mp4").read_bytes()
        media = (self.root / "fmp4" / "index0.m4s").read_bytes()
        self.fixture.routes["/old/index.m3u8"] = (
            302,
            {"Location": "https://other.ttvnw.net/new/index.m3u8"},
            b"",
        )
        manifest = b'#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x00000000000000000000000000000000\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nsegment.m4s\n#EXT-X-ENDLIST\n'
        self.fixture.routes["/new/index.m3u8"] = (200, {}, manifest)
        self.fixture.routes["/new/key"] = (200, {}, key)
        for name, data in (("init.mp4", init), ("segment.m4s", media)):
            self.fixture.routes["/new/" + name] = (
                200,
                {},
                AES.new(key, AES.MODE_CBC, iv).encrypt(pad(data, 16)),
            )
        reader, actual, events = self.read_hls("/old/index.m3u8")
        self.assertIsNone(reader.failure)
        self.assertEqual(actual, init + media)
        self.assertIn("/new/key", self.fixture.hits)
        self.assertIn("/new/init.mp4", self.fixture.hits)
        self.assertIn("/new/segment.m4s", self.fixture.hits)
        self.assertFalse(
            any(
                hit.startswith("/old/") and hit != "/old/index.m3u8"
                for hit in self.fixture.hits
            )
        )

    def test_nested_file_key_init_segment_redirect_fail_closed(self):
        for tag in [
            '#EXT-X-KEY:METHOD=AES-128,URI="file:///etc/passwd"\n#EXTINF:1,\n/mpegts/index0.ts',
            '#EXT-X-MAP:URI="file:///etc/passwd"\n#EXTINF:1,\n/mpegts/index0.ts',
            "#EXTINF:1,\nfile:///etc/passwd",
            "#EXTINF:1,\nhttps://unknown.example/a",
            "#EXTINF:1,\n/redirect",
        ]:
            self.fixture.routes["/bad.m3u8"] = (
                200,
                {},
                (
                    "#EXTM3U\n#EXT-X-TARGETDURATION:1\n" + tag + "\n#EXT-X-ENDLIST\n"
                ).encode(),
            )
            self.fixture.routes["/redirect"] = (
                302,
                {"Location": "https://127.0.0.1/private"},
                b"",
            )
            reader, data, _ = self.read_hls("/bad.m3u8")
            self.assertIsNotNone(reader.failure)
            self.assertEqual(data, b"")

    def test_ad_and_403_are_missing_media(self):
        self.fixture.routes["/ad.m3u8"] = (
            200,
            {},
            b"#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,Amazon ad\n/mpegts/index0.ts\n#EXT-X-ENDLIST\n",
        )
        reader, data, events = self.read_hls("/ad.m3u8")
        self.assertEqual(data, b"")
        self.assertEqual(events, ["ad_wait"])
        self.fixture.routes["/expired"] = (403, {}, b"signed-url-secret")
        self.fixture.routes["/expired.m3u8"] = (
            200,
            {},
            b"#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n/expired\n#EXT-X-ENDLIST\n",
        )
        reader, data, _ = self.read_hls("/expired.m3u8")
        self.assertEqual(data, b"")
        self.assertEqual(reader.failure, "provider_unavailable")

    def test_three_second_cold_then_warmup_before_normalized_ready(self):
        events = []
        started = time.monotonic()

        def resolve(session, channel, preset):
            session.http = self.fixture.session().http
            time.sleep(3)
            return NS(url="https://video.ttvnw.net/mpegts/index.m3u8")

        with tempfile.TemporaryFile() as output:

            def event(kind, **fields):
                events.append((kind, time.monotonic() - started, fields))

            with self.assertRaises(adapter.InputError):
                adapter.run_attempt(
                    "synthetic",
                    "720p30",
                    resolver=resolve,
                    on_state=event,
                    output_fd=output.fileno(),
                )
            output.seek(0)
            self.assertGreater(len(output.read()), 188)
        ready = [item for item in events if item[0] == "transport_ready"]
        self.assertEqual(len(ready), 1)
        self.assertGreaterEqual(ready[0][1], 5)
        self.assertLess(ready[0][1], 10)
        buffers = [
            e[2]["pythonBufferUpperBoundBytes"] for e in events if e[0] == "buffer"
        ]
        pipe_facts = next(e[2] for e in events if e[0] == "buffer")
        self.assertGreater(pipe_facts["remuxInputPipeBytes"], 0)
        self.assertGreater(pipe_facts["remuxOutputPipeBytes"], 0)
        buffer_high_water_bytes = max(buffers) + adapter.NODE_BUFFER_BOUND
        self.assertLessEqual(buffer_high_water_bytes, 4 * 1024 * 1024)
        print(
            "TWITCH_BUFFER_FACTS",
            adapter.json.dumps(
                {
                    "readySeconds": round(ready[0][1], 3),
                    "pythonAccountedPeakBytes": max(buffers),
                    "combinedConservativePeakBytes": buffer_high_water_bytes,
                    "applicationHardBoundBytes": adapter.APPLICATION_BUFFER_BOUND,
                    "remuxInputPipeBytes": pipe_facts["remuxInputPipeBytes"],
                    "remuxOutputPipeBytes": pipe_facts["remuxOutputPipeBytes"],
                },
                sort_keys=True,
            ),
        )

    def test_byte_range_and_scheme_relative_resources(self):
        data = (self.root / "mpegts" / "index0.ts").read_bytes()
        self.fixture.routes["/part"] = (
            206,
            {"Content-Range": f"bytes 0-{len(data)-1}/{len(data)}"},
            data,
        )
        manifest = f"#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-BYTERANGE:{len(data)}@0\n#EXTINF:1,\n//video.ttvnw.net/part\n#EXT-X-ENDLIST\n"
        self.fixture.routes["/range.m3u8"] = (200, {}, manifest.encode())
        reader, actual, _ = self.read_hls("/range.m3u8")
        self.assertIsNone(reader.failure)
        self.assertEqual(actual, data)

    def test_daterange_ad_is_not_fetched(self):
        self.fixture.routes["/dated-ad.m3u8"] = (
            200,
            {},
            b'#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-01-01T00:00:00Z",DURATION=2\n#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00Z\n#EXTINF:1,\n/mpegts/index0.ts\n#EXT-X-ENDLIST\n',
        )
        reader, data, events = self.read_hls("/dated-ad.m3u8")
        self.assertEqual(data, b"")
        self.assertEqual(events, ["ad_wait"])
        self.assertNotIn("/mpegts/index0.ts", self.fixture.hits)

    def test_actual_unsupported_codec_is_rejected_despite_manifest_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            media = Path(directory) / "unsupported.ts"
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=160x90:rate=10",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440",
                    "-t",
                    "1",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-c:a",
                    "libopus",
                    "-f",
                    "mpegts",
                    str(media),
                ],
                check=True,
            )
            result = subprocess.run(
                adapter.remux_command(),
                input=media.read_bytes(),
                capture_output=True,
                timeout=8,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"", "Unsupported audio must not be copied")

    def test_delivery_jitter_keeps_normalized_packet_progress(self):
        handler = self.fixture.server.RequestHandlerClass
        original = handler.do_GET

        def jitter(request):
            if request.path.endswith("index2.ts"):
                time.sleep(0.7)
            original(request)

        handler.do_GET = jitter
        events = []

        def resolve(session, channel, preset):
            session.http = self.fixture.session().http
            return NS(url="https://video.ttvnw.net/mpegts/index.m3u8")

        with tempfile.TemporaryFile() as output:
            with self.assertRaises(adapter.InputError):
                adapter.run_attempt(
                    "synthetic",
                    "720p30",
                    resolver=resolve,
                    on_state=lambda kind, **kw: events.append((kind, kw)),
                    output_fd=output.fileno(),
                )
            output.seek(0)
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "packet=dts_time",
                    "-of",
                    "csv=p=0",
                    "pipe:0",
                ],
                input=output.read(),
                capture_output=True,
                check=True,
            )
        stamps = [
            float(row.split(",")[0])
            for row in probe.stdout.decode().splitlines()
            if row and row[0].isdigit()
        ]
        self.assertGreater(len(stamps), 90)
        self.assertEqual(stamps, sorted(stamps))
        self.assertEqual(sum(kind == "transport_ready" for kind, _ in events), 1)

    def test_403_discards_locator_and_next_resolution_is_fresh(self):
        self.fixture.routes["/expired.m3u8"] = (403, {}, b"not logged")
        resolutions = []

        def resolve(session, channel, preset):
            resolutions.append(channel)
            session.http = self.fixture.session().http
            path = "/expired.m3u8" if len(resolutions) == 1 else "/mpegts/index.m3u8"
            return NS(url="https://video.ttvnw.net" + path)

        with tempfile.TemporaryFile() as output:
            for _ in range(2):
                with self.assertRaises(adapter.InputError):
                    adapter.run_attempt(
                        "synthetic",
                        "720p30",
                        resolver=resolve,
                        on_state=lambda *a, **kw: None,
                        output_fd=output.fileno(),
                    )
            output.seek(0)
            self.assertGreater(len(output.read()), 188)
        self.assertEqual(resolutions, ["synthetic", "synthetic"])
        self.assertEqual(self.fixture.hits.count("/expired.m3u8"), 1)


class OuterDeadlineContracts(unittest.TestCase):
    def test_blocked_resolution_exits_without_output_at_fifteen_seconds(self):
        code = """import time
from workers.restream.twitch_input import run_attempt
run_attempt('synthetic','720p30',resolver=lambda *args:time.sleep(60))
"""
        started = time.monotonic()
        child = subprocess.Popen(
            [__import__("sys").executable, "-c", code],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            out, err = child.communicate(timeout=17)
            elapsed = time.monotonic() - started
            self.assertGreaterEqual(elapsed, 15)
            self.assertLess(elapsed, 16.5)
            self.assertEqual(out, b"")
            self.assertIn(b'"reason":"media_timeout"', err)
            self.assertNotIn(b"Traceback", err)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, 9)
            child.wait()


class AnonymousAcquisitionContracts(unittest.TestCase):
    def test_integrity_challenge_has_no_cached_or_browser_fallback(self):
        session = adapter.Streamlink({"no-plugin-cache": True, "webbrowser": False})
        plugin = adapter.AnonymousTwitch(
            session,
            "https://www.twitch.tv/synthetic",
            options={"supported-codecs": ["h264"]},
        )
        with self.assertRaises(adapter.InputError):
            plugin._client_integrity_token("synthetic")
        self.assertTrue(plugin.cache._disabled)


class AdvertisementDeadlineContracts(unittest.TestCase):
    def test_live_ad_wait_ends_after_fifteen_seconds_without_readiness(self):
        code = """import sys
from types import SimpleNamespace
import workers.restream
sys.path.insert(0,'workers/restream/tests')
from test_twitch_transport import TLSFixture
from workers.restream.twitch_input import run_attempt
fixture=TLSFixture()
fixture.routes['/ads']=(200,{},b'#EXTM3U\\n#EXT-X-TARGETDURATION:1\\n#EXTINF:1,Amazon ad\\n/ad.ts\\n')
def resolve(session,channel,preset):
    session.http=fixture.session().http
    return SimpleNamespace(url='https://video.ttvnw.net/ads')
run_attempt('synthetic','720p30',resolver=resolve)
"""
        child = subprocess.Popen(
            [__import__("sys").executable, "-c", code],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            first = child.stderr.readline()
            self.assertIn(b'"kind":"acquiring"', first)
            started = time.monotonic()
            out, err = child.communicate(timeout=17)
            self.assertLess(time.monotonic() - started, 16.5)
            self.assertEqual(out, b"")
            self.assertIn(b'"kind":"ad_wait"', err)
            self.assertIn(b'"reason":"media_timeout"', err)
            self.assertNotIn(b"transport_ready", err)
            self.assertNotIn(b"Traceback", err)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, 9)
            child.wait()


class AdvertisementTimelineContracts(unittest.TestCase):
    HEADER = "#EXTM3U\n#EXT-X-TARGETDURATION:1\n"
    AD = '#EXT-X-DATERANGE:ID="stitched-ad-1",CLASS="twitch-stitched-ad",START-DATE="2026-01-01T00:00:00Z",DURATION=3\n'
    ANCHOR = "#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00Z\n"

    def run_playlists(self, bodies):
        hits, events = [], []
        bodies = iter(bodies)

        class Response:
            headers = {}
            status_code = 200

            def __init__(self, url, body):
                self.url, self.body = url, body

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def raise_for_status(self):
                pass

            def iter_content(self, _):
                yield self.body

        class HTTP:
            def get(self, url, **_):
                hits.append((url.rsplit("/", 1)[-1], list(events)))
                return Response(
                    url,
                    next(bodies).encode() if url.endswith("index.m3u8") else b"NORMAL",
                )

        reservoir = adapter.Reservoir()
        reader = adapter.HLSReader(
            HTTP(),
            "https://video.ttvnw.net/index.m3u8",
            reservoir,
            lambda kind, **_: events.append(kind),
        )
        with patch.object(adapter.time, "sleep"):
            reader.run()
        data = b""
        while chunk := reservoir.take():
            data += chunk
        return reader, data, events, hits

    def test_one_anchor_covers_all_ad_segments_and_resumes_after_range(self):
        body = (
            self.HEADER
            + self.AD
            + self.ANCHOR
            + "".join(f"#EXTINF:1,\nad{i}.ts\n" for i in range(3))
            + "#EXTINF:1,\nnormal.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([body])
        self.assertIsNone(reader.failure)
        self.assertEqual(data, b"NORMAL")
        self.assertEqual(events, ["ad_wait", "acquiring"])
        self.assertEqual([name for name, _ in hits], ["index.m3u8", "normal.ts"])

    def test_sliding_reload_without_anchor_or_range_preserves_ad_timeline(self):
        first = (
            self.HEADER
            + self.AD
            + self.ANCHOR
            + "#EXTINF:1,\nad0.ts\n#EXTINF:1,\nad1.ts\n"
        )
        second = (
            self.HEADER
            + "#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1,\nad1.ts\n#EXTINF:1,\nad2.ts\n#EXTINF:1,\nnormal.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([first, second])
        self.assertIsNone(reader.failure)
        self.assertEqual(data, b"NORMAL")
        self.assertEqual(events, ["ad_wait", "acquiring"])
        self.assertEqual(hits[1], ("index.m3u8", ["ad_wait"]))
        self.assertEqual(
            [name for name, _ in hits], ["index.m3u8", "index.m3u8", "normal.ts"]
        )

    def test_discontinuity_without_anchor_fails_closed(self):
        body = (
            self.HEADER
            + self.AD
            + self.ANCHOR
            + "#EXTINF:1,\nad0.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:1,\nunknown.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([body])
        self.assertEqual(reader.failure, "unsupported_media")
        self.assertEqual(data, b"")
        self.assertNotIn("acquiring", events)
        self.assertEqual([name for name, _ in hits], ["index.m3u8"])

    def test_discontinuity_with_new_anchor_can_resume(self):
        body = (
            self.HEADER
            + self.AD
            + self.ANCHOR
            + "#EXTINF:1,\nad0.ts\n#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:03Z\n#EXTINF:1,\nnormal.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([body])
        self.assertIsNone(reader.failure)
        self.assertEqual(data, b"NORMAL")
        self.assertEqual(events, ["ad_wait", "acquiring"])
        self.assertEqual([name for name, _ in hits], ["index.m3u8", "normal.ts"])

    def test_later_anchor_extrapolates_backwards_inside_continuity(self):
        body = (
            self.HEADER
            + self.AD
            + "#EXTINF:1,\nad0.ts\n#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:01Z\n#EXTINF:1,\nad1.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([body])
        self.assertIsNone(reader.failure)
        self.assertEqual(data, b"")
        self.assertEqual(events, ["ad_wait"])
        self.assertEqual([name for name, _ in hits], ["index.m3u8"])

    def test_missing_reload_overlap_and_anchor_fails_closed(self):
        first = self.HEADER + self.AD + self.ANCHOR + "#EXTINF:1,\nad0.ts\n"
        second = (
            self.HEADER
            + "#EXT-X-MEDIA-SEQUENCE:2\n#EXTINF:1,\nunknown.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([first, second])
        self.assertEqual(reader.failure, "unsupported_media")
        self.assertEqual(data, b"")
        self.assertEqual(events, ["ad_wait"])
        self.assertEqual([name for name, _ in hits], ["index.m3u8", "index.m3u8"])

    def test_planned_duration_does_not_prove_ad_end(self):
        body = (
            self.HEADER
            + self.AD.replace("DURATION=3", "PLANNED-DURATION=1")
            + self.ANCHOR
            + "".join(f"#EXTINF:1,\nad{i}.ts\n" for i in range(3))
            + "#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([body])
        self.assertIsNone(reader.failure)
        self.assertEqual(data, b"")
        self.assertEqual(events, ["ad_wait"])
        self.assertEqual([name for name, _ in hits], ["index.m3u8"])

    def test_timeline_is_replaced_and_ad_metadata_limit_fails_closed(self):
        from datetime import datetime, timezone, timedelta

        reader = adapter.HLSReader(
            None, "https://video.ttvnw.net/index.m3u8", adapter.Reservoir()
        )
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for index in range(3000):
            reader._program_times(
                [NS(num=index, duration=1, date=start, discontinuity=False)]
            )
            self.assertEqual(len(reader.timeline), 1)
        for index in range(128):
            reader._remember_ads(
                NS(
                    dateranges=[
                        NS(
                            id=str(index),
                            classname="twitch-stitched-ad",
                            start_date=start,
                            end_date=None,
                            duration=timedelta(seconds=1),
                        )
                    ]
                )
            )
        with self.assertRaises(adapter.InputError):
            reader._remember_ads(
                NS(
                    dateranges=[
                        NS(
                            id="overflow",
                            classname="twitch-stitched-ad",
                            start_date=start,
                            end_date=None,
                            duration=timedelta(seconds=1),
                        )
                    ]
                )
            )
        self.assertLessEqual(len(reader.ad_ranges), 128)

    def test_discontinuity_sequence_advance_without_anchor_fails_closed(self):
        first = (
            self.HEADER
            + "#EXT-X-DISCONTINUITY-SEQUENCE:0\n"
            + self.AD
            + "#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:02Z\n"
            + "#EXTINF:1,\nad0.ts\n"
        )
        second = (
            self.HEADER
            + "#EXT-X-MEDIA-SEQUENCE:1\n"
            + "#EXT-X-DISCONTINUITY-SEQUENCE:1\n"
            + "#EXTINF:1,\nunknown.ts\n#EXT-X-ENDLIST\n"
        )
        reader, data, events, hits = self.run_playlists([first, second])
        self.assertEqual(reader.failure, "unsupported_media")
        self.assertEqual(data, b"")
        self.assertEqual(events, ["ad_wait"])
        self.assertEqual([name for name, _ in hits], ["index.m3u8", "index.m3u8"])

    def test_discontinuity_base_advance_preserves_known_new_side_overlap(self):
        for steps in (1, 2):
            with self.subTest(preceding_tags=steps):
                first = (
                    self.HEADER
                    + "#EXT-X-DISCONTINUITY-SEQUENCE:7\n"
                    + self.AD
                    + self.ANCHOR
                    + "#EXTINF:1,\nad0.ts\n"
                    + "#EXT-X-DISCONTINUITY\n" * steps
                    + "#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:02Z\n"
                    + "#EXTINF:1,\nad1.ts\n"
                )
                second = (
                    self.HEADER
                    + "#EXT-X-MEDIA-SEQUENCE:1\n"
                    + f"#EXT-X-DISCONTINUITY-SEQUENCE:{7 + steps}\n"
                    + "#EXTINF:1,\nad1.ts\n#EXTINF:1,\nnormal.ts\n#EXT-X-ENDLIST\n"
                )
                reader, data, events, hits = self.run_playlists([first, second])
                self.assertIsNone(reader.failure)
                self.assertEqual(data, b"NORMAL")
                self.assertEqual(events, ["ad_wait", "acquiring"])
                self.assertEqual(hits[1], ("index.m3u8", ["ad_wait"]))
                self.assertEqual(
                    [name for name, _ in hits],
                    ["index.m3u8", "index.m3u8", "normal.ts"],
                )
