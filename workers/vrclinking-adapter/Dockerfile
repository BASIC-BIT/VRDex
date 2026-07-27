FROM node:24-bookworm-slim

WORKDIR /app

COPY workers/vrclinking-adapter workers/vrclinking-adapter

RUN cd workers/vrclinking-adapter && npm install --omit=dev --no-audit --no-fund

ENV NODE_ENV=production

USER node

EXPOSE 8080

CMD ["node", "workers/vrclinking-adapter/src/server.mjs"]
