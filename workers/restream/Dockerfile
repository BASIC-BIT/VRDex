FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends --yes awscli ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY workers/restream/hosted-worker.mjs workers/restream/hosted-worker.mjs

ENV NODE_ENV=production

CMD ["node", "workers/restream/hosted-worker.mjs"]
