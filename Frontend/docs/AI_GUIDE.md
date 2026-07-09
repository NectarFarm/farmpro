# AI Coding Guide for IFMS

Conventions for humans and agents working on this codebase. Prefer
[`ARCHITECTURE_ACTUAL.md`](./ARCHITECTURE_ACTUAL.md) over older Django docs.

## Core Principles

1. **Security first** — tenant isolation and field permissions are server-side only.
2. **Predictability** — extend existing patterns (`lib/server/*`, `app/api/*`, Drizzle).
3. **Composability** — put domain logic in `lib/server`, not in giant page components.
4. **No silent data loss** — validate loudly; use transactions for multi-write flows.

## Directory Structure

- `db/` — Drizzle client + `schemas/index.ts`. New tables + migrations go here.
- `lib/server/` — Domain modules (sales, costing, inventory, media, session, …).
- `lib/api/` — Client facade (`NEXT_PUBLIC_USE_REAL_API` switches mock vs real).
- `lib/offline/` — Dexie queue + sync flush for workers.
- `app/api/` — Route Handlers: auth, CRUD, sync, admin.
- `app/{owner,worker,manager,vet,auditor,admin}/` — Role UIs.
- `tests/unit` + `tests/integration` — Vitest.

## Coding Standards

### Database
- Every tenant-owned row carries `tenant_id`.
- Prefer migrations under `drizzle/` (do not hand-edit production without a migration).
- Money: still `doublePrecision` for pilot; use `lib/server/money.ts` helpers for new math.

### API routes
- Always `getSession()`; never trust client-sent `tenantId`.
- Use helpers from `lib/server/http.ts` (`ok`, `badRequest`, `unauthorized`, …).
- Rate-limit writes (`checkWriteRateLimit`) on mutating endpoints.
- Validate bodies (Zod in `lib/server/validate.ts` where practical).

### Domain
- Sales → `createSale()` (atomic).
- Photos → `validatePhotoDataUrl()` before insert.
- Costing pure core → `summarizeBatchCost()`; bulk KPIs avoid N+1.

### UI
- `sonner` toasts; shadcn under `components/ui/`.
- Prefer `lib/api` over raw `fetch` in screens when a facade method exists.
- i18n via `lib/i18n` (`en` / `sw`).

## Providing Feedback
Inform the user on success/failure with `toast()` for interactive owner/worker flows.
