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
- **Deploy:** Docker standalone Node image; optional Cloudflare OpenNext path.

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

## Still planned (not in this codebase yet)

- Object storage for photos (R2/S3) instead of Postgres base64
- Money as integer minor units (helpers in `lib/server/money.ts` prepare the path)
- Redis-backed rate limits / background jobs for multi-instance
- FK constraints across all tables
- SMS/push and M-Pesa integrations
