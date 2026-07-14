> **As-built revision — 2026-07-14** (supersedes the 2026-06-24 revision below — production deployment moved to Vercel+Neon, an Android APK shipped, offline reliability and rate-limiting sections were corrected, a corporate UI redesign landed, and a 7-item NFR audit (battery, iOS, backup/recovery, availability, at-rest encryption, scalability, reliability/error-tracking) was fixed and verified; see §7, §8, §9, §11–14 for the deltas). Updated to match the implemented system. The original inception version is preserved untouched at `docs/inception/ARCHITECTURE.md`. See `docs/AS_BUILT.md` for the full deviation list.

# IFMS — Technical Architecture & Implementation Plan

| Field | Value |
|---|---|
| **Product** | Integrated Farm Management System (IFMS) |
| **Document type** | Technical Architecture & Implementation Plan |
| **Version** | **3.2 — Option B: Next.js full-stack (supersedes v2's Django-API design); as-built 2026-07-14** |
| **Status** | Phase-1 built & proven — deployed to production, pilot in progress |
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
| **As-built (2026-07-14) — local storage encryption** | Worker device Dexie/IndexedDB (`pending` queue, `refCache`) encrypted with a non-extractable, device-bound **AES-256-GCM** key (`lib/offline/crypto.ts`); protects a lost/stolen locked/logged-out device, not an unlocked one | `NFR-SEC-1` |
| **As-built (2026-07-14) — error reporting** | Client error boundaries POST to `/api/errors` → `error_logs` table; no session required (works even on a broken session); `GET /api/admin/errors` is super_admin-gated | `NFR-M-1` |
| **Deferred** | DB-level RLS, image re-encode, tenant export/delete, configurable retention, Redis-backed durable rate limiting | — |

---

## 8. Rate Limiting — built (in-memory), Redis durability deferred

**As-built (2026-07-14), correcting the previous "deferred" note below:** an in-memory
token-bucket limiter (`lib/server/rateLimit.ts`) is live on every Route Handler —
`checkLoginRateLimit` (per identifier+IP) on login, `checkReadRateLimit`/
`checkWriteRateLimit` on data routes. It resets on server restart and, on Vercel, each
serverless instance holds its own buckets — a soft per-instance ceiling, not a durable
global one. That's the part that's still deferred:

| Tier | Mechanism (as built) | Policy |
|---|---|---|
| Edge | — (not added) | — |
| App | in-memory token bucket, per Node process (`lib/server/rateLimit.ts`) | reads/writes rate-limited per route; resets on restart, per-lambda on Vercel |
| Auth | in-memory counter (`checkLoginRateLimit`) | login rate-limited per identifier+IP |

**Deferred:** a Redis/Upstash-backed shared counter, so the limit holds across serverless
instances instead of per-instance — needed before public exposure at real traffic, not
before pilot. The sync client already honors `429` + `Retry-After` with exponential
backoff (`lib/offline/sync.ts`), so swapping in a durable limiter later is non-breaking.

**As-built (2026-07-14) — read caching, same per-instance caveat.** `lib/server/ttlCache.ts`
is a short-TTL (45s) in-memory cache, wired into `GET /api/dashboard/kpis` only — the
single most expensive on-read query (a full-tenant aggregation, §10). Deliberately not
cached inside `computeDashboardKPIs` itself (would break `tests/unit/costing.test.ts`'s
per-call mock setup). Same caveat as the rate limiter above: resets on cold start, not
shared across serverless instances — a soft smoothing layer, not a durable cache tier.

---

## 9. Offline Sync (as built — `app/api/sync/route.ts`)
- **Write path:** the worker app saves to Dexie with a client **UUID** + `capturedAt` + `status=pending`; instant "✓ saved"; queue badge (`FR-M17-1`).
- **Drain:** a sync engine flushes `pending` → `POST /api/sync` in batches → marks `synced`. The route lands every event in the generic `records` table and additionally routes known types (feeding, mortality, health/vaccination, closing_stock, production) into their typed tables. Mortality photos (data-URL) are stored in `photos` and linked.
- **Idempotency:** `client_uuid` is the PK on every event table; inserts use `onConflictDoNothing` → retries never duplicate; a repeat is treated as "already accepted", not a conflict (`FR-M17-5`).
- **Conflict (true edit clash) — done for production records:** production has a natural business key (one record per batch, per type, per day), so two workers logging the same day's output is a real edit conflict. It's resolved **last-write-wins by `capturedAt`**, with the loser preserved in `conflict_log` and the conflict returned to the client (`FR-M17-3`).
- **Deferred:** conflict detection for the *other* record types (feeding/mortality/health/closing_stock) is not yet built — those are idempotent-insert only.
- **As-built (2026-07-14) — read-cache + backoff + background sync:** record-form dropdowns (batches/units/items/lots) previously went empty offline since reference data was fetched live and never cached. `lib/offline/refCache.ts` is a Dexie-backed cache-through layer — network first, last-known-good served on failure, with a visible staleness banner. The flush loop backs off exponentially (30s→15min, jittered) on repeated failure instead of retrying every 30s forever, and **Background Sync API** (`public/sw.js`, progressive enhancement — not iOS/Firefox) flushes pending records even if the app is closed, alongside the existing reconnect/app-open/manual triggers.

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

**As-built (2026-07-14) — production runs on Vercel + Neon, not Docker.** The 2026-06-24
revision of this doc described Docker as the deployment story; that changed once the app
actually went to production. **Docker remains the recommended local-dev path** and a
portable self-host option, but the live system is:

| Component | Where | Note |
|---|---|---|
| Compute | **Vercel** (project linked via `.vercel/project.json`) | `vercel --prod` deploys; free/Hobby tier for pilot |
| Database | **Neon** (pooled serverless Postgres) | must use the **pooled** connection string (`-pooler` suffix) — serverless functions need connection pooling, not a direct connection |
| Config | Vercel project env vars | `SESSION_SECRET` **fails closed** in production if unset or left at the insecure dev default (checked in both `middleware.ts` and the Node-runtime session code) |
| Distribution | web (PWA, installable) + **Android APK** (Bubblewrap TWA, direct sideload — see below) | every web deploy updates the installed APK instantly, no separate release cycle unless the signing identity changes |

**Local dev / self-host (unchanged, still Dockerized).** See `Frontend/DOCKER.md`.
| Component | Where | Note |
|---|---|---|
| App | Multi-stage **`Frontend/Dockerfile`** (Node 22, Next.js **standalone**, **non-root** user) | `pnpm build` → `.next/standalone`; runs `node server.js` on `:3000` |
| Orchestration | **`Frontend/docker-compose.yml`** | `docker compose up --build`: Postgres → one-shot `migrate` (`db:migrate` + `db:seed`) → app on `:13000` |
| Database | **PostgreSQL 16** container (volume-backed) | `DATABASE_URL` via compose env |
| Portability | any container host | standard Postgres + standard Next.js → no lock-in; Vercel+Neon was chosen for zero-ops pilot hosting, not because the app requires it |

**Android APK (as-built, new).** Packaged as a **Trusted Web Activity** via Bubblewrap
(not Capacitor — no native-plugin need beyond the existing camera-capture `<input>`, and
Capacitor would need a static export the app's SSR architecture can't produce).
`public/.well-known/assetlinks.json` binds the APK's signing cert to the web origin; a
mismatch there is the #1 cause of the shell falling back to showing a browser URL bar.
`bubblewrap build` itself doesn't work in a nonstandard Android SDK layout — the working
recipe is `./gradlew assembleRelease` + manual `zipalign`/`apksigner`. Distributed by
**direct sideload** (WhatsApp/Drive link/SD card), no Play Store listing.

**Multi-tenant SaaS / feature entitlements.** `tenants.plan` (`free` / `standard` / `pro`) + `tenants.features` (jsonb) drive what each farm sees (`lib/features.ts`). `/api/me` returns the tenant's features; the owner UI gates nav, the Setup Guide, and the AI Advisor by them. A **platform-admin dashboard** (`/admin/dashboard`, super_admin only, backed by `/api/admin/tenants`) sets each farm's plan and toggles individual features.

**As-built (2026-07-14) — availability & backup.** `GET /api/health` now actually runs
`db.execute(sql`select 1`)` with a 3s timeout (503 on failure/timeout) instead of a static
200 — an uptime monitor pointed at it (e.g. UptimeRobot; not wired up, account creation is
out of scope here) will now correctly detect a Neon outage. Owner-only `GET
/api/backup/export` is a supplementary, on-demand JSON export of the tenant's 14 core
tables (excludes `passwordHash`/`pinHash`) — a safety net alongside, not a replacement for,
Neon's own point-in-time-recovery retention (verify that separately in the Neon dashboard).

> The free/always-on hosting analysis from the inception doc (Cloudflare Workers + Supabase + an Oracle VM) is **not** what shipped either — Vercel + Neon is the actual free/zero-ops pair in production, chosen for Next.js-native fit rather than the originally-analysed stack.

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
| **AI Advisor** | ✅ Built | OpenRouter-backed, grounded, multi-turn; wiring re-verified 2026-07-14 (blocked only by the tested key's account having no OpenRouter credits — not a code issue) |
| **Commercialization** | ✅ Built | plans/features, `/admin/dashboard` |
| **PWA install / Service Worker** | ✅ Built | installable manifest + maskable icons; SW registers in production; Background Sync API flushes pending records when the app is closed (progressive enhancement) |
| **Offline read-cache + sync backoff** | ✅ Built | `lib/offline/refCache.ts` (form dropdowns survive offline), exponential backoff on repeated flush failure |
| **Android APK** | ✅ Built | Bubblewrap TWA, direct sideload; every web deploy updates the installed app |
| **Corporate UI redesign** | ✅ Built | design tokens, nav drawer (fixed a real mobile-nav bug), worker desktop layout, `StatPanel`/`Table` component adoption across owner/admin |
| **Rate limiting** | ⚠️ Partial | in-memory, built (§8) — Redis-backed durability across serverless instances deferred |
| **KPI dashboard caching** | ✅ Built | 45s in-memory TTL cache on `/api/dashboard/kpis` (§8) — same per-instance caveat as rate limiting |
| **Local storage encryption** | ✅ Built | AES-256-GCM, device-bound key, Dexie `pending`/`refCache` (§7) — protects a locked/logged-out lost device only |
| **Error tracking** | ✅ Built | client boundaries → `/api/errors` → `error_logs`; `/api/admin/errors` viewer (§7) — no dedicated admin page yet |
| **Availability monitoring** | ⚠️ Partial | `/api/health` now DB-checked (§11) — external monitor not wired up |
| **Backup & recovery** | ✅ Built | owner-only `/api/backup/export` (§11) + device-side stale-outbox warning — supplementary to Neon PITR, not a replacement |
| **Background/cron tier** | ⏳ Deferred | see §10 |
| **Production deployment** | ✅ Done | Vercel + Neon, live (see §11) |
| **Pilot** | In progress | production live; APK distributed by sideload; owner training; security checklist (§7) green |

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
**Done (the inception migration is complete):** Django dropped; Drizzle schemas + migrations; tenant-scoped Route Handlers; PBKDF2 auth + HMAC sessions + edge route gate; server-side field-perm stripping with default-deny + CI test; the sync drain (`/api/sync`, idempotent, production conflict detection); the mock→real API switch; on-read costing/alerts/reports; products + enterprise templates; photos via `/api/photos/[id]`; OpenRouter AI Advisor; plans/features + admin dashboard; in-memory rate limiting (login + read/write); offline read-cache + sync backoff; installable PWA + Background Sync; **production deployment (Vercel + Neon)**; **Android APK (Bubblewrap TWA)**; **corporate UI redesign**; **batch enterprise/species classification accuracy fix**; **NFR audit remediation (2026-07-14): battery-efficient sync polling, DB-checked `/api/health`, AES-256-GCM local storage encryption, index/schema-drift correction + KPI dashboard caching, owner backup export + stale-outbox device warning, client error reporting + admin viewer**. Dockerized deploy remains available for local dev/self-host.

**Deferred (not yet built):**
- [ ] Background/cron tier: scheduled alert evaluation, reminders, heavy async reports, SMS/push dispatch, data archival.
- [ ] Redis/Upstash-backed durable rate limiting — the in-memory limiter (§8) is a soft per-instance ceiling, not a global one; fine for pilot. The new KPI TTL cache shares this caveat.
- [ ] Conflict detection for non-production sync types (feeding/mortality/health/closing_stock).
- [ ] External photo store (R2/Supabase) + signed URLs (currently data-URL in `photos`).
- [ ] DB-level RLS as defense-in-depth; TOTP 2FA; tenant export/delete + retention policy.
- [ ] Dark mode: token infrastructure wired (`next-themes`, `.dark` CSS) but pinned to light — most page markup doesn't yet use the tokens that would respond to it.
- [ ] iOS device testing (code-audited only, never run on a physical device/simulator); an external uptime monitor wired to `/api/health`; a dedicated admin UI page for `/api/admin/errors`.

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
3. **Durable rate-limiting backend** (Redis/Upstash) — the in-memory limiter is live but per-instance; a shared counter is required before public exposure at scale.
4. **TOTP 2FA for owners** — Phase 2 or sooner?
5. **SMS provider** — Africa's Talking (Kenya-native) vs Twilio — once dispatch is built.

---

*End of Architecture v3.2 (Option B), as-built 2026-07-14 (supersedes the 2026-06-24 revision — see the §7/§8/§9/§11–14 as-built notes above for what changed, including the 2026-07-14 NFR audit remediation). A single Next.js 16 full-stack app is the product and the API; the browser holds no secret and no DB access; field-level security and tenant isolation live in the Next.js server, fronted by an edge route gate; PostgreSQL via Drizzle (hosted on Neon) is the system of record; the AI Advisor calls OpenRouter; the app deploys to Vercel in production and ships as a portable Docker image for local dev/self-host, plus a Bubblewrap-packaged Android APK distributed by direct sideload. Django/DRF and the Celery/Redis worker tier are intentionally absent — the inception versions are preserved in `docs/inception/`, and `docs/AS_BUILT.md` is the full deviation list.*
