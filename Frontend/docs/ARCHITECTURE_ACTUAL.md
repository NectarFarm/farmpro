# IFMS — Actual Architecture (source of truth for this repo)

| Field | Value |
|---|---|
| **Product** | Integrated Farm Management System (IFMS) |
| **Stack (shipped)** | Next.js 16 App Router · React 19 · Drizzle ORM · PostgreSQL |
| **Not shipped (docs only)** | Django · Celery · Redis · FastAPI AI microservice |

> Older files under `attachements/ARCHITECTURE-*.md` describe a **Django + Celery** target.
> **This document describes what the code actually runs.** Prefer this when onboarding.

## Runtime shape

```
Worker PWA / Owner Web / Admin
        │  HTTPS + httpOnly session cookie (HMAC)
        ▼
Next.js Route Handlers (app/api/*)
        │  tenantId + role + field permissions
        ▼
lib/server/* domain modules
        ▼
PostgreSQL (Drizzle)
```

- **Auth:** PBKDF2 password/PIN hashes; signed session cookie with `jti`; logout revokes `jti`.
- **Tenant isolation:** every query filtered by `session.tenantId` (app layer).
- **Field permissions:** `lib/server/fieldPermissions.ts` strips financial fields server-side.
- **Offline:** Dexie queue → `POST /api/sync` (clientUuid idempotency + typed side-effects).
- **Deploy:** **production runs on Vercel + Neon** (pooled serverless Postgres); Docker standalone Node image remains the local-dev/self-host path (optional Cloudflare OpenNext path also available). Also packaged as an Android APK (Bubblewrap TWA, direct sideload) — every web deploy updates the installed app automatically.

## Key modules

| Concern | Location |
|---------|----------|
| Session / cookie | `lib/server/session.ts`, `sessionRevoke.ts` |
| Sales (atomic) | `lib/server/sales.ts` |
| Sync / field events | `app/api/sync/route.ts` |
| CRUD resources | `app/api/data/[resource]/route.ts` |
| Costing | `lib/server/costing.ts` (`summarizeBatchCost` pure + bulk KPIs) |
| Photo size limits | `lib/server/media.ts` |
| Auditor links | `lib/server/auditorLinks.ts` (revocable, max 14 days) |
| Schema | `db/schemas/index.ts` + `drizzle/*` |

## Security hardening (recent)

- Worker task read/update scoped to `assignedTo === session.userId`
- Sale + headcount draw-down in one DB transaction with row locks
- Write/read rate limits on data + sync routes; login rate limit retained
- Photo data-URL validation (type + size)
- Auditor links stored hashed + revocable; max 14-day TTL
- Session `jti` kill list on logout
- **Local storage encryption** (`lib/offline/crypto.ts`): worker Dexie/IndexedDB
  (`pending`, `refCache`) encrypted with a non-extractable, device-bound
  AES-256-GCM key — protects a lost/stolen locked/logged-out device only.

## NFR audit remediation (2026-07-14)

- **Availability:** `GET /api/health` checks the DB (`select 1`, 3s timeout, 503 on failure) instead of a static 200.
- **Backup/recovery:** owner-only `GET /api/backup/export` (JSON, 14 core tables, credentials excluded) + a device-side "reconnect soon" warning past 24h unsynced (`SyncBadge`) — supplementary to Neon's own PITR, not a replacement.
- **Scalability:** `db/schemas/index.ts` now mirrors the ~36 indexes that existed only via raw-SQL migrations (schema/DB drift); `lib/server/ttlCache.ts` (45s TTL) smooths `/api/dashboard/kpis`.
- **Reliability:** all 7 error boundaries POST to `/api/errors` → `error_logs`; `GET /api/admin/errors` is a super_admin-gated route (no UI page yet).
- **Battery:** `lib/offline/sync.ts`'s poll loop no longer does a redundant Dexie read during the backoff cooldown window.
- **iOS:** code-audited (GPS/camera/PWA paths), no blocking API found — never device-tested.

## Still planned (not in this codebase yet)

- Object storage for photos (R2/S3) instead of Postgres base64
- Money as integer minor units (helpers in `lib/server/money.ts` prepare the path)
- Redis-backed rate limits / background jobs for multi-instance (the new TTL cache above shares this per-instance caveat)
- FK constraints across all tables
- SMS/push and M-Pesa integrations
- External uptime monitor wired to `/api/health`; dedicated admin UI for `/api/admin/errors`; iOS device testing
