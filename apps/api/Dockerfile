# Multi-stage build for the LoadTopia API.
#
# Targets:
#   runtime  (default) — minimal API server image.   CMD: node dist/index.js
#   migrate            — Prisma CLI + schema.         CMD: prisma migrate deploy
#
# Migrations are a SEPARATE deploy step (run the `migrate` image as a job before
# rolling out `runtime`) — the server never migrates at startup.
#
# Build from the repo root:
#   docker build -f apps/api/Dockerfile --target runtime -t loadtopia-api .
#   docker build -f apps/api/Dockerfile --target migrate -t loadtopia-migrate .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Prisma needs openssl + CA certs present to pick the right engine at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Pin pnpm into the image so no stage (incl. the migrate job) fetches it at runtime.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# ---- install (all workspaces, incl. dev deps for build + tests) -----------
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @loadtopia/db generate
RUN pnpm --filter @loadtopia/api build
# Pruned production deployment of just the API -> /prod, then (re)generate the
# Prisma client *inside* that tree so the engine ships with the image.
RUN pnpm --filter=@loadtopia/api deploy --prod /prod \
 && cp -r /repo/packages/db/prisma /prod/prisma \
 && cd /prod \
 && node "$(find /repo/node_modules/.pnpm -name index.js -path '*prisma*/build/index.js' | head -1)" \
      generate --schema=/prod/prisma/schema.prisma

# ---- migrate image --------------------------------------------------------
FROM base AS migrate
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json /repo/pnpm-lock.yaml /repo/.npmrc ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/db ./packages/db
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"]

# ---- runtime image --------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /prod/dist ./dist
COPY --from=build /prod/prisma ./prisma
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
