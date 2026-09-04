#!/bin/bash
# Loopback-only CONNECT proxy for the collector login tunnel. Reached through
# SSM port forwarding; every tunnel it opens leaves through the collector's NAT
# gateway. Installed as a systemd unit because user data runs on first boot
# only, and this host is stopped and started between recoveries.
cat > /opt/connect-proxy.py <<'PY'
import socket
import threading


def pipe(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for sock, how in ((src, socket.SHUT_RD), (dst, socket.SHUT_WR)):
            try:
                sock.shutdown(how)
            except OSError:
                pass


def handle(client):
    upstream = None
    try:
        request = b""
        while b"\r\n\r\n" not in request:
            chunk = client.recv(4096)
            if not chunk:
                return
            request += chunk
        method, target, _ = request.split(b"\r\n")[0].decode().split()
        if method != "CONNECT":
            client.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
            return
        host, port = target.rsplit(":", 1)
        upstream = socket.create_connection((host, int(port)), timeout=20)
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        pipe(upstream, client)
    except Exception:
        try:
            client.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        except OSError:
            pass
    finally:
        client.close()
        if upstream is not None:
            upstream.close()


server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", 8888))
server.listen(16)
while True:
    conn, _ = server.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
PY
cat > /etc/systemd/system/connect-proxy.service <<'UNIT'
[Unit]
Description=Loopback CONNECT proxy for the collector login tunnel
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /opt/connect-proxy.py
Restart=always
RestartSec=2
DynamicUser=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now connect-proxy.service
