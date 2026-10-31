FROM node:24-bookworm-slim AS build

RUN corepack enable

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts --filter @vrdex/discord-gateway...

# No --prod: tsx is a devDependency the runtime needs.
RUN pnpm --filter @vrdex/discord-gateway deploy --legacy /out

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /out .

ENV NODE_ENV=production

USER node

CMD ["node", "--import", "tsx", "src/index.ts"]
