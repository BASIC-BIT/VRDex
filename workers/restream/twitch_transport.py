"""Anonymous Twitch HTTPS boundary for the exact packaged dependency versions.

The only internal seams are for verified local TLS fixtures. No CLI/config can
change host policy, resolver, dialer or trust. Signed URLs never leave memory.
"""

import contextvars
import importlib.metadata
import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

from requests.adapters import BaseAdapter
from streamlink.session.http import SSLContextAdapter
from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool

PINNED = {"streamlink": "8.6.2", "requests": "2.34.2", "urllib3": "2.8.0"}
HTTP_SECONDS = 5
DNS_SECONDS = 2
RESPONSE_LIMIT = 256 * 1024
CHUNK = 16 * 1024
PROXY_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)
FORBIDDEN_HEADERS = frozenset(
    ("authorization", "cookie", "proxy-authorization", "host", "client-integrity")
)
REASONS = frozenset(
    (
        "destination_denied",
        "dns_denied",
        "dns_timeout",
        "proxy_denied",
        "credentials_denied",
        "tls_denied",
        "http_timeout",
        "response_limit",
        "dependency_mismatch",
        "unsupported_media",
        "provider_unavailable",
        "media_timeout",
        "preparation_timeout",
        "cancelled",
        "process_failed",
    )
)
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


# IANA special-purpose blocks which some Python versions classify as global:
# protocol assignments, AS112, AMT, and deprecated 6to4 relay anycast. Exclude
# these explicitly so host 3.12 and image 3.11 enforce the same boundary.
_SPECIAL_V4 = tuple(
    ipaddress.IPv4Network(value)
    for value in (
        "192.0.0.0/24",
        "192.31.196.0/24",
        "192.52.193.0/24",
        "192.88.99.0/24",
        "192.175.48.0/24",
    )
)


class BoundaryError(OSError):
    """Only fixed reason codes, never URLs or underlying exception strings."""

    def __init__(self, reason):
        self.reason = reason if reason in REASONS else "provider_unavailable"
        super().__init__(self.reason)


def validate_url(url):
    try:
        u = urlsplit(url)
        host = u.hostname or ""
        labels = host.split(".")
        if (
            u.scheme != "https"
            or u.username is not None
            or u.password is not None
            or "#" in url
            or u.netloc.endswith(":")
            or u.port not in (None, 443)
            or len(host) > 253
            or not all(_LABEL.fullmatch(label) for label in labels)
            or not (
                host == "gql.twitch.tv"
                or (len(labels) > 2 and host.endswith(".ttvnw.net"))
            )
        ):
            raise BoundaryError("destination_denied")
        return host
    except (ValueError, TypeError):
        raise BoundaryError("destination_denied") from None


def validate_answers(answers):
    if not isinstance(answers, list) or not 1 <= len(answers) <= 32:
        raise BoundaryError("dns_denied")
    for value in answers:
        try:
            ip = ipaddress.IPv4Address(value)
            if (
                not ip.is_global
                or ip.is_multicast
                or ip.is_reserved
                or any(ip in network for network in _SPECIAL_V4)
            ):
                raise ValueError()
        except (ValueError, TypeError):
            raise BoundaryError("dns_denied") from None
    return answers[0]


_RESOLVER_CODE = """import json,socket,sys
answers=socket.getaddrinfo(sys.argv[1],443,socket.AF_INET,socket.SOCK_STREAM,socket.IPPROTO_TCP)
print(json.dumps([a[4][0] for a in answers] if len(answers)<=32 else []))
"""


