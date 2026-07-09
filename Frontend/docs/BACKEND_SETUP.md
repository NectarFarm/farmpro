# IFMS — Backend Setup (Next.js full-stack)

The app runs in two modes:

- **Mock mode (default):** screens use `lib/mock/api.ts`. No database needed. Good for UI/demo.
- **Real mode:** Route Handlers under `app/api/*` talk to Postgres via Drizzle, with
  tenant isolation + server-side field-level permissions. Turn on with a flag.

See also: [`ARCHITECTURE_ACTUAL.md`](./ARCHITECTURE_ACTUAL.md) for the live architecture.

## 1. Provision Postgres
Create a Postgres database (local Docker, Supabase free tier, etc.). For Supabase, prefer the
**transaction pooler** (port `6543`) when running serverless; for long-lived Node use session mode or direct.

## 2. Environment
Create `.env` (never commit it):
```
DATABASE_URL=postgres://...
SESSION_SECRET=<32+ random chars>
NEXT_PUBLIC_USE_REAL_API=true
# Optional:
# COOKIE_SECURE=true          # only when serving HTTPS
# OPENROUTER_API_KEY=...      # AI advisor
# RATE_LIMIT_LOGIN_MAX=5
```
> `DATABASE_URL` and `SESSION_SECRET` are **server-only** (validated via `getServerEnv()`).
> Production rejects the insecure default `SESSION_SECRET`.

## 3. Migrate + seed
```
pnpm db:migrate      # apply drizzle/* including 0026_security_hardening
pnpm db:seed         # demo tenant + users (SEED_DEMO=false → admin only)
```
Seed credentials (demo):
- Owner — `kutswa@ifms.farm` / `demo1234`
- Worker — phone `+254700333444` / PIN `1234`
- Super-admin — `admin@ifms.app` / `demo1234`

## 4. Run
```
pnpm dev   # port 13000
```

## What is enforced server-side
- **Auth:** password (owner/manager/vet/auditor/admin) or worker PIN. PBKDF2. Signed httpOnly cookie with `jti`; logout revokes the jti.
- **Tenant isolation:** every read/write scoped by `session.tenantId`.
- **Field-level permissions:** financial fields dropped server-side (`lib/server/fieldPermissions.ts`).
- **Task ownership:** workers may only list/update tasks assigned to themselves.
- **Sales:** atomic transaction + stock/withdrawal checks (`lib/server/sales.ts`).
- **Sync:** `/api/sync` idempotent by `clientUuid`; photo size/type validated; write rate-limited.
- **Auditor links:** max 14 days, stored hashed, revocable (`POST/GET/DELETE /api/auditor-link`).
- **Rate limits:** login (strict); data/sync reads & writes (token bucket, in-memory per process).

## Core endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Unified login |
| POST | `/api/auth/owner` / `worker` | Role-specific login |
| POST | `/api/auth/logout` | Clear + revoke session |
| GET  | `/api/auth/session` | Current session |
| GET/POST/PATCH/DELETE | `/api/data/<resource>` | Tenant-scoped CRUD |
| POST | `/api/sync` | Offline queue drain |
| POST | `/api/auditor-link` | Issue auditor link |
| DELETE | `/api/auditor-link?id=` | Revoke auditor link |

## Remaining work (next phases)
- Move photos from base64-in-Postgres to object storage (R2/S3).
- Money as integer minor units (helpers exist in `lib/server/money.ts`).
- Redis-backed rate limits + background jobs for multi-instance.
- Optional FK constraints; multi-farm (`farmId` still stubbed as `f1`).
- SMS/push for critical alerts; M-Pesa settlement.
