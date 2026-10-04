# Multi-stage build for the LoadTopia web app (Next.js 15, App Router).
# Added for self-hosting (audit gap G-1). Mirrors apps/api/Dockerfile conventions.
#
# Build from the repo root:
#   docker build -f apps/web/Dockerfile -t loadtopia-web .
#
# Runtime contract:
#   - listens on :3000 (PORT/HOSTNAME set below)
#   - requires API_ORIGIN=https://<api-origin> at RUN time (never baked in — see
#     src/lib/api-origin.mjs; production refuses non-https and refuses localhost)
#   - holds no state

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

# ---- build ------------------------------------------------------------------
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# Only the web workspace and its workspace deps (@loadtopia/shared).
RUN pnpm install --frozen-lockfile --filter @loadtopia/web...
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.mjs sets output:"standalone" + outputFileTracingRoot (monorepo),
# so .next/standalone is a self-contained tree rooted at the repo root.
RUN pnpm --filter @loadtopia/web build

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