def resolve_ipv4(host):
    # A subprocess is killable; timed-out executor threads would accumulate.
    child = subprocess.Popen(
        [sys.executable, "-I", "-c", _RESOLVER_CODE, host],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        data, _ = child.communicate(timeout=DNS_SECONDS)
        if child.returncode or len(data) > 2048:
            raise BoundaryError("dns_denied")
        return json.loads(data)
    except subprocess.TimeoutExpired:
        raise BoundaryError("dns_timeout") from None
    except (ValueError, UnicodeError):
        raise BoundaryError("dns_denied") from None
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()
        child.stdout.close()


def _dial_ipv4(address, port, timeout):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
    try:
        sock.settimeout(timeout)
        sock.connect((address, port))  # Numeric AF_INET tuple: no second DNS lookup.
        return sock
    except BaseException:
        sock.close()
        raise


class _Deadline:
    def __init__(self):
        self.until = time.monotonic() + HTTP_SECONDS
        self.connection = None
        self.socket = None
        self.expired = False
        self.timer = threading.Timer(HTTP_SECONDS, self.abort)
        self.timer.daemon = True
        self.timer.start()

    def remaining(self):
        remaining = self.until - time.monotonic()
        if self.expired or remaining <= 0:
            raise BoundaryError("http_timeout")
        return remaining

    def abort(self):
        self.expired = True
        for sock in (getattr(self.connection, "sock", None), self.socket):
            if sock is not None:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                try:
                    sock.close()
                except OSError:
                    pass

    def close(self):
        self.timer.cancel()


_ACTIVE = contextvars.ContextVar("twitch_http_deadline")


class _BoundedBody:
    def __init__(self, raw, deadline, limit):
        self.raw, self.deadline, self.limit, self.count = raw, deadline, limit, 0

    def __getattr__(self, name):
        return getattr(self.raw, name)

    def stream(self, amt=CHUNK, decode_content=False):
        try:
            while True:
                self.deadline.remaining()
                data = self.raw.read(min(amt or CHUNK, CHUNK), decode_content=False)
                self.deadline.remaining()
                if not data:
                    break
                self.count += len(data)
                if self.limit is not None and self.count > self.limit:
                    raise BoundaryError("response_limit")
                yield data
        finally:
            self.close()

    def read(self, amt=None, decode_content=False, **_):
        # Requests content uses stream(); no unbounded caller can bypass the cap.
        if amt is None:
            return b"".join(self.stream())
        self.deadline.remaining()
        data = self.raw.read(min(amt, CHUNK), decode_content=False)
        self.count += len(data)
        if self.limit is not None and self.count > self.limit:
            self.close()
            raise BoundaryError("response_limit")
        self.deadline.remaining()
        if not data:
            self.close()
        return data

    def close(self):
        self.deadline.close()
        self.raw.close()
        self.raw.release_conn()


class _DenyAdapter(BaseAdapter):
    def send(self, *args, **kwargs):
        raise BoundaryError("destination_denied")

    def close(self):
        pass


def install_fetch_boundary(
    session, on_connect=None, *, _resolve=None, _dial=None, _context=None
):
    """Install on a fresh Streamlink session before constructing its plugin."""
    if any(importlib.metadata.version(k) != v for k, v in PINNED.items()):
        raise BoundaryError("dependency_mismatch")
    http = session.http
    if any(os.environ.get(k) for k in PROXY_VARS) or any(http.proxies.values()):
        raise BoundaryError("proxy_denied")
    if http.auth or http.cookies or http.cert or http.verify is not True:
        raise BoundaryError("credentials_denied")
    if any(k.lower() in FORBIDDEN_HEADERS for k in http.headers):
        raise BoundaryError("credentials_denied")
    resolve, dial = _resolve or resolve_ipv4, _dial or _dial_ipv4

    class PinnedConnection(HTTPSConnection):
        def request(self, *args, **kwargs):
            deadline = _ACTIVE.get()
            deadline.connection = self
            if self.sock is not None:
                self.sock.settimeout(deadline.remaining())
            return super().request(*args, **kwargs)

        def _new_conn(self):
            if self.proxy or self._tunnel_host:
                raise BoundaryError("proxy_denied")
            if (
                self.cert_reqs not in ("CERT_REQUIRED", ssl.CERT_REQUIRED)
                or self.assert_hostname not in (None, self.host)
                or self.server_hostname not in (None, self.host)
                or self.assert_fingerprint is not None
                or self.cert_file
                or self.key_file
            ):
                raise BoundaryError("tls_denied")
            validate_url("https://" + self.host + ":" + str(self.port) + "/")
            deadline = _ACTIVE.get()
            deadline.connection = self
            address = validate_answers(resolve(self.host))
            sock = dial(address, self.port, deadline.remaining())
            deadline.socket = sock
            if on_connect:
                on_connect(self.host, address)
            return sock

    class PinnedPool(HTTPSConnectionPool):
        ConnectionCls = PinnedConnection

    class PinnedAdapter(SSLContextAdapter):
        def get_ssl_context(self):
            ctx = _context or super().get_ssl_context()
            if not ctx.check_hostname or ctx.verify_mode != ssl.CERT_REQUIRED:
                raise BoundaryError("tls_denied")
            return ctx

        def init_poolmanager(self, *args, **kwargs):
            super().init_poolmanager(*args, **kwargs)
            self.poolmanager.pool_classes_by_scheme = dict(
                self.poolmanager.pool_classes_by_scheme
            )
            self.poolmanager.pool_classes_by_scheme["https"] = PinnedPool

        def proxy_manager_for(self, *args, **kwargs):
            raise BoundaryError("proxy_denied")

        def send(
            self,
            request,
            stream=False,
            timeout=None,
            verify=True,
            cert=None,
            proxies=None,
        ):
            validate_url(request.url)
            if verify is not True or cert is not None:
                raise BoundaryError("tls_denied")
            if proxies and any(proxies.values()):
                raise BoundaryError("proxy_denied")
            if any(k.lower() in FORBIDDEN_HEADERS for k in request.headers):
                raise BoundaryError("credentials_denied")
            request.headers["Accept-Encoding"] = "identity"
            ctx = self.poolmanager.connection_pool_kw["ssl_context"]
            if not ctx.check_hostname or ctx.verify_mode != ssl.CERT_REQUIRED:
                raise BoundaryError("tls_denied")
            deadline = _Deadline()
            token = _ACTIVE.set(deadline)
            try:
                response = super().send(
                    request,
                    stream=True,
                    timeout=(deadline.remaining(), HTTP_SECONDS),
                    verify=True,
                    cert=None,
                    proxies={},
                )
                deadline.remaining()
                if "Set-Cookie" in response.headers:
                    raise BoundaryError("credentials_denied")
                if (
                    response.headers.get("Content-Encoding", "identity").lower()
                    != "identity"
                ):
                    raise BoundaryError("response_limit")
                response.raw = _BoundedBody(
                    response.raw, deadline, None if stream else RESPONSE_LIMIT
                )
                return response
            except BaseException:
                deadline.abort()
                deadline.close()
                raise
            finally:
                _ACTIVE.reset(token)

    old = set(http.adapters.values())
    http.adapters.clear()
    http.mount("", _DenyAdapter())
    http.mount(
        "https://",
        PinnedAdapter(
            pool_connections=4, pool_maxsize=1, pool_block=False, max_retries=0
        ),
    )
    for adapter in old:
        adapter.close()
    http.trust_env = False  # Only after refusing configured proxies; excludes netrc.
    http.max_redirects = 3
    http.timeout = HTTP_SECONDS
    session.set_option("webbrowser", False)
    session.set_option("no-plugin-cache", True)
    return PINNED.copy()


def safe_reason(error):
    for _ in range(8):
        if error is None:
            break
        if isinstance(error, BoundaryError):
            return error.reason
        error = error.__cause__ or error.__context__
    return "provider_unavailable"
