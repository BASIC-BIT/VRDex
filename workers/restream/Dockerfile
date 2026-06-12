FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends --yes awscli ca-certificates ffmpeg python-is-python3 python3-zmq \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY workers/restream/hosted-worker.mjs workers/restream/hosted-worker.mjs
COPY workers/restream/live-control.mjs workers/restream/live-control.mjs
COPY workers/restream/vrcdn-poc.mjs workers/restream/vrcdn-poc.mjs

ENV NODE_ENV=production

CMD ["node", "workers/restream/hosted-worker.mjs"]
