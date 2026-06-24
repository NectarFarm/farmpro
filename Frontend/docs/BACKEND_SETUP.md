# IFMS — Backend Setup (Option B: Next.js full-stack)

The app runs in two modes:

- **Mock mode (default):** screens use `lib/mock/api.ts`. No database needed. Good for UI/demo.
- **Real mode:** Route Handlers under `app/api/*` talk to Postgres via Drizzle, with
  tenant isolation + server-side field-level permissions. Turn on with a flag.

## 1. Provision Postgres (Supabase free tier)
Create a Supabase project → copy the **transaction pooler** connection string (port `6543`).

## 2. Environment
Create `.env` (never commit it):
```
DATABASE_URL=postgres://postgres.<ref>:<password>@<host>:6543/postgres
SESSION_SECRET=<32+ random chars>
NEXT_PUBLIC_USE_REAL_API=true        # turns the sync engine onto /api/sync
```
> `DATABASE_URL` and `SESSION_SECRET` are **server-only** (validated via `getServerEnv()`),
> never shipped to the browser. Only `NEXT_PUBLIC_*` reaches the client.

## 3. Migrate + seed
```
pnpm db:generate     # generate SQL from db/schemas/*
pnpm db:migrate      # apply to the database
pnpm db:seed         # demo tenant + users
```
Seed credentials:
- Owner — `kutswa@ifms.farm` / `demo1234`
- Worker — phone `+254700333444` / PIN `1234`

## 4. Run
```
pnpm dev
```

## What is enforced server-side
- **Auth:** `/api/auth/owner` (password), `/api/auth/worker` (PIN). PBKDF2 hashes
  (Workers/Node compatible). Signed httpOnly session cookie (HMAC-SHA256).
- **Tenant isolation:** every read in `/api/data/[resource]` is scoped by `tenant_id`
  from the session; cross-tenant access is impossible through the API.
- **Field-level permissions (the security boundary):** `lib/server/fieldPermissions.ts`
  **drops** hidden properties (e.g. `feed_unit_cost`, `batch_profit_loss`) from the
  response *before serialization* based on the worker's profile — not client hiding.
  Verify: log in as the worker, GET `/api/data/batches`, confirm `acquisitionCost`
  is absent from the JSON.
- **Sync:** `/api/sync` upserts by `clientUuid` (idempotent — resends never duplicate).

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/owner` | owner/manager/vet/auditor login |
| POST | `/api/auth/worker` | worker PIN login |
| POST | `/api/auth/logout` | clear session |
| GET  | `/api/auth/session` | current user |
| GET  | `/api/data/<resource>[?id=]` | units, batches, items, lots, tasks, alerts, sales, purchases, employees, worker-profiles |
| POST | `/api/sync` | drain offline queue |

## Remaining work (next phases)
- Swap screen reads from `lib/mock/api.ts` to `/api/data/*` (keep the same function
  signatures → low churn). The sync write path already flips via the flag.
- Route synced records from the generic `records` table into typed tables + true
  edit-conflict detection (currently idempotent-only).
- Replace PBKDF2 with Argon2id on the Python tier if stronger hashing is required.
- Add the costing engine, alerts evaluation, and reports (Celery tier per ARCHITECTURE).
