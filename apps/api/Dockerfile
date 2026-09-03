# Multi-stage build for the LoadTopia API.
# Produces a small runtime image containing the bundled server + Prisma client.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @loadtopia/db generate
RUN pnpm --filter @loadtopia/api build
# Keep only the API's production node_modules.
RUN pnpm --filter @loadtopia/api --prod deploy /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/prisma ./prisma
EXPOSE 4000
# Apply migrations then start.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma && node dist/index.js"]
