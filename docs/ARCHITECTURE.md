> **As-built revision — 2026-06-24.** Updated to match the implemented system. The original inception version is preserved untouched at `docs/inception/ARCHITECTURE.md`. See `docs/AS_BUILT.md` for the full deviation list.

# IFMS — Technical Architecture & Implementation Plan

| Field | Value |
|---|---|
| **Product** | Integrated Farm Management System (IFMS) |
| **Document type** | Technical Architecture & Implementation Plan |
| **Version** | **3.0 — Option B: Next.js full-stack (supersedes v2's Django-API design); as-built 2026-06-24** |
| **Status** | Phase-1 built & proven — pilot |
| **Source of truth** | SRS v1.0 · DESIGN.md v1.0 · `docs/AS_BUILT.md` (as-built) |
| **Audience** | Developers, technical co-founder, owner (Kutswa) |

---

## 0. What changed in v3.0 — and why (read first)

The system is built as a **single Next.js 16 (App Router) full-stack app** (`Frontend/`): UI, API Route Handlers, auth, costing, alerts and reports all in one deployable. This is **Option B — Next.js is the full-stack product (UI + BFF + CRUD + auth)**, and it is what actually ships.

**Consequences (decided, and now implemented):**
- **Django/DRF is dropped.** Next.js Route Handlers (`app/api/**`) are the API. There is no second CRUD backend.
- **No Python tier was built.** Compute that the inception design parked on FastAPI + Celery + Redis (alert evaluation, costing roll-ups, report generation) runs **on-demand / on-read inside the Next.js server** instead. The scheduled/background tier (cron alerts, heavy async reports, a message broker) is **deferred** — on-read compute covers pilot scale. AI did **not** become a bespoke Python/Claude service; it is an **OpenRouter** call from a server route (see §10).
- **Security model lives in the Next.js server:** it holds DB credentials and enforces tenant isolation + field-level permission stripping, with an **edge middleware route gate** (`middleware.ts`) layered in front. The rule "no privileged secret ever reaches the browser" is unchanged and non-negotiable.

> This keeps one codebase and one runtime (TypeScript/Node end-to-end). The deferred background/AI-worker tier remains a clean future addition, not a present dependency.

---

## 1. Architectural Principles (ranked)
1. **Security & privacy first** — tenant isolation + field-level permissions enforced **server-side, in code we control**, with an edge route gate in front; no secret reaches a client; least privilege.
2. **Start free, stay cheap, scale cleanly** — a single Dockerized Node app + one Postgres = trivially cheap to host anywhere.
3. **Offline-first** — the worker app never blocks on the network (`FR-M17-*`).
4. **Something that works > something clever** — one product codebase (Next.js); compute on-read now, a background/AI-worker tier later only when scale demands it.

---

## 2. The Stack (Option B — as built)

| Layer | Choice | Role |
|---|---|---|
| **Product (UI + API)** | **Next.js 16 (App Router)** — Route Handlers (`app/api/**`) | The whole product surface: worker PWA, owner/manager/auditor/vet/super_admin web, and the server API the clients call |
| **Server data access** | **Drizzle ORM + `postgres-js`** (`server-only`, `db/index.ts`) | Typed CRUD; enforces tenant + field-level rules before any response leaves the server |
| **Database** | **PostgreSQL** via Drizzle migrations (`Frontend/drizzle/`) | System of record; standard Postgres → portable, no lock-in. `db/index.ts` uses `prepare:false` + a per-request client (pooler-/Workers-safe) |
| **Run modes** | **`NEXT_PUBLIC_USE_REAL_API`** | `true` → real Postgres-backed Route Handlers; unset → a mock facade (`lib/api/index.ts`) for UI-only demos |
| **Photos** | **`photos` table** (compressed data-URL for the demo) | Served via `/api/photos/[id]` to non-worker roles. Production would store bytes in R2/Supabase + a signed URL |
| **Offline (client)** | **Dexie / IndexedDB** + queue → `/api/sync` | Pending-write queue, PBKDF2 PIN cache, app-shell offline |
| **AI advisor** | **OpenRouter** (OpenAI-compatible) via `lib/server/ai.ts` | Grounded farm advice; model set by `OPENROUTER_MODEL` (see §10) |
| **Hosting** | **Docker** — multi-stage `Frontend/Dockerfile` (Node 22, Next.js standalone, non-root) + `docker-compose.yml` | One image; `.env` not baked in. Portable to any container host |
| **Background/AI-worker tier** | **Deferred** (was FastAPI + Celery + Redis) | Not built; compute runs on-read in-process for the pilot |

**Anti-patterns still avoided:** any privileged key in the client; a second CRUD backend; secrets in the image or the client bundle.

---

## 3. Architecture (as built)

```
┌──────────────────────────── CLIENTS (browser / installed PWA) ───────────────┐
│  Worker PWA (mobile)  ·  Owner / Manager / Auditor / Vet / Admin (web)       │
│  Dexie offline queue · Camera+GPS · NO secrets, NO DB creds                  │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ HTTPS · HMAC-signed httpOnly session cookie (ifms_session)
                ▼
┌──────────── EDGE MIDDLEWARE  (middleware.ts)  ──────────────────────────────┐
│  Verifies the HMAC session token & expiry BEFORE any page renders           │
│  Redirects logged-out users to the right login; role-gates each section     │
│  (admin→super_admin · owner/manager · vet · auditor · worker)               │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌─────────── NEXT.JS  (single full-stack app, Docker / Node 22) ──────────────┐
│  Route Handlers  app/api/**   (server-only)                                  │
│   • Auth: owner password / worker PIN (PBKDF2) · session issue/verify (HMAC) │
│   • Tenant isolation — every query scoped by tenant_id                       │
│   • Field-permission stripping (FR-M16) ← drops fields server-side, default- │
│     deny on financial keys                                                   │
│   • On-read compute: costing · alert evaluation · reports (no queue)         │
│   • /api/sync (idempotent by clientUuid) · /api/photos/[id] · AI advisor     │
│   • Holds ALL secrets (DATABASE_URL, SESSION_SECRET, OPENROUTER_API_KEY)     │
└───────┬──────────────────────────────────────────────────┬──────────────────┘
        │ Drizzle (postgres-js, prepare:false,             │ HTTPS (server→server)
        │ per-request client)                              ▼
        ▼                                          ┌────────────────────┐
┌──────────────┐                                   │ OpenRouter          │
│ PostgreSQL   │                                   │ (OpenAI-compatible  │
│ (Drizzle     │                                   │  LLM, model via     │
│  migrations) │                                   │  OPENROUTER_MODEL)  │
└──────────────┘                                   └────────────────────┘

  DEFERRED (not built): cron/queue background tier · message broker · SMS/push
```

**Hard rule (unchanged):** clients talk only to the Next.js server. No client uses Drizzle/Postgres directly and holds no secret. The only outbound server-to-server call is the AI advisor to OpenRouter.

---

## 4. Where each concern lives (so nothing falls through the cracks)

| Concern | Home | Notes |
|---|---|---|
| CRUD + reads | Next.js Route Handlers + Drizzle | `server-only` modules; never client |
| AuthN/Z | Edge `middleware.ts` (route gate) + Route Handlers | owner password, worker PIN (PBKDF2); HMAC session cookie |
| **Field-level permissions** | `lib/server/fieldPermissions.ts` | hidden fields **dropped before response** (FR-M16); default-deny financial keys |
| Tenant isolation | Next.js query layer (base `where tenant_id`) | app layer is the guarantee (no DB RLS configured) |
| Validation / business rules | Next.js handlers (`BR-*`) | withdrawal block, qty bounds, etc. |
| Costing / alerts / reports | **On-read, in-process** (`lib/server/costing.ts`, `alertEngine.ts`, `reports.ts`) | computed when viewed / on `POST /api/alerts/evaluate`; no queue |
| AI advisor | `lib/server/ai.ts` → **OpenRouter** | server→server; grounded in live farm data |
| Audit trail | Postgres append-only `audit_log` | INSERT-only; corrections = adjusting entries |
| Secrets | Container env (compose) | never `NEXT_PUBLIC_*`; not baked into the image |
| Background/cron tier | **Deferred** | scheduled alerts, async reports, SMS/push not built |

---

## 5. Data Model & Connection Management

The schema is expressed as **Drizzle schemas** in `Frontend/db/schemas/index.ts`, with migrations in `Frontend/drizzle/` (applied via `drizzle-kit`). Every tenant-owned row carries `tenant_id`.

**Core tables (as built):** `tenants` (with `plan` + `features` jsonb), `users`, `worker_profiles`, `employees`, `production_units`, `batches`, `inventory_items`, `inventory_lots`, `feed_formulas`, `overheads`, `tasks`, `alerts`, `alert_rules`, `sales`, `purchases`, `audit_log`, `conflict_log`, `records` (generic synced-event landing table, `client_uuid` PK).

**Typed field-event tables** (each `client_uuid` PK → idempotent sync; the costing engine reads them): `feeding_records`, `mortality_records`, `production_records`, `health_records`, `labor_logs`, `closing_stock_counts`.

**New subsystems added beyond the inception schema:**
- **Products & enterprise templates** — `products` (`{ tenantId, batchId, name, baseUnit, saleUnits jsonb[{name,perBase,price}], collectFrequency, flow, fieldKey, active }`). Per-enterprise defaults live in `lib/server/productTemplates.ts` (layers→Eggs+Manure+spent hen, broilers→meat, pig_fatten→Pork, pig_breed→Piglets, tilapia/catfish→Fish, maize→grain). Creating a batch auto-provisions its products (`lib/server/products.ts`). Replaces the old egg-centric model.
- **Photos** — `photos` (compressed data-URL + GPS); mortality evidence captured, synced, and served via `/api/photos/[id]`.
- **Closing-stock counts** — `closing_stock_counts` drives the Inventory variance tab (`/api/inventory/variance`).
- **Feature entitlements** — `tenants.plan` + `tenants.features` (jsonb) gate features per farm (`lib/features.ts`; see §10/§11).
- **Worker activity** — surfaced from the typed field-event tables (`/api/worker-activity`, `/api/batch-activity`).

> No DB-level RLS is configured. **Tenant isolation is enforced purely in the app layer** — every query is scoped by `tenant_id`, verified by a cross-tenant test (one farm cannot read another's batches/photos; direct-id access returns 404).

**Connection management (`db/index.ts`):** a **per-request** `postgres-js` client (scoped via React `cache()`), opened with **`prepare: false`** and `max: 1`, behind a lazy proxy so the connection is established at runtime, not at build. This keeps the code safe under both a transaction pooler and the Cloudflare Workers per-request-socket rule, even though the app currently ships on Node (Docker). Do **not** add a long-lived global pool on top.

---

## 6. Authentication, Field-Level Security & Secrets

### 6.1 Identities & sessions (as built)
- **Roles:** `owner`, `manager`, `vet`, `auditor`, `worker`, plus a new platform-operator role **`super_admin`** (manages tenants/plans at `/admin/dashboard`).
- **Owner / Manager / Auditor / Vet / super_admin:** email + password, hashed with **PBKDF2** (Web Crypto, 100k iterations, `lib/server/crypto.ts`). No account enumeration: unknown-user and wrong-password return the same error; a DB-unreachable login returns a friendly 503, never a raw 500.
- **Worker:** **phone + PIN** via a custom server check, PIN PBKDF2-hashed. No SMS-OTP on the daily path (workers are offline at dawn).
- **Sessions:** an **HMAC-SHA256-signed, httpOnly, SameSite=lax cookie** (`ifms_session`, 8h, `secure` in production) — `lib/server/session.ts`. The token carries `{ userId, tenantId, role, workerProfileId?, name, exp }`.
- **Edge route gate (`middleware.ts`):** verifies the same HMAC token + expiry **before any protected page renders**, redirects logged-out users to the correct login, and role-locks each section. Nothing flashes; it can't be bypassed by client state. *(TOTP 2FA and rotating-refresh/remote-revoke remain deferred.)*
- **Offline unlock:** the offline PIN cache hashes the PIN with **PBKDF2** (upgraded from the prototype's reversible `btoa`); never the raw PIN.

### 6.2 Field-level permissions — enforced server-side
Enforced in `lib/server/fieldPermissions.ts`, **not** in any client store:
```
hiddenFieldKeysFor(session) → owner/auditor: nothing hidden
                              worker w/ profile: profile-hidden keys + default-deny financial keys
                              manager/vet/profile-less worker: all financial keys hidden
stripForRead(resource, rows, hidden) → DELETE sensitive props before serialization
assertWritable(session, fieldKeys)   → reject writes to non-editable fields
```
**Default-deny on financial keys** (`feed_unit_cost`, `egg_sale_price`, `batch_profit_loss`): a partial or mangled worker profile can never leak money. Because dropped properties are never serialized, hidden money values **do not exist in the payload** (`FR-M16`, `NFR-SEC-2`). CI test asserts forbidden keys are absent from a worker's API response.

### 6.3 Secrets
- Secrets (`DATABASE_URL`, `SESSION_SECRET`, `OPENROUTER_API_KEY`) live in **container env only** (compose); the `.env` is **not** baked into the Docker image.
- **Only `NEXT_PUBLIC_*` reach the browser** — and those are non-sensitive (`NEXT_PUBLIC_USE_REAL_API`). Server env is validated server-side (`lib/env.ts`) and never throws in the browser bundle.
- Photos are served by an authenticated route (`/api/photos/[id]`, non-worker roles only). A future move to R2/Supabase + signed URLs is noted but not built.

---

## 7. Security & Privacy Controls
| Control | Implementation | SRS |
|---|---|---|
| Edge route gate | `middleware.ts` verifies HMAC session + expiry and role-gates every section before render | `NFR-SEC-2` |
| Tenant isolation | server query layer scopes every read/write by `tenant_id`; cross-tenant test (direct-id → 404) | `NFR-AR-1` |
| Field-level perms | server field-drop with default-deny on financial keys (§6.2) — **not** client hiding | `FR-M16` |
| Password/PIN hashing | PBKDF2 (Web Crypto, 100k iter); HMAC-SHA256 signed session cookie | `NFR-SEC-1` |
| No account enumeration | identical error for unknown-user/wrong-password; DB-down → friendly 503 | `NFR-SEC-2` |
| Secrets | container env only; no secret in `NEXT_PUBLIC_*`, client bundle, or image | `SEC-3` |
| DB access boundary | Drizzle in `server-only` modules; client cannot import it | `NFR-SEC-2` |
| Transport / at rest | TLS, secure cookies; Postgres encryption at the host | `NFR-SEC-1` |
| Audit | append-only `audit_log`; corrections = adjusting entries | `FR-M18` |
| **Deferred** | DB-level RLS, login rate-limiting, image re-encode, tenant export/delete, configurable retention | — |

---

## 8. Rate Limiting — deferred

Application-level rate limiting (including **login throttling/lockout**) is **not yet built** — it needs a shared counter store (Redis/Upstash), which is part of the deferred infrastructure tier. The intended policy, for when that tier lands:

| Tier | Mechanism (planned) | Policy |
|---|---|---|
| Edge | host/CDN rate-limiting rules | coarse per-IP ceiling; bot/DDoS shield |
| App | Ratelimit in Route Handlers (Redis) | reads 100/min·user · writes 30/min·user · photo 10/min·user |
| Auth | counter + backoff | **login 5/min·IP + lockout** |

The sync client already honors `429` + `Retry-After` with exponential backoff, so adding server-side limits later is non-breaking.

---

## 9. Offline Sync (as built — `app/api/sync/route.ts`)
- **Write path:** the worker app saves to Dexie with a client **UUID** + `capturedAt` + `status=pending`; instant "✓ saved"; queue badge (`FR-M17-1`).
- **Drain:** a sync engine flushes `pending` → `POST /api/sync` in batches → marks `synced`. The route lands every event in the generic `records` table and additionally routes known types (feeding, mortality, health/vaccination, closing_stock, production) into their typed tables. Mortality photos (data-URL) are stored in `photos` and linked.
- **Idempotency:** `client_uuid` is the PK on every event table; inserts use `onConflictDoNothing` → retries never duplicate; a repeat is treated as "already accepted", not a conflict (`FR-M17-5`).
- **Conflict (true edit clash) — done for production records:** production has a natural business key (one record per batch, per type, per day), so two workers logging the same day's output is a real edit conflict. It's resolved **last-write-wins by `capturedAt`**, with the loser preserved in `conflict_log` and the conflict returned to the client (`FR-M17-3`).
- **Deferred:** conflict detection for the *other* record types (feeding/mortality/health/closing_stock) is not yet built — those are idempotent-insert only. Service-Worker background sync is also deferred; the drain fires on reconnect / app-open / manual sync.

---

## 10. Compute & AI (as built)

There is **no background/queue tier**. Everything the inception design parked on Celery/Cron runs **on-demand, in-process** in the Next.js server:

| Task | Where (as built) | Trigger |
|---|---|---|
| Alert evaluation (mortality spike, low stock, expiry, feed-variance) | `lib/server/alertEngine.ts` | on read + `POST /api/alerts/evaluate` (`FR-M14`) |
| Cost roll-ups / batch P&L | `lib/server/costing.ts` → `/api/cost-summary` | computed when a batch is viewed (`FR-M10`) |
| Charts (per-product production, cumulative cost vs revenue) | `lib/server/charts.ts` → `/api/charts/*` | on read |
| Report generation (PDF/CSV via jspdf) | `lib/server/reports.ts` → `/api/reports/[type]` | on request, synchronous (`FR-M15`); gated by the `reports` feature |
| **AI Farm Advisor** (grounded chat) | `lib/server/ai.ts` → `/api/ai/advise` | server→server to **OpenRouter** |
| **Deferred** | scheduled alert eval, vaccination/treatment reminders, async heavy reports, SMS/push dispatch, data archival | — |

**AI Advisor:** a floating advisor for owner/manager (`components/AIAdvisor.tsx`). The server route calls an LLM through **OpenRouter** (OpenAI-compatible HTTP API), with the model set by **`OPENROUTER_MODEL`** and the key in **`OPENROUTER_API_KEY`** — **not** a bespoke Python/Claude service and not the Anthropic SDK. Prompts are grounded in live farm data (KPIs, batches, active alerts, low stock, recent production); multi-turn history is persisted in `localStorage`. It degrades gracefully when no key is set, and is plan-gated by the `ai_advisor` feature.

---

## 11. Deployment, Ops & Commercialization (as built)

**Dockerized, single image.** See `Frontend/DOCKER.md`.
| Component | Where | Note |
|---|---|---|
| App | Multi-stage **`Frontend/Dockerfile`** (Node 22, Next.js **standalone**, **non-root** user) | `pnpm build` → `.next/standalone`; runs `node server.js` on `:3000` |
| Orchestration | **`Frontend/docker-compose.yml`** | `docker compose up --build`: Postgres → one-shot `migrate` (`db:migrate` + `db:seed`) → app on `:13000` |
| Database | **PostgreSQL 16** container (volume-backed) | `DATABASE_URL` via compose env |
| Config | container env (`SESSION_SECRET`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, ports) | `.env` is **not** baked into the image |
| Portability | any container host | standard Postgres + standard Next.js → no lock-in |

**Multi-tenant SaaS / feature entitlements (new).** `tenants.plan` (`free` / `standard` / `pro`) + `tenants.features` (jsonb) drive what each farm sees (`lib/features.ts`). `/api/me` returns the tenant's features; the owner UI gates nav, the Setup Guide, and the AI Advisor by them. A **platform-admin dashboard** (`/admin/dashboard`, super_admin only, backed by `/api/admin/tenants`) sets each farm's plan and toggles individual features.

> The free/always-on hosting analysis from the inception doc (Cloudflare Workers + Supabase + an Oracle VM) is **not** what shipped — the app is a portable Docker image you can run anywhere, including those hosts, but it carries no Workers/Supabase/Oracle dependency.

---

## 12. Implementation Status (Phase-1 — built & proven)
| Area | Status | What shipped |
|---|---|---|
| **Data + server API** | ✅ Built | Drizzle schemas + migrations (`Frontend/drizzle/`); tenant-scoped Route Handlers (`app/api/**`); owner password + worker PIN auth (PBKDF2) |
| **Real API behind the facade** | ✅ Built | `lib/api/index.ts` switches to real Postgres-backed handlers via `NEXT_PUBLIC_USE_REAL_API`; field-perm stripping verified by test |
| **Auth & route security** | ✅ Built | HMAC session cookie + edge `middleware.ts` route/role gate; `super_admin` role |
| **Offline sync** | ✅ Built | Dexie queue → `/api/sync`, idempotent by `clientUuid`; production conflict detection + `conflict_log` |
| **Costing, sales, withdrawal** | ✅ Built | On-read cost roll-ups, batch P&L, product-driven sales |
| **Config, alerts, reports** | ✅ Built | Server-enforced worker field config; on-read/manual alert eval; jspdf reports (feature-gated) |
| **Products & enterprise templates** | ✅ Built | Per-batch products, enterprise defaults, auto-provisioning |
| **AI Advisor** | ✅ Built | OpenRouter-backed, grounded, multi-turn |
| **Commercialization** | ✅ Built | plans/features, `/admin/dashboard` |
| **PWA install / Service Worker** | ⏳ Deferred | offline queue works; installable SW background sync not added |
| **Background/cron tier, rate-limiting** | ⏳ Deferred | see §8, §10 |
| **Pilot** | Next | deploy the Docker image; worker phones; owner training; security checklist (§7) green |

---

## 13. Repository Structure (as built)
```
IFMS/
├── Frontend/                # the single full-stack Next.js app (one deployable)
│   ├── app/                 # App Router (worker/owner/manager/auditor/vet/admin)
│   │   └── api/             # Route Handlers = the server API (replaced Django)
│   ├── db/                  # Drizzle: index.ts (server-only) + schemas/index.ts
│   ├── drizzle/             # generated SQL migrations + meta
│   ├── lib/
│   │   ├── server/          # crypto, session, fieldPermissions, costing, charts,
│   │   │                    #   ai, products, productTemplates, alertEngine, reports
│   │   ├── api/index.ts     # facade: mock ↔ real (NEXT_PUBLIC_USE_REAL_API)
│   │   ├── features.ts      # plans + feature entitlements
│   │   └── ...
│   ├── components/          # incl. AIAdvisor.tsx
│   ├── middleware.ts        # edge auth/role route gate
│   ├── Dockerfile           # multi-stage, Node 22, standalone, non-root
│   ├── docker-compose.yml   # db → migrate/seed → app
│   └── DOCKER.md
└── docs/  ARCHITECTURE.md (this) · AS_BUILT.md · inception/{CONCEPT_NOTE,SRS,DESIGN,ARCHITECTURE}.md
```

---

## 14. Done vs Deferred (snapshot)
**Done (the inception migration is complete):** Django dropped; Drizzle schemas + migrations; tenant-scoped Route Handlers; PBKDF2 auth + HMAC sessions + edge route gate; server-side field-perm stripping with default-deny + CI test; the sync drain (`/api/sync`, idempotent, production conflict detection); the mock→real API switch; on-read costing/alerts/reports; products + enterprise templates; photos via `/api/photos/[id]`; OpenRouter AI Advisor; plans/features + admin dashboard; Dockerized deploy.

**Deferred (not yet built):**
- [ ] Background/cron tier: scheduled alert evaluation, reminders, heavy async reports, SMS/push dispatch, data archival.
- [ ] Login rate-limiting / lockout (needs a Redis/Upstash counter — see §8).
- [ ] Conflict detection for non-production sync types (feeding/mortality/health/closing_stock).
- [ ] PWA install + Service Worker background sync; `manifest.json` + icons.
- [ ] External photo store (R2/Supabase) + signed URLs (currently data-URL in `photos`).
- [ ] DB-level RLS as defense-in-depth; TOTP 2FA; tenant export/delete + retention policy.

---

## 15. Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Field-perm bypass → money data leaks | High | Server-side field-drop with **default-deny** on financial keys + CI test asserting forbidden keys absent (`fieldPermissions.ts`) |
| Sync duplicates / lost writes | Med | `client_uuid` PK + `onConflictDoNothing`; production conflicts logged to `conflict_log` |
| No login throttling → brute force | Med | acceptable for pilot; add rate-limiting tier before public exposure (§8) |
| On-read compute cost at scale | Med | fine at pilot scale; move alerts/reports to the deferred background tier when load grows |
| Secret in client bundle / image | Critical | only `NEXT_PUBLIC_*` shipped; `.env` not baked into the image; server env validated server-side |
| Photo bloat (data-URL in Postgres) | Med | move bytes to R2/Supabase + signed URLs (deferred) |
| Vendor lock-in | Low | standard Postgres + standard Next.js + portable Docker image |

---

## 16. Open Decisions
1. **When to add the background/cron tier** (scheduled alerts, async reports, SMS/push) — and on what (a Node worker, or the originally-planned FastAPI+Celery)?
2. **External photo store** (Cloudflare R2 vs Supabase Storage) + signed-URL minting, to replace the in-table data-URL.
3. **Login rate-limiting backend** (Redis/Upstash) — required before public exposure.
4. **TOTP 2FA for owners** — Phase 2 or sooner?
5. **SMS provider** — Africa's Talking (Kenya-native) vs Twilio — once dispatch is built.

---

*End of Architecture v3.0 (Option B), as-built 2026-06-24. A single Next.js 16 full-stack app is the product and the API; the browser holds no secret and no DB access; field-level security and tenant isolation live in the Next.js server, fronted by an edge route gate; PostgreSQL via Drizzle is the system of record; the AI Advisor calls OpenRouter; the whole thing ships as one portable Docker image. Django/DRF and the Celery/Redis worker tier are intentionally absent — the inception versions are preserved in `docs/inception/`, and `docs/AS_BUILT.md` is the full deviation list.*
