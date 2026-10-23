"""One canonical Twitch acquisition attempt. stdout is normalized MPEGTS only.

The Node owner retries fresh processes and owns process-group cancellation. No
Streamlink media reader/futures/ring is opened: sequential HLS reads bound memory.
"""

import argparse
import fcntl
from collections import deque
from datetime import timedelta
import math
import json
import logging
import os
import re
import selectors
import signal
import subprocess
import sys
import threading
import time

from streamlink import Streamlink
from streamlink.plugins.twitch import __plugin__ as Twitch
from streamlink.stream.hls.m3u8 import M3U8Parser, parse_m3u8, parse_tag
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

from .twitch_transport import (
    BoundaryError,
    CHUNK,
    RESPONSE_LIMIT,
    install_fetch_boundary,
    safe_reason,
    validate_url,
)

PRESETS = {f"{h}p{fps}": (h, fps) for h in (480, 720, 1080) for fps in (30, 60)}
RESERVOIR_LIMIT = 2 * 1024 * 1024
# Compressed payload budget: source ring + HTTP/API copies + decrypt/staging +
# Node backlog/read/write. Kernel pipes and FFmpeg demux internals are separate.
PYTHON_STAGING_BOUND = 2 * RESPONSE_LIMIT + 12 * CHUNK
NODE_BUFFER_BOUND = 512 * 1024
APPLICATION_BUFFER_BOUND = RESERVOIR_LIMIT + PYTHON_STAGING_BOUND + NODE_BUFFER_BOUND
WARMUP_SECONDS = 2
MEDIA_TIMEOUT = 15


class InputError(BoundaryError):
    pass


class AnonymousTwitch(Twitch):
    def _client_integrity_token(self, channel):
        # The upstream fallback can load a cached integrity token even when the
        # browser option is off. Neither cache nor browser is an allowed path.
        raise InputError("provider_unavailable")


class Reservoir:
    def __init__(self, limit=RESERVOIR_LIMIT):
        self.limit, self.size, self.high_water = limit, 0, 0
        self.items = deque()
        self.condition = threading.Condition()
        self.closed = False
        self.first_at = None

    def put(self, data, timeout=None):
        if len(data) > self.limit:
            raise InputError("response_limit")
        with self.condition:
            if not self.condition.wait_for(
                lambda: self.closed or self.size + len(data) <= self.limit, timeout
            ):
                return False
            if self.closed:
                return False
            self.items.append(data)
            self.size += len(data)
            self.high_water = max(self.high_water, self.size)
            if self.first_at is None:
                self.first_at = time.monotonic()
            self.condition.notify_all()
            return True

    def take(self):
        with self.condition:
            self.condition.wait_for(lambda: self.closed or self.items)
            if not self.items:
                return b""
            data = self.items.popleft()
            self.size -= len(data)
            self.condition.notify_all()
            return data

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()


def select_rendition(streams, preset):
    target_height, target_fps = PRESETS[preset]
    options = {}
    for stream in streams.values():
        url = getattr(stream, "url", None)
        manifest = getattr(stream, "multivariant", None)
        for playlist in getattr(manifest, "playlists", []):
            if playlist.uri != url:
                continue
            info = playlist.stream_info
            res = getattr(info, "resolution", None)
            fps = getattr(info, "framerate", None)
            codecs = getattr(info, "codecs", [])
            if (
                not res
                or not 0 < res.width <= 1920
                or not 0 < res.height <= 1080
                or not fps
                or not 0 < fps <= 60.01
                or not any(c.startswith(("avc1", "avc3")) for c in codecs)
                or not any(c.startswith("mp4a.40.") for c in codecs)
            ):
                continue
            options[url] = (res.height, fps, stream)
    if not options:
        raise InputError("unsupported_media")
    below = [v for v in options.values() if v[0] <= target_height]
    height = max(v[0] for v in below) if below else min(v[0] for v in options.values())
    choices = [v for v in options.values() if v[0] == height]
    return min(choices, key=lambda v: (abs(v[1] - target_fps), -v[1]))[2]


def remux_command():
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "pipe",
        "-format_whitelist",
        "mov,mpegts",
        "-analyzeduration",
        "1000000",
        "-probesize",
        "1000000",
        "-readrate",
        "1",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c",
        "copy",
        "-bsf:v",
        "h264_mp4toannexb",
        "-bsf:a",
        "aac_adtstoasc",
        "-mpegts_flags",
        "+resend_headers",
        "-muxdelay",
        "0",
        "-flush_packets",
        "1",
        "-f",
        "mpegts",
        "pipe:1",
    ]


def emit(kind, **fields):
    # Only local fixed fields reach this function, never provider values/errors.
    line = json.dumps({"kind": kind, **fields}, separators=(",", ":"))
    try:
        os.write(2, (line + "\n").encode())
    except OSError:
        pass


