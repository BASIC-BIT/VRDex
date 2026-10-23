"""Real verified TLS contracts; fixture routing is never a production option."""

import os
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from requests import Request
from streamlink import Streamlink
from urllib3.poolmanager import pool_classes_by_scheme
from workers.restream import twitch_transport as transport


class TLSFixture:
    def __init__(self, san="video.ttvnw.net"):
        self.tmp = tempfile.TemporaryDirectory()
        base = self.tmp.name

        def openssl(*args):
            subprocess.run(
                ["openssl", *args],
                cwd=base,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        openssl(
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "ca.key",
            "-out",
            "ca.pem",
            "-days",
            "1",
            "-subj",
            "/CN=Fixture CA",
        )
        openssl(
            "req",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            "leaf.key",
            "-out",
            "leaf.csr",
            "-subj",
            "/CN=" + san,
        )
        with open(base + "/ext", "w") as f:
            f.write("subjectAltName=DNS:" + san + "\nextendedKeyUsage=serverAuth\n")
        openssl(
            "x509",
            "-req",
            "-in",
            "leaf.csr",
            "-CA",
            "ca.pem",
            "-CAkey",
            "ca.key",
            "-CAcreateserial",
            "-out",
            "leaf.pem",
            "-days",
            "1",
            "-extfile",
            "ext",
        )
        self.routes = {}
        self.hits = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                owner.hits.append(self.path)
                status, headers, body = owner.routes.get(self.path, (200, {}, b"ok"))
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                    pass

            def log_message(self, *_):
                pass

        class Server(ThreadingHTTPServer):
            def handle_error(self, request, address):
                import sys

                if isinstance(
                    sys.exception(),
                    (ssl.SSLError, ConnectionResetError, BrokenPipeError),
                ):
                    return
                super().handle_error(request, address)

        self.server = Server(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(base + "/leaf.pem", base + "/leaf.key")
        self.server.socket = ctx.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.context = ssl.create_default_context(cafile=base + "/ca.pem")
        self.lookups = 0
        self.answers = ["8.8.8.8"]
        self.dials = []

    def resolve(self, host):
        self.lookups += 1
        return self.answers

    def dial(self, address, port, timeout):
        self.dials.append((address, port))
        return socket.create_connection(("127.0.0.1", self.server.server_port), timeout)

    def session(self):
        s = Streamlink()
        with patch.dict(os.environ, {}, clear=True):
            transport.install_fetch_boundary(
                s, _resolve=self.resolve, _dial=self.dial, _context=self.context
            )
        return s

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()


class PolicyTests(unittest.TestCase):
    def test_url_boundary(self):
        for url in [
            "https://gql.twitch.tv/gql",
            "https://usher.ttvnw.net/a",
            "https://a.b.ttvnw.net/x",
        ]:
            transport.validate_url(url)
        for url in [
            "http://video.ttvnw.net/a",
            "file:///etc/passwd",
            "https://ttvnw.net/a",
            "https://ttvnw.net.evil.test/a",
            "https://evilttvnw.net/a",
            "https://bad..ttvnw.net/a",
            "https://a_.ttvnw.net/a",
            "https://user@video.ttvnw.net/a",
            "https://video.ttvnw.net:444/a",
            "https://video.ttvnw.net:bad/a",
            "https://video.ttvnw.net/a#x",
            "https://127.0.0.1/a",
        ]:
            with self.subTest(url=url), self.assertRaises(transport.BoundaryError):
                transport.validate_url(url)

    def test_all_dns_answers_and_special_ranges(self):
        for answers in [
            [],
            ["8.8.8.8", "127.0.0.1"],
            ["10.0.0.1"],
            ["169.254.169.254"],
            ["100.64.0.1"],
            ["192.0.0.9"],
            ["198.18.0.1"],
            ["224.0.0.1"],
            ["::1"],
            ["8.8.8.8"] * 33,
        ]:
            with (
                self.subTest(answers=answers),
                self.assertRaises(transport.BoundaryError),
            ):
                transport.validate_answers(answers)
        self.assertEqual(transport.validate_answers(["8.8.8.8", "1.1.1.1"]), "8.8.8.8")

    def test_globally_classified_special_and_mixed_answers_are_denied(self):
        for address in (
            "192.88.99.0",
            "192.88.99.1",
            "192.88.99.2",
            "192.88.99.255",
            "192.31.196.1",
            "192.52.193.1",
            "192.175.48.1",
        ):
            for answers in ([address], ["8.8.8.8", address]):
                with (
                    self.subTest(answers=answers),
                    self.assertRaises(transport.BoundaryError),
                ):
                    transport.validate_answers(answers)

    def test_proxy_refusal_preserves_environment(self):
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://managed.invalid:80"}):
            with self.assertRaises(transport.BoundaryError):
                transport.install_fetch_boundary(Streamlink())
            self.assertEqual(os.environ["HTTPS_PROXY"], "http://managed.invalid:80")

    def test_dns_subprocess_deadline(self):
        started = time.monotonic()
        with patch.object(transport, "_RESOLVER_CODE", "import time; time.sleep(60)"):
            with self.assertRaises(transport.BoundaryError):
                transport.resolve_ipv4("video.ttvnw.net")
        self.assertLess(time.monotonic() - started, 2.5)


class TLSContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = TLSFixture()

    def tearDown(self):
        self.fixture.close()

    def test_verified_tls_reuse_and_rebinding(self):
        before = dict(pool_classes_by_scheme)
        s = self.fixture.session()
        try:
            self.assertEqual(s.http.get("https://video.ttvnw.net/").content, b"ok")
            self.assertEqual(s.http.get("https://video.ttvnw.net/").content, b"ok")
            self.assertEqual(self.fixture.lookups, 1)
            self.assertEqual(self.fixture.dials, [("8.8.8.8", 443)])
            s.http.adapters["https://"].close()
            self.fixture.answers = ["8.8.8.8", "10.1.1.1"]
            with self.assertRaises(Exception):
                s.http.get("https://video.ttvnw.net/")
            self.assertEqual(len(self.fixture.dials), 1)
            self.assertEqual(pool_classes_by_scheme, before)
        finally:
            s.http.close()

    def test_wrong_san_and_untrusted_certificate(self):
        s = self.fixture.session()
        try:
            with self.assertRaises(Exception):
                s.http.get("https://different.ttvnw.net/")
        finally:
            s.http.close()
        self.fixture.context = ssl.create_default_context()
        s = self.fixture.session()
        try:
            with self.assertRaises(Exception):
                s.http.get("https://video.ttvnw.net/")
        finally:
            s.http.close()

    def test_forbidden_request_options_and_file_adapter(self):
        s = self.fixture.session()
        try:
            for kw in [
                {"headers": {h: "x"}}
                for h in ["Host", "Authorization", "Cookie", "Proxy-Authorization"]
            ] + [
                {"verify": False},
                {"verify": "/tmp/ca"},
                {"cert": "/tmp/client"},
                {"proxies": {"https": "http://proxy"}},
            ]:
                with self.subTest(kw=kw), self.assertRaises(Exception):
                    s.http.get("https://video.ttvnw.net/", **kw)
            for url in [
                "file:///etc/passwd",
                "http://video.ttvnw.net/",
                "ftp://video.ttvnw.net/a",
            ]:
                with self.subTest(url=url), self.assertRaises(Exception):
                    s.http.get(url)
            self.assertEqual(self.fixture.hits, [])
        finally:
            s.http.close()

    def test_redirect_each_hop_and_bounded_response(self):
        self.fixture.routes["/ok"] = (302, {"Location": "/end"}, b"")
        self.fixture.routes["/bad"] = (
            302,
            {"Location": "https://evil.test/secret"},
            b"",
        )
        self.fixture.routes["/file"] = (302, {"Location": "file:///etc/passwd"}, b"")
        self.fixture.routes["/large"] = (200, {}, b"x" * (transport.RESPONSE_LIMIT + 1))
        s = self.fixture.session()
        try:
            self.assertEqual(s.http.get("https://video.ttvnw.net/ok").content, b"ok")
            for path in ["/bad", "/file", "/large"]:
                with self.subTest(path=path), self.assertRaises(Exception):
                    s.http.get("https://video.ttvnw.net" + path)
        finally:
            s.http.close()


class DeadlineContracts(unittest.TestCase):
    def test_streamed_trickle_body_has_total_five_second_deadline(self):
        fixture = TLSFixture()
        original = fixture.server.RequestHandlerClass.do_GET

        def slow(handler):
            if handler.path != "/slow":
                return original(handler)
            handler.send_response(200)
            handler.send_header("Content-Length", "100")
            handler.end_headers()
            for _ in range(100):
                try:
                    handler.wfile.write(b"x")
                    handler.wfile.flush()
                except OSError:
                    return
                time.sleep(0.2)

        fixture.server.RequestHandlerClass.do_GET = slow
        session = fixture.session()
        started = time.monotonic()
        try:
            with self.assertRaises(Exception):
                session.http.get("https://video.ttvnw.net/slow").content
            self.assertLess(time.monotonic() - started, 5.8)
        finally:
            session.http.close()
            fixture.close()

    def test_tls_handshake_wait_is_bounded(self):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        accepted = []

        def accept():
            sock, _ = listener.accept()
            accepted.append(sock)
            time.sleep(7)
            sock.close()

        threading.Thread(target=accept, daemon=True).start()
        session = Streamlink()

        def dial(address, port, timeout):
            return socket.create_connection(listener.getsockname(), timeout)

        with patch.dict(os.environ, {}, clear=True):
            transport.install_fetch_boundary(
                session, _resolve=lambda _: ["8.8.8.8"], _dial=dial
            )
        started = time.monotonic()
        try:
            with self.assertRaises(Exception):
                session.http.get("https://video.ttvnw.net/")
            self.assertLess(time.monotonic() - started, 5.8)
        finally:
            session.http.close()
            listener.close()
            for sock in accepted:
                sock.close()


class OverrideContracts(unittest.TestCase):
    def test_matching_host_header_and_pool_tls_overrides_are_rejected(self):
        fixture = TLSFixture()
        try:
            for override in (
                {"headers": {"Host": "video.ttvnw.net"}},
                {"auth": ("user", "secret")},
                {"cookies": {"session": "secret"}},
            ):
                session = fixture.session()
                try:
                    with self.assertRaises(Exception):
                        session.http.get("https://video.ttvnw.net/", **override)
                finally:
                    session.http.close()
            for key, value in [
                ("assert_hostname", False),
                ("assert_fingerprint", "00"),
            ]:
                session = fixture.session()
                session.http.adapters["https://"].poolmanager.connection_pool_kw[
                    key
                ] = value
                try:
                    with self.assertRaises(Exception):
                        session.http.get("https://video.ttvnw.net/")
                finally:
                    session.http.close()
            self.assertEqual(fixture.dials, [])
        finally:
            fixture.close()

    def test_preloaded_credentials_and_insecure_context_are_refused(self):
        with patch.dict(os.environ, {}, clear=True):
            for kind in ("cookies", "auth", "cert", "verify"):
                session = Streamlink()
                if kind == "cookies":
                    session.http.cookies.set("session", "secret")
                elif kind == "auth":
                    session.http.auth = ("user", "secret")
                elif kind == "cert":
                    session.http.cert = "/tmp/client"
                else:
                    session.http.verify = False
                with (
                    self.subTest(kind=kind),
                    self.assertRaises(transport.BoundaryError),
                ):
                    transport.install_fetch_boundary(session)
            session = Streamlink()
            with self.assertRaises(transport.BoundaryError):
                transport.install_fetch_boundary(
                    session, _context=ssl._create_unverified_context()
                )
