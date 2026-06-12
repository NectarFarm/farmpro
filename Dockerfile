# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# ── Stage 2: install all deps (including dev, needed for drizzle-kit + tsx) ───
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 3: build app + generate DB migration files from schema ───────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Dummy values so lib/env.ts validation passes during next build.
# These are NOT used at runtime — the real values come from docker-compose.
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV SESSION_SECRET=00000000000000000000000000000000

# Generate Drizzle migration SQL from db/schema.ts (no DB needed)
RUN pnpm db:generate

# Build the Next.js app
RUN pnpm build

# ── Stage 4: production app ───────────────────────────────────────────────────
FROM base AS app
WORKDIR /app
ENV NODE_ENV=production

# Full node_modules (dev deps kept so drizzle-kit and tsx work for migrations)
COPY --from=deps /app/node_modules ./node_modules

# Built app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Config + source needed at runtime / for migration commands
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts ./scripts
COPY package.json pnpm-lock.yaml drizzle.config.ts next.config.ts ./

EXPOSE 13000

CMD ["pnpm", "start"]
