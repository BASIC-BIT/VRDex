FROM node:24-bookworm-slim

WORKDIR /app

COPY workers/vrclinking-adapter workers/vrclinking-adapter

# `npm ci`, not `npm install`: install re-resolves the caret range on every
# build, so one source revision could produce images carrying different AWS
# SDK versions — including one nobody tested. The checked-in
# package-lock.json pins it, and `ci` fails rather than silently updating it.
RUN cd workers/vrclinking-adapter && npm ci --omit=dev --no-audit --no-fund

ENV NODE_ENV=production

USER node

EXPOSE 8080

CMD ["node", "workers/vrclinking-adapter/src/server.mjs"]
