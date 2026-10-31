FROM node:24-bookworm-slim AS build

RUN corepack enable

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile --ignore-scripts --filter @vrdex/discord-gateway...

# No --prod: tsx is a devDependency the runtime needs.
# ponytail: deploy --legacy also carries the root package's deps, none loaded at runtime, about 225 MB; drop when pnpm can deploy a filtered package from the shared lockfile without them.
RUN pnpm --filter @vrdex/discord-gateway deploy --legacy --ignore-scripts /out

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /out .

ENV NODE_ENV=production

USER node

CMD ["node", "--import", "tsx", "src/index.ts"]
