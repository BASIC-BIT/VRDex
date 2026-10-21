# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

RUN --mount=type=secret,id=proxy_ca,target=/run/secrets/proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then printf 'Acquire::https::CaInfo "/run/secrets/proxy_ca";\n' > /etc/apt/apt.conf.d/99build-ca; fi \
  && apt-get update \
  && apt-get install --no-install-recommends --yes awscli ca-certificates ffmpeg python-is-python3 python3-zmq \
  && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99build-ca

WORKDIR /app

COPY workers/restream/hosted-worker.mjs workers/restream/hosted-worker.mjs
COPY workers/restream/live-control.mjs workers/restream/live-control.mjs
COPY workers/restream/vrcdn-poc.mjs workers/restream/vrcdn-poc.mjs

COPY workers/restream/output-sender.mjs workers/restream/output-sender.mjs
COPY workers/restream/event-worker.mjs workers/restream/event-worker.mjs
COPY workers/restream/source-relay.mjs workers/restream/source-relay.mjs
COPY workers/restream/handoff-policy.mjs workers/restream/handoff-policy.mjs
COPY workers/restream/input-supervisor.mjs workers/restream/input-supervisor.mjs
COPY workers/restream/program-renderer.mjs workers/restream/program-renderer.mjs

COPY scripts/event-output-local-proof.mjs scripts/event-output-local-proof.mjs
COPY scripts/event-proof-metrics.mjs scripts/event-proof-metrics.mjs
COPY scripts/event-vrcdn-rehearsal.mjs scripts/event-vrcdn-rehearsal.mjs
COPY scripts/event-proof-runner.mjs scripts/event-proof-runner.mjs

ENV NODE_ENV=production

CMD ["node", "workers/restream/hosted-worker.mjs"]
