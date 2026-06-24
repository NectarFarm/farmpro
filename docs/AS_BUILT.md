# IFMS — As-Built Notes & Deviations from the Original Specs

**Status:** Phase-1 implementation built and proven (Next.js full-stack).
**Last updated:** 2026-06-24.

This document records where the **implemented system** differs from, or extends, the
original inception documents (`CONCEPT_NOTE.md`, `SRS.md`, `DESIGN.md`, `ARCHITECTURE.md`).
Those four remain the intent/requirements baseline; this is the source of truth for
*what actually exists today*. The code lives in `Frontend/`.

---

## 1. Architecture — adopted "Option B" (single Next.js full-stack app)

The original architecture proposed a Django/DRF API + Celery + a separate frontend.
**That was dropped in favour of a single Next.js 16 (App Router) full-stack app.**

- **One deployable**: UI, API route handlers, auth, costing, alerts, reports all in `Frontend/`.
- **Database**: PostgreSQL via **Drizzle ORM** + `postgres-js` (migrations in `Frontend/drizzle/`, schema in `Frontend/db/schemas/`). Not Django models.
- **Two run modes** via `NEXT_PUBLIC_USE_REAL_API`: a mock facade (`lib/api/index.ts`) for UI-only demos, and the real API-backed path.
- **No Celery/queue yet.** Alert evaluation, costing, and report generation run **on-demand / on-read** (e.g. `POST /api/alerts/evaluate`, costing computed when a batch is viewed). The scheduled/background tier (cron alerts, heavy async reports) is **deferred** — on-read compute covers pilot scale.

## 2. Authentication, tenancy & privacy (hardened beyond the spec)

- **Password/PIN hashing**: PBKDF2 (Web Crypto), not a framework default (`lib/server/crypto.ts`).
- **Sessions**: HMAC-signed, httpOnly, expiring cookies (`lib/server/session.ts`).
- **Edge middleware route gate** (`Frontend/middleware.ts`): every protected route is checked **before render** — logged-out users are redirected to the right login, and each section is **role-locked** (owner ≠ admin ≠ worker). Verified: no page shell leaks to the unauthenticated.
- **Tenant isolation**: every data query is scoped by `tenant_id`. Verified with a cross-tenant test (one farm cannot read another's batches/photos — direct-id access returns 404).
- **Field-level permission stripping** (`lib/server/fieldPermissions.ts`): worker API responses are stripped server-side, with **default-deny for financial keys** (feed cost, sale price, batch P&L).
- **No account enumeration**: login returns the same error for unknown-user and wrong-password; DB-unreachable returns a friendly 503, never a raw 500.
- **Offline PIN cache** upgraded from reversible `btoa` to PBKDF2.
- **New role: `super_admin`** (platform operator) in addition to owner/manager/worker/vet/auditor.

## 3. Product catalog (major addition — replaces hard-coded "eggs everywhere")

Production is no longer egg-centric. Products are **per batch and enterprise-specific**:

- `products` table: `{ tenantId, batchId, name, baseUnit, saleUnits jsonb [{name,perBase,price}], collectFrequency, flow, fieldKey, active }`.
- **Enterprise templates** (`lib/server/productTemplates.ts`): layers → Eggs (tray@360 / piece@13) + Manure + spent hen; broilers → meat; pig_fatten → Pork; pig_breed → Piglets; tilapia/catfish → Fish; maize → grain. A pig/maize farm never sees eggs.
- **Multiple priced sale units per product**; a sale just selects product + unit and the price prefills.
- **Collection frequency** per product (daily/weekly/monthly/per_cycle); **flow** = sale or expense.
- **Auto-provisioning**: creating a batch auto-creates its products, **auto-adds `collect_*` permission fields** to worker profiles, and raises an "assign a collector" alert.
- Products (including system-default ones) are **editable** by the farmer — prices are not fixed.

## 4. Field capture, photos & worker accountability

- **Worker product-collection flow** (`/worker/record/collect`): worker picks batch → product → quantity → offline-enqueues a `production` record → drives the dynamic charts.
- **Photo storage** (`photos` table): mortality photos are actually captured, uploaded on sync, stored, and **served via `/api/photos/[id]`** (non-worker roles only). Previously the image was discarded.
- **Worker Activity feed**: per-batch ("Worker Activity" on the batch page) and farm-wide (`/owner/activity`, `/api/worker-activity`) — mortality (with photo + GPS), health, feeding, collections, by worker and day.
- **Closing-stock variance** (`closing_stock_counts` table, `/api/inventory/variance`): worker counts vs system on-hand → real flags in the Inventory variance tab (no fake data).

## 5. Commercialization / multi-tenant SaaS (new)

- `tenants.plan` + `tenants.features` (jsonb). Plans: **free / standard / pro** (`lib/features.ts`).
- **Platform admin dashboard** (`/admin/dashboard`, super_admin only): manage each farm's plan and toggle individual features.
- `/api/me` returns the tenant's features; the owner UI **gates nav items, the Setup Guide, and the AI Advisor** by plan.

## 6. AI Advisor (new; via OpenRouter, not a bespoke Claude tier)

- Floating **AI Farm Advisor** for owner/manager (`components/AIAdvisor.tsx`, `/api/ai/advise`, `lib/server/ai.ts`).
- Calls an LLM through **OpenRouter** (OpenAI-compatible); model configurable via `OPENROUTER_MODEL`.
- **Grounded** in live farm data (KPIs, batches, active alerts, low stock, 14-day production).
- **Multi-turn** with **history persisted in localStorage** (survives reloads). Degrades gracefully when no key is set.

## 7. UX / reporting deviations

- **Dynamic charts**: production chart shows **real product names** (Eggs, Manure, Pork…), not a generic "produced" total; batch P&L cumulative cost-vs-revenue.
- **Alerts are actionable**: clicking an alert routes to the responsible screen (`lib/alerts.ts`); a red **notification-bell badge** shows the unacknowledged count. The redundant dashboard alert-list and quick-link cards were removed.
- **Finance** fully wired to real data: product-driven sales, purchases, batch P&L, revenue/expense.
- **Onboarding** without seed data: floating Setup Guide + `/api/setup` bulk persist.
- **Visual refresh**: jungle-green sidebar, lucide vector icons, redesigned KPI cards.
- **Reports**: PDF/exports via jspdf (on-demand), gated by the `reports` feature.

## 8. Operations — Dockerized

- Multi-stage **`Frontend/Dockerfile`** (Node 22, Next.js **standalone** output, non-root runtime).
- **`Frontend/docker-compose.yml`**: `docker compose up --build` brings up Postgres → migrate+seed (one-shot) → app on `:13000`. See `Frontend/DOCKER.md`.
- `.env` is **not** baked into the image; configuration is via compose env (`SESSION_SECRET`, `OPENROUTER_API_KEY`, ports, etc.).

## 9. Demo logins (seeded)

- Owner: `kutswa@ifms.farm` / `demo1234`
- Manager: `amina@ifms.farm` / `demo1234` · Vet: `vet@ifms.farm` / `demo1234` · Auditor: `investor@fund.ke` / `demo1234`
- Workers: John `+254700333444` / `1234`, Mary `+254700555666` / `5678`
- Platform admin: `admin@ifms.app` / `demo1234`

## 10. Still deferred (not yet built)

- Scheduled/background tier (Celery/FastAPI equivalent): cron alert evaluation, heavy async report generation.
- Login rate-limiting (needs a Redis/Upstash tier).
- Conflict detection for non-production sync record types (production is done).
