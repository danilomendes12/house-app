# syntax=docker/dockerfile:1
#
# Next.js standalone image. Build from the monorepo root:
#
#   docker build -t financas-web .
#
# The image carries no configuration: SUPABASE_URL, SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY and OWNER_EMAIL are read at runtime (apps/web/lib/env.ts), so
# the same image runs on any VM.

FROM node:22.22.1-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- dependencies -------------------------------------------------------------
# Manifests only, so the install layer is reused while application code changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

# --- build --------------------------------------------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# The whole installed tree, then the sources on top: a workspace that gains its own
# dependencies later needs no change here (.dockerignore keeps node_modules out of the
# second COPY, so nothing is clobbered).
COPY --from=deps /repo ./
COPY . .
RUN pnpm --filter @finance/web build

# --- runtime ------------------------------------------------------------------
FROM node:22.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# `standalone` already contains the traced node_modules and the workspace packages;
# static assets and public/ are the two things Next leaves behind on purpose.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/login || exit 1

CMD ["node", "apps/web/server.js"]
