# IFMS — Integrated Farm Management System

A **mobile-first, offline-capable** management system for diversified Kenyan smallholder
farms (poultry, pigs, fish, crops). An owner runs the farm remotely; field workers
record daily data on their phones; the owner controls exactly what each worker can see.
It is delivered as a **multi-tenant SaaS** with subscription plans and an AI farm advisor.

> **New here? Read this file, then `docs/AS_BUILT.md` for what's actually implemented,
> and `docs/` for the full specs.**

---

## What it does

- **Owner/Manager portal** — dashboard (KPIs + live production charts), farm (units → batches → products), inventory (FIFO lots, feed formulation, closing-stock variance), finance (product-driven sales, purchases, batch P&L), per-worker activity log (with photos + GPS), alerts, reports, and worker field-permission config.
- **Worker app** — big-touch, offline-first capture: morning round, feeding, mortality (with mandatory photo + GPS above a threshold), health, weighing, stock counts, and **product collection** (eggs/milk/meat/manure…). Records queue offline and sync when back online.
- **Platform admin** — manage every farm's **plan (free / standard / pro)** and per-feature access; onboard new farms (creates the tenant + its owner login).
- **AI Advisor** — an in-app assistant grounded in the farm's live data (KPIs, batches, alerts, low stock, recent production), with a saved conversation. Powered by OpenRouter.
- **Roles**: `owner`, `manager`, `worker`, `vet`, `auditor`, `super_admin`.

## Tech stack

Single **Next.js 16 (App Router)** full-stack app — UI + API + auth + costing + alerts +
reports in one deployable. **PostgreSQL** via **Drizzle ORM**. Auth is PBKDF2 + HMAC-signed
httpOnly session cookies, with an **edge middleware** gate (logged-out → login, sections
role-locked). Offline queue via Dexie/IndexedDB. No separate backend/queue — heavier work
(costing, alerts, reports) runs on-read. See `docs/ARCHITECTURE.md`.

---

## Run it — Docker (recommended)

One command brings up Postgres + migrations + seed + the app:

```bash
cd Frontend
docker compose up --build
```

Then open **http://localhost:13000**. Stop with `docker compose down` (`-v` also wipes the
DB volume). Full details and configuration in **`Frontend/DOCKER.md`**.

> Free the ports first if your dev setup is running: stop any `pnpm dev` on 13000 and any
> manual `ifms-pg` container on 55432.

## Run it — local dev (alternative)

```bash
cd Frontend
pnpm install
# bring up just Postgres (or use your own; set DATABASE_URL):
docker run -d --name ifms-pg -e POSTGRES_PASSWORD=ifms -e POSTGRES_DB=ifms -p 55432:5432 postgres:16
pnpm db:migrate && pnpm db:seed
pnpm dev            # http://localhost:13000  (add -H 0.0.0.0 to reach it over the LAN)
```

`Frontend/.env` holds the config (DB URL, session secret, and the optional OpenRouter key).

---

## Logins (after seeding)

There is **one login page** (`/login`) for everyone — the system identifies your role and
sends you to the right place.

| Role | Identifier | Secret |
|------|-----------|--------|
| Owner | `kutswa@ifms.farm` | `demo1234` |
| Manager | `amina@ifms.farm` | `demo1234` |
| Vet | `vet@ifms.farm` | `demo1234` |
| Auditor (read-only) | `investor@fund.ke` | `demo1234` |
| Worker | `+254700333444` | `1234` |
| Platform admin | `admin@ifms.app` | `demo1234` |

## Enable the AI Advisor

Add an [OpenRouter](https://openrouter.ai/keys) key to `Frontend/.env` (placeholders are
already there) and restart:

```
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

---

## Project layout

```
IFMS/
├── Frontend/              # the application (Next.js full-stack)
│   ├── app/               # routes: /login, /owner, /worker, /admin, /vet, /auditor, /api
│   ├── db/                # Drizzle schema + seed
│   ├── drizzle/           # SQL migrations
│   ├── lib/               # server (auth, costing, alerts, ai…) + client helpers
│   ├── middleware.ts      # edge auth/role gate
│   ├── Dockerfile · docker-compose.yml · DOCKER.md
│   └── .env               # configuration
└── docs/                  # CONCEPT_NOTE · SRS · DESIGN · ARCHITECTURE (living)
    ├── AS_BUILT.md        # what differs from the specs (read this)
    └── inception/         # the original specs, preserved untouched
```

## Key environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | signing key for session cookies — **set a long random value in production** |
| `NEXT_PUBLIC_USE_REAL_API` | `true` = real API; `false` = in-memory mock for UI demos |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | enable the AI Advisor |

## Documentation

- `docs/AS_BUILT.md` — implemented reality and deviations from the specs.
- `docs/ARCHITECTURE.md`, `docs/SRS.md`, `docs/DESIGN.md`, `docs/CONCEPT_NOTE.md` — living specs.
- `docs/inception/` — the original inception specs, preserved.
- `Frontend/DOCKER.md` — Docker run guide.
