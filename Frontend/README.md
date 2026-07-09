# IFMS — Integrated Farm Management System

Mobile-first, offline-capable management for diversified farms (poultry, pigs, fish, crops, and more). Workers record daily activity in the field; owners see costs, yields, alerts, payroll, and profit per batch.

> **Architecture:** this repo is a **Next.js full-stack monolith** (App Router + Route Handlers + Drizzle + PostgreSQL).  
> See [`docs/ARCHITECTURE_ACTUAL.md`](docs/ARCHITECTURE_ACTUAL.md) for the live design. Older Django/Celery docs under `attachements/` are historical targets only.

## Features

- **Roles:** owner, manager, worker, vet, auditor, super-admin
- **Field ops (offline-first worker PWA):** morning rounds, feeding, mortality (+ photo/GPS), health, collection, physical counts, weight sampling
- **Inventory:** lots, FIFO feed consume, purchases, feed mix, closing stock / variance
- **Commercial:** sales with stock + medicine-withdrawal guards; products & sale units
- **Finance:** batch costing, overheads, payroll / payslips / advances
- **Ops:** lifecycle stages, alerts, reports, AI advisor (optional OpenRouter key)
- **Platform admin:** multi-tenant farms, packages/features, audit, UAT testing

## Tech stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Tailwind CSS 4 · Radix/shadcn UI
- Drizzle ORM · PostgreSQL (`postgres` driver)
- Zod · Zustand · Dexie (offline queue)
- Vitest (unit + integration)

## Getting started

```bash
pnpm install
cp .env.example .env   # if present; otherwise create .env
# Required:
#   DATABASE_URL=postgres://...
#   SESSION_SECRET=<32+ random chars>
#   NEXT_PUBLIC_USE_REAL_API=true
pnpm db:migrate
pnpm db:seed
pnpm dev               # http://localhost:13000
```

**Demo logins** (when `SEED_DEMO` is not `false`):

| Role | Credentials |
|------|-------------|
| Owner | `kutswa@ifms.farm` / `demo1234` |
| Worker | phone `+254700333444` / PIN `1234` |
| Super-admin | `admin@ifms.app` / `demo1234` |

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server (port 13000) |
| `pnpm build` / `pnpm start` | Production build |
| `pnpm test:unit` | Unit tests |
| `pnpm test:integration` | Live API tests (app must be running) |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Schema & seed |
| `pnpm lint` | ESLint |

## Project layout

```
app/           # Role UIs + app/api/* Route Handlers
components/    # UI + role components
lib/server/    # Domain: auth, sales, costing, inventory, media, …
lib/offline/   # Dexie queue + sync flush
lib/api/       # Client facade (mock vs real via NEXT_PUBLIC_USE_REAL_API)
db/            # Drizzle client + schemas
drizzle/       # SQL migrations
docs/          # Setup, architecture, AI guide
tests/         # unit + integration
```

## Security notes (production)

- Set a strong `SESSION_SECRET` (never the dev default).
- Set `COOKIE_SECURE=true` when serving over HTTPS.
- Run migrations including `0026_security_hardening` (auditor link revoke + session jti kill list).
- Photos are size-capped; long-term they should move to object storage (see architecture doc).

## Docker / LAN HTTPS

See [`DOCKER.md`](DOCKER.md). For worker camera/GPS on LAN phones:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml --profile tls up -d --build
```

## Documentation

| Doc | Content |
|-----|---------|
| [`docs/ARCHITECTURE_ACTUAL.md`](docs/ARCHITECTURE_ACTUAL.md) | **Current** system architecture |
| [`docs/BACKEND_SETUP.md`](docs/BACKEND_SETUP.md) | Env, migrate, seed, API overview |
| [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) | Conventions for AI-assisted changes |
| [`docs/AUDIT_SUMMARY.md`](docs/AUDIT_SUMMARY.md) | Gap analysis / roadmap |
