"""Isolated synthetic acquisition. No production module imports this fixture.

A fixed local directory supplies preencoded live HLS through the reviewed TLS
fixture. The real reader/reservoir/remux implementation remains unchanged.
"""
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import workers.restream
from workers.restream import twitch_input as adapter
sys.path.insert(0, str(Path(__file__).parent))
from test_twitch_transport import TLSFixture

class Files:
    def __init__(self, directory):
        self.directory = directory
    def get(self, name, default):
        if name != '/index.m3u8' and not __import__('re').fullmatch(r'/segment\d+\.ts', name):
            return (404, {}, b'')
        try:
            data = (self.directory / name[1:]).read_bytes()
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Fixture bound')
            return (200, {}, data)
        except FileNotFoundError:
            return (404, {}, b'')

if __name__ == '__main__':
    directory = Path(sys.argv[1]).resolve()
    if not str(directory).startswith('/tmp/event-capacity-') or directory.name not in ('a-hls', 'b-hls'):
        raise SystemExit(2)
    fixture = TLSFixture()
    fixture.routes = Files(directory)
    # Bound the fixture's otherwise test-sized diagnostic history.
    class Hits:
        def append(self, _):
            pass
    fixture.hits = Hits()
    def factory(_):
        return fixture.session()
    try:
        adapter.run_attempt('fixture', '1080p60', session_factory=factory,
            resolver=lambda *_: SimpleNamespace(url='https://video.ttvnw.net/index.m3u8'))
    except BaseException:
        adapter.emit('unavailable', reason='process_failed')
        os._exit(4)