class MediaPlaylistParser(M3U8Parser):
    @parse_tag("EXT-X-DISCONTINUITY")
    def discontinuity(self, value):
        # EXT-X-MAP remains applicable until another MAP (RFC 8216 4.3.2.5).
        # The upstream generic parser clears it at discontinuities.
        self._discontinuity = True
        self._continuity_steps = getattr(self, "_continuity_steps", 0) + 1

    @parse_tag("EXT-X-DISCONTINUITY-SEQUENCE")
    def discontinuity_sequence(self, value):
        # Streamlink 8.6.2 registers this tag with a spelling error. Parse the
        # standard spelling here; an absent sequence defaults to zero in HLS.
        if not re.fullmatch(r"[0-9]{1,20}", value) or int(value) > 2**64 - 1:
            raise InputError("unsupported_media")
        self.m3u8.discontinuity_sequence = int(value)

    def get_segment(self, uri):
        segment = super().get_segment(uri)
        # Count every preceding tag, including consecutive discontinuities.
        segment.continuity_steps = getattr(self, "_continuity_steps", 0)
        self._continuity_steps = 0
        return segment


class HLSReader:
    def __init__(self, http, url, reservoir, on_state=emit):
        self.http, self.url, self.reservoir, self.on_state = (
            http,
            url,
            reservoir,
            on_state,
        )
        self.last_sequence = None
        self.last_map = None
        self.range_end = {False: None, True: None}
        self.ad = False
        self.failure = None
        self.staging_high_water = 0
        self.timeline = {}  # Only the latest playlist, at most 2048 timestamps.
        self.ad_ranges = {}  # At most 128 compact id/start/end records per attempt.

    def _bytes(self, url, limit=RESPONSE_LIMIT, headers=None, on_response=None):
        validate_url(url)
        with self.http.get(
            url, stream=True, headers=headers or {}, timeout=5, retries=0
        ) as response:
            response.raise_for_status()
            validate_url(response.url)
            if on_response:
                on_response(response.url)
            if headers and "Range" in headers:
                expected = "bytes " + headers["Range"][6:] + "/"
                if response.status_code != 206 or not response.headers.get(
                    "Content-Range", ""
                ).startswith(expected):
                    raise InputError("unsupported_media")
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise InputError("unsupported_media")
            total = 0
            for data in response.iter_content(CHUNK):
                total += len(data)
                if limit is not None and total > limit:
                    raise InputError("response_limit")
                self.staging_high_water = max(self.staging_high_water, len(data))
                yield data

    def _small(self, url, limit):
        return b"".join(self._bytes(url, limit))

    def _range(self, item, is_map):
        if not item.byterange:
            return {}, None
        start = item.byterange.offset
        previous = self.range_end[is_map]
        if start is None and previous is not None and previous[0] == item.uri:
            start = previous[1]
        size = item.byterange.range
        if start is None or start < 0 or size <= 0:
            raise InputError("unsupported_media")
        end = start + size
        # Only current segment and map offsets retained, never a growing URI map.
        self.range_end[is_map] = (item.uri, end)
        return {"Range": f"bytes={start}-{end-1}"}, size

    def _media(self, item, sequence, is_map=False):
        headers, range_size = self._range(item, is_map)
        key = item.key
        decryptor = None
        if key and key.method != "NONE":
            if key.method != "AES-128" or not key.uri or (is_map and key.iv is None):
                raise InputError("unsupported_media")
            key_data = self._small(key.uri, 16)
            if len(key_data) != 16:
                raise InputError("unsupported_media")
            decryptor = AES.new(
                key_data, AES.MODE_CBC, key.iv or sequence.to_bytes(16, "big")
            )
        pending = b""
        total = 0
        for chunk in self._bytes(item.uri, None, headers):
            total += len(chunk)
            if range_size is not None and total > range_size:
                raise InputError("response_limit")
            if decryptor:
                pending += chunk
                length = ((len(pending) - 1) // 16) * 16
                if length > 0:
                    data = decryptor.decrypt(pending[:length])
                    pending = pending[length:]
                else:
                    continue
            else:
                data = chunk
            if not self.reservoir.put(data):
                return
        if range_size is not None and total != range_size:
            raise InputError("unsupported_media")
        if decryptor:
            if not pending or len(pending) % 16:
                raise InputError("unsupported_media")
            self.reservoir.put(unpad(decryptor.decrypt(pending), 16))

    def _playlist(self):
        final_urls = []
        body = b"".join(self._bytes(self.url, on_response=final_urls.append))
        return parse_m3u8(
            body.decode("utf-8"), base_uri=final_urls[0], parser=MediaPlaylistParser
        )

    def _program_times(self, segments, discontinuity_sequence=0):
        dates, identities = [], []
        continuity = discontinuity_sequence if discontinuity_sequence is not None else 0
        for index, segment in enumerate(segments):
            continuity += getattr(
                segment, "continuity_steps", int(segment.discontinuity)
            )
            identities.append(continuity)
            if not math.isfinite(segment.duration) or segment.duration <= 0:
                raise InputError("unsupported_media")
            date = segment.date
            cached = self.timeline.get((segment.num, continuity))
            if date is None and cached and cached[1] == segment.duration:
                date = cached[0]
            if date is None and not segment.discontinuity:
                if (
                    index
                    and segments[index - 1].num + 1 == segment.num
                    and identities[index - 1] == continuity
                ):
                    previous = (dates[-1], segments[index - 1].duration)
                else:
                    previous = self.timeline.get((segment.num - 1, continuity))
                if previous and previous[0] is not None:
                    date = previous[0] + timedelta(seconds=previous[1])
            dates.append(date)
        # HLS allows an explicit anchor after the first segment. Extrapolate
        # backwards only within the same continuous sequence, never across a
        # discontinuity whose new timeline has no known anchor.
        for index in range(len(segments) - 2, -1, -1):
            if (
                dates[index] is None
                and dates[index + 1] is not None
                and identities[index] == identities[index + 1]
                and segments[index].num + 1 == segments[index + 1].num
            ):
                dates[index] = dates[index + 1] - timedelta(
                    seconds=segments[index].duration
                )
        self.timeline = {
            (segment.num, identity): (date, segment.duration)
            for segment, date, identity in zip(segments, dates, identities)
        }
        return dates

    def _remember_ads(self, playlist):
        for item in playlist.dateranges:
            if item.classname != "twitch-stitched-ad" and not str(
                item.id or ""
            ).startswith("stitched-ad-"):
                continue
            if not item.id or len(item.id) > 256 or item.start_date is None:
                raise InputError("unsupported_media")
            end = item.end_date
            # PLANNED-DURATION is not proof the ad ended. Missing/END-ON-NEXT
            # end evidence remains an open range until a later explicit update.
            if end is None and item.duration is not None:
                if item.duration.total_seconds() < 0:
                    raise InputError("unsupported_media")
                end = item.start_date + item.duration
            if end is not None and end < item.start_date:
                raise InputError("unsupported_media")
            previous = self.ad_ranges.get(item.id)
            if previous and (
                previous[0] != item.start_date
                or (previous[1] is not None and end is not None and previous[1] != end)
            ):
                raise InputError("unsupported_media")
            if previous and end is None:
                end = previous[1]
            if item.id not in self.ad_ranges and len(self.ad_ranges) >= 128:
                raise InputError("response_limit")
            self.ad_ranges[item.id] = (item.start_date, end)

    def _is_ad(self, segment, date):
        if segment.title and "Amazon" in segment.title:
            return True
        if not self.ad_ranges:
            return False
        if date is None:
            # A sliding reload can omit anchors/ranges. If bounded history
            # cannot establish time, no bytes may escape as apparent content.
            raise InputError("unsupported_media")
        end = date + timedelta(seconds=segment.duration)
        return any(
            date < stop and end > start if stop is not None else end > start
            for start, stop in self.ad_ranges.values()
        )

    def run(self):
        try:
            while not self.reservoir.closed:
                playlist = self._playlist()
                if playlist.is_master:
                    # Only the already selected rendition may be used. Nested
                    # masters are unsupported; nested media resources are bounded.
                    raise InputError("unsupported_media")
                segments = playlist.segments
                if len(segments) > 2048:
                    raise InputError("response_limit")
                self._remember_ads(playlist)
                dates = self._program_times(segments, playlist.discontinuity_sequence)
                # Enter live close to its edge; VOD fixtures retain their beginning.
                if (
                    self.last_sequence is None
                    and not playlist.is_endlist
                    and len(segments) > 3
                ):
                    segments = segments[-3:]
                    dates = dates[-3:]
                for segment, date in zip(segments, dates):
                    if self.reservoir.closed:
                        return
                    if (
                        self.last_sequence is not None
                        and segment.num <= self.last_sequence
                    ):
                        continue
                    ad = self._is_ad(segment, date)
                    if ad:
                        if not self.ad:
                            self.on_state("ad_wait")
                        self.ad = True
                        self.last_sequence = segment.num
                        continue
                    if self.ad:
                        self.on_state("acquiring")
                        self.ad = False
                    if segment.map and (
                        self.last_map != segment.map or segment.discontinuity
                    ):
                        self._media(segment.map, segment.num, True)
                        self.last_map = segment.map
                    self._media(segment, segment.num)
                    self.last_sequence = segment.num
                if playlist.is_endlist:
                    break
                time.sleep(min(1, max(0.1, (playlist.targetduration or 2) / 2)))
        except BaseException as exc:
            self.failure = safe_reason(exc)
        finally:
            self.reservoir.close()


def run_attempt(
    channel,
    preset,
    *,
    session_factory=Streamlink,
    resolver=None,
    on_state=emit,
    output_fd=1,
):
    started = time.monotonic()
    last_output = started
    on_state("acquiring")
    session = session_factory(
        {"http-timeout": 5, "webbrowser": False, "no-plugin-cache": True}
    )
    reservoir = Reservoir()
    mux = None
    # The outer watchdog covers even plugin code/library waits before threads start.
    watchdog = threading.Event()

    def guard():
        while not watchdog.wait(0.05):
            if time.monotonic() - last_output >= MEDIA_TIMEOUT:
                on_state("unavailable", reason="media_timeout")
                os._exit(4)  # Node kills the remaining group, including a dead leader.

    threading.Thread(target=guard, daemon=True).start()
    try:
        if resolver is None:
            install_fetch_boundary(session)
            selected = select_rendition(
                AnonymousTwitch(
                    session,
                    "https://www.twitch.tv/" + channel,
                    options={"supported-codecs": ["h264"]},
                ).streams(),
                preset,
            )
        else:
            selected = resolver(
                session, channel, preset
            )  # Internal synthetic fixture seam.
        reader = HLSReader(session.http, selected.url, reservoir, on_state)
        threading.Thread(target=reader.run, daemon=True).start()
        while reservoir.first_at is None:
            if reservoir.closed:
                raise InputError(reader.failure or "provider_unavailable")
            time.sleep(0.01)
        on_state("warming")
        while time.monotonic() - reservoir.first_at < WARMUP_SECONDS:
            time.sleep(0.01)
        mux = subprocess.Popen(
            remux_command(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
        )

        input_pipe_bytes = fcntl.fcntl(mux.stdin.fileno(), fcntl.F_GETPIPE_SZ)
        output_pipe_bytes = fcntl.fcntl(mux.stdout.fileno(), fcntl.F_GETPIPE_SZ)

        def feed():
            try:
                while data := reservoir.take():
                    view = memoryview(data)
                    while view:
                        count = os.write(mux.stdin.fileno(), view)
                        view = view[count:]
            except (OSError, ValueError):
                pass
            finally:
                try:
                    mux.stdin.close()
                except OSError:
                    pass

        threading.Thread(target=feed, daemon=True).start()
        selector = selectors.DefaultSelector()
        selector.register(mux.stdout, selectors.EVENT_READ)
        ready = False
        next_report = 0
        while True:
            if not selector.select(0.1):
                if mux.poll() is not None:
                    break
                continue
            data = os.read(mux.stdout.fileno(), CHUNK)
            if not data:
                break
            # FFmpeg produced normalized TS; Node retains these bytes before
            # resolving transportReady. The downstream decoder guard starts then.
            view = memoryview(data)
            while view:
                written = os.write(output_fd, view)
                view = view[written:]
            last_output = time.monotonic()
            if not ready:
                ready = True
                on_state(
                    "transport_ready",
                    warmupMs=round((last_output - reservoir.first_at) * 1000),
                )
            if last_output >= next_report:
                on_state(
                    "buffer",
                    reservoirHighWaterBytes=reservoir.high_water,
                    stagingHighWaterBytes=reader.staging_high_water,
                    pythonBufferUpperBoundBytes=reservoir.high_water
                    + PYTHON_STAGING_BOUND,
                    remuxInputPipeBytes=input_pipe_bytes,
                    remuxOutputPipeBytes=output_pipe_bytes,
                )
                next_report = last_output + 1
        selector.close()
        raise InputError(reader.failure or "provider_unavailable")
    finally:
        watchdog.set()
        reservoir.close()
        if mux is not None:
            if mux.poll() is None:
                mux.kill()
            mux.wait()
            mux.stdout.close()
        # Never join blocked library threads. The short-lived process exits and
        # Node reaps/kills the whole group before any retry.


def main():
    logging.disable(logging.CRITICAL)

    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise InputError("destination_denied")

    parser = Parser(add_help=False)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--video-preset", required=True, choices=PRESETS)
    try:
        args = parser.parse_args()
    except InputError:
        emit("unavailable", reason="destination_denied")
        return 2
    if not re.fullmatch(r"[a-z0-9_]{3,25}", args.channel) or args.channel in {
        "directory",
        "downloads",
        "jobs",
        "p",
        "settings",
        "subscriptions",
        "turbo",
        "videos",
    }:
        emit("unavailable", reason="destination_denied")
        return 2

    def cancel(*_):
        emit("cancelled")
        os._exit(0)

    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    try:
        run_attempt(args.channel, args.video_preset)
    except BaseException as exc:
        emit("unavailable", reason=safe_reason(exc))
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
