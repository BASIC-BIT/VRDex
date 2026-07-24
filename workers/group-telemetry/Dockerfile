FROM node:24-bookworm-slim

WORKDIR /app

COPY workers/group-telemetry workers/group-telemetry

ENV NODE_ENV=production

USER node

CMD ["node", "workers/group-telemetry/worker.mjs"]
