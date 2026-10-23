# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

RUN --mount=type=secret,id=proxy_ca,target=/run/secrets/proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then printf 'Acquire::https::CaInfo "/run/secrets/proxy_ca";\n' > /etc/apt/apt.conf.d/99build-ca; fi \
  && apt-get update \
  && apt-get install --no-install-recommends --yes awscli ca-certificates ffmpeg python-is-python3 python3-zmq \
  && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99build-ca

WORKDIR /app

# One final filesystem layer: the source bind is read-only and is not copied
# wholesale. The installer verifies locked binary wheels, installs offline,
# copies required sources, and executes the actual-image smoke before cleanup.
RUN --mount=type=bind,source=.,target=/source,readonly \
    --mount=type=secret,id=proxy_ca,target=/run/secrets/proxy_ca \
    python3 /source/workers/restream/install_twitch.py /source /app

ENV NODE_ENV=production

CMD ["node", "workers/restream/hosted-worker.mjs"]
