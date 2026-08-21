# vibe-web-template

A general-purpose Next.js web application template with database initialization and AI-friendly foundations.

## Features

- **Standardized Utilities**: Client-safe wrappers for `fetch` and a leveled `logger`.
- **Database Ready**: Drizzle ORM + PostgreSQL initialization pre-configured.
- **UI System**: Tailwind CSS 4, the full Radix UI primitive set (shadcn-style components under `components/ui/`), and `sonner` for notifications.
- **Offline-safe Builds**: The default system font stack does not fetch Google Fonts during builds.
- **Forms**: React Hook Form + Zod resolvers.
- **AI-Friendly**: Ships with `docs/AI_GUIDE.md` to keep AI-generated code consistent.

## Tech Stack

- Next.js 16 (App Router)
- React 19 / TypeScript 5
- Tailwind CSS 4
- Drizzle ORM + PostgreSQL (`postgres` driver)
- Zod + React Hook Form
- Zustand (state management)
- Vercel Analytics + optional Umami script injection

## Getting Started

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Environment variables**:
   Copy `.env.example` to `.env` and configure at minimum `DATABASE_URL`. Umami analytics variables (`NEXT_PUBLIC_UMAMI_SCRIPT_URL`, `NEXT_PUBLIC_UMAMI_WEBSITE_ID`) are optional and only injected in production.

3. **Run development server** (port 13000):
   ```bash
   pnpm dev
   ```

4. **Verify changes**:
   ```bash
   pnpm test
   pnpm typecheck
   pnpm build
   ```

5. **Database commands**:
   - `pnpm db:generate` — generate migrations
   - `pnpm db:migrate` — run migrations
   - `pnpm db:studio` — open Drizzle Studio

## Running with Docker

The whole local stack (Postgres + app) is described by `docker-compose.yml`, so
starting and stopping is two commands rather than a hand-rolled `docker build`
and `docker run --env-file` per change:

```bash
make up      # start Postgres + the app  -> http://localhost:13001
make down    # stop everything, keep the database
```

`make` on its own lists every target. The useful ones:

| Command | What it does |
| --- | --- |
| `make up` | Postgres + the production-shaped app image |
| `make dev` | Postgres + hot-reloading dev server; source is bind-mounted, so a `git pull` applies live with **no rebuild** |
| `make down` | Stop and remove containers, keep the `ifms-pgdata` volume |
| `make logs` | Follow logs |
| `make migrate` / `make seed` | Drizzle migrations / demo data |
| `make psql` | psql shell on the dev database |
| `make reset-db` | Destructive: drop the volume, migrate and re-seed |
| `make rebuild` | Force a no-cache image rebuild (rarely needed) |

Compose reuses one named container per service, so repeated starts replace the
previous container instead of leaving another one behind.

### Why rebuilds are fast now

The Dockerfile installs dependencies in a `deps` stage that copies only
`package.json` and the lockfile. Application code arrives in a later stage, so a
`git pull` that touches only source reuses the cached install instead of
re-resolving the dependency tree: a cold build is ~210s, a code-change rebuild
~24s. pnpm's store is kept across builds on a BuildKit cache mount, so even a
lockfile change re-fetches only what actually changed.

The runner stage serves Next's `output: 'standalone'` bundle, which traces the
exact server dependencies it needs. That removed the second
`pnpm install --prod` the old runner did and took the image from ~1.01GB to
~384MB.

## Project Structure

- `app/` — Next.js App Router (`layout.tsx`, `page.tsx`, `api/`).
- `components/` — `AgentationGuard.tsx` plus shadcn-style primitives in `components/ui/`.
- `db/` — Drizzle client (`db/index.ts`).
- `lib/` — Core utilities: `api-response.ts`, `api-error-response.ts`, `request.ts`, `logger.ts`, `errors.ts`, `utils.ts`, `agentationFeedbackMode.ts`.
- `hooks/` — Shared hooks (`use-mobile.ts`, `use-toast.ts`).
- `utils/` — `cn.ts` (clsx + tailwind-merge).
- `docs/` — `AI_GUIDE.md` (AI/developer conventions).
- `Dockerfile` — Multi-stage node:22-slim build (deps / builder / runner) exposing port 13001.
- `docker-compose.yml`, `Makefile` — Local stack and its shortcuts (see "Running with Docker").
