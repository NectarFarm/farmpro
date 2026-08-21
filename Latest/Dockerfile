# syntax=docker/dockerfile:1.7

# ── deps ──────────────────────────────────────────────────────────────
# Only the manifests are copied in here, so this layer (and the install it
# runs) is reused by every later build in which the lockfile has not
# changed. The old Dockerfile did `COPY . .` *before* installing, which
# meant editing a single component invalidated the dependency layer and a
# plain `git pull` re-resolved and re-downloaded the entire tree. That was
# the reason rebuilds took forever.
FROM node:22-slim AS deps
WORKDIR /app
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The cache mount keeps pnpm's content-addressable store on the host
# between builds, so even a lockfile change re-fetches only what actually
# changed rather than the whole registry.
RUN --mount=type=cache,id=ifms-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build && (test -d public || mkdir public)

# ── runner ────────────────────────────────────────────────────────────
# next.config.ts sets output:'standalone', so the build traces exactly the
# server dependencies it needs into .next/standalone. That replaces the
# second `pnpm install --frozen-lockfile --prod` the old runner did, which
# re-resolved the whole dependency tree into the final image: 1.01GB
# before, 384MB now.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=13001 HOSTNAME=0.0.0.0
RUN useradd --create-home --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
USER nextjs
EXPOSE 13001
# No secrets baked into the image — DATABASE_URL / AUTH_PIN_PEPPER etc. are
# supplied at run time from .env by compose, not copied in at build time.
CMD ["node", "server.js"]
