# syntax=docker/dockerfile:1
# Web service image. Build context is the repository root:
#   docker build -f apps/web/Dockerfile -t findyourdent-web .
#   docker run --rm -p 8080:8080 -e AGENT_URL=http://host.docker.internal:8000 findyourdent-web

FROM node:24-slim AS base
RUN npm install -g pnpm@12.14.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/

FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter "web..." --store-dir /pnpm-store
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter web build

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter "web..." --store-dir /pnpm-store

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /repo/apps/web
COPY --from=prod-deps /repo/node_modules /repo/node_modules
COPY --from=prod-deps /repo/apps/web/node_modules ./node_modules
COPY --from=build /repo/apps/web/build ./build
COPY apps/web/package.json apps/web/server.ts apps/web/refresh-coordinates.ts apps/web/recompute-aggregates.ts \
     apps/web/expire-proofs.ts ./
COPY apps/web/server ./server
# server/ runs unbundled, so what it imports at runtime must be here too: the plain
# modules it shares with the app (and the aggregates math the recompute job reuses),
# and the contracts package its pnpm symlink (node_modules/@findyourdent/contracts) points at.
COPY apps/web/app/lib ./app/lib
COPY apps/web/app/server/aggregates.ts ./app/server/aggregates.ts
COPY packages/contracts /repo/packages/contracts
USER node
EXPOSE 8080
# Node 24 runs server.ts directly (type stripping); the React Router build bundles its own copy of contracts.
CMD ["node", "server.ts"]
