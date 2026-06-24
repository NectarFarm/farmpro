# syntax=docker/dockerfile:1
# Multi-stage build → lean Next.js standalone runtime.

FROM node:22-slim AS base
# Generous network settings so slow/flaky registries don't time out (default is 60s).
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 \
    npm_config_store_dir=/pnpm/store \
    npm_config_fetch_timeout=900000 \
    npm_config_fetch_retries=6 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=180000
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

# --- deps: all dependencies (incl. dev — needed for build + migrations/seed).
#     The cache mount persists the pnpm store across builds, so an interrupted
#     download resumes from what was already fetched instead of starting over. ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# --- builder: produce the standalone app. Also used as the migrate/seed image
#     because it carries the source + drizzle-kit + tsx. ---
FROM base AS builder
ARG NEXT_PUBLIC_USE_REAL_API=true
ENV NEXT_PUBLIC_USE_REAL_API=$NEXT_PUBLIC_USE_REAL_API
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# --- runner: minimal production image, non-root ---
FROM node:22-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
