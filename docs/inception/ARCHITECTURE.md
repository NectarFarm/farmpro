# IFMS — Technical Architecture & Implementation Plan

| Field | Value |
|---|---|
| **Product** | Integrated Farm Management System (IFMS) |
| **Document type** | Technical Architecture & Implementation Plan |
| **Version** | **3.0 — Option B: Next.js full-stack (supersedes v2's Django-API design)** |
| **Status** | For development — pilot |
| **Source of truth** | SRS v1.0 · DESIGN.md v1.0 |
| **Audience** | Developers, technical co-founder, owner (Kutswa) |

---

## 0. What changed in v3.0 — and why (read first)

The frontend was built as a **single Next.js (App Router) app**, already wired for **Cloudflare Workers + Supabase Postgres via Drizzle** (`db/index.ts` is written for the Workers runtime + the Supabase transaction pooler). Rather than fight that with a separate Django API, we **consciously adopt it**: this is **Option B — Next.js is the full-stack product (UI + BFF + CRUD + auth)**.

**Consequences (decided, not accidental):**
- **Django is dropped.** Next.js Route Handlers / Server Actions are the API. There is no second CRUD backend.
- **Your Python stack survives where it earns its place:** a small **FastAPI + Celery + Redis** service remains as the **background-jobs + AI (Claude) tier** — not as a CRUD API. RabbitMQ stays deferred.
- **Security model re-homed but unchanged in principle:** the **Next.js server** now holds DB credentials and enforces tenant isolation + field-level permission stripping — exactly the role the Django serializer had in v2. The rule "no privileged secret ever reaches the browser" is unchanged and non-negotiable.

> This keeps one codebase, the team's momentum, a genuinely free + always-on + non-sleeping host (Cloudflare), and most of your stated stack wishes (FastAPI, Celery, Redis). The trade is: you run TypeScript on the product tier, Python only on the worker/AI tier.

---

## 1. Architectural Principles (ranked, unchanged)
1. **Security & privacy first** — tenant isolation + field-level permissions enforced **server-side, in code we control**; no secret reaches a client; least privilege.
2. **Start free, stay cheap, scale cleanly** — Cloudflare + Supabase + an Oracle free VM = ~$0, *and Cloudflare does not sleep*.
3. **Offline-first** — the worker app never blocks on the network (`FR-M17-*`).
4. **Something that works > something clever** — one product codebase (Next.js); Redis broker now, RabbitMQ later; AI isolated.

---

## 2. The Stack (Option B)

| Layer | Choice | Role |
|---|---|---|
| **Product (UI + API)** | **Next.js 16 (App Router)** — Route Handlers + Server Actions | The whole product surface: worker PWA, owner/manager/auditor/vet web, and the server API the clients call |
| **Server data access** | **Drizzle ORM + `postgres-js`** (`server-only`) | Typed CRUD; enforces tenant + field-level rules before any response leaves the server |
| **Database** | **PostgreSQL (Supabase, free)** via the **transaction pooler** | System of record; standard Postgres → portable, no lock-in |
| **Photos** | **Cloudflare R2** (or Supabase Storage) + **signed URLs** | Private bucket; URLs minted server-side |
| **Offline (client)** | **Dexie / IndexedDB** + Service Worker | Pending-write queue, PIN cache, app-shell offline |
| **Edge background** | **Cloudflare Cron Triggers + Queues** | Light/scheduled jobs: reminders, alert evaluation, SMS enqueue |
| **Heavy jobs + AI** | **FastAPI + Celery + Redis** on the **Oracle free VM** | Reports, aggregation/rollups, and **Claude** features; called server-to-server |
| **Broker / cache / rate-limit** | **Redis** (Upstash from the edge; local on the VM for Celery) | One service, several jobs |
| **Message broker (advanced)** | **RabbitMQ — deferred** | Only when Redis-as-broker is outgrown |
| **Hosting (product)** | **Cloudflare Workers** via `@opennextjs/cloudflare` | Free tier, global, **does not sleep** |

**Anti-patterns still avoided:** any privileged key in the client; a second CRUD backend; RabbitMQ + Redis-broker both at MVP; the AI service exposed to the public internet.

---

## 3. Target Architecture

```
┌──────────────────────────── CLIENTS (browser / installed PWA) ───────────────┐
│  Worker PWA (mobile)  ·  Owner / Manager / Auditor / Vet (web)               │
│  Dexie offline queue · Service Worker · Camera+GPS · NO secrets, NO DB creds │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ HTTPS · session/JWT cookie (httpOnly)
                ▼
┌─────────── NEXT.JS on CLOUDFLARE WORKERS  (the product + BFF) ───────────────┐
│  Route Handlers (/api/*) + Server Actions  (server-only)                     │
│   • Auth (owner password / worker PIN) · session issue/verify                │
│   • Tenant isolation (every query scoped by tenant_id)                       │
│   • Field-level permission serializer (FR-M16) ← strips fields server-side   │
│   • Business rules / costing reads (FR-M10) · validation (BR-*)              │
│   • Audit writes (append-only) · rate limiting (Upstash) · signed photo URLs │
│   • Holds ALL secrets (DB URL, R2 key, SMS, Anthropic) — never in client     │
└───────┬───────────────────────┬──────────────────────────┬──────────────────┘
        │ Drizzle (pooler,       │ enqueue (Queue / HTTP)   │ signed URL
        │ prepare:false)         ▼                          ▼
        ▼                ┌──────────────────┐       ┌────────────────────┐
┌──────────────┐        │ Cloudflare Queue │       │ Cloudflare R2      │
│ PostgreSQL   │        │ + Cron Triggers  │       │ (photos, private)  │
│ (Supabase)   │        └────────┬─────────┘       └────────────────────┘
│ RLS = DiD    │                 │ HTTP (service token)
└──────────────┘                 ▼
                       ┌─────────────────────────── ORACLE FREE VM (Docker) ──┐
                       │ FastAPI (internal-only) ──► Anthropic / Claude        │
                       │ Celery worker + beat ◄── Redis (broker/cache/result)  │
                       │ Heavy reports · nightly rollups (NFR-DATA) · AI        │
                       └────────────────────────────────────────────────────────┘
        outbound: SMS (Africa's Talking) · Push (FCM) · M-Pesa (Daraja)
```

**Hard rule (unchanged):** clients talk only to the Next.js server. No client uses Drizzle/Postgres directly and holds no secret. The Python tier is **internal-only**, reached server-to-server with a rotating token — never from the browser.

---

## 4. Where each concern lives (so nothing falls through the cracks)

| Concern | Home | Notes |
|---|---|---|
| CRUD + reads | Next.js Route Handlers / Server Actions + Drizzle | `server-only` modules; never client |
| AuthN/Z | Next.js (middleware + handlers) | owner password, worker PIN, sessions |
| **Field-level permissions** | Next.js **server serializer** | hidden fields **dropped before response** (FR-M16) |
| Tenant isolation | Next.js query layer (base `where tenant_id`) + **RLS as DiD** | app layer is the guarantee |
| Validation / business rules | Next.js handlers (`BR-*`) | withdrawal block, qty bounds, etc. |
| Light/scheduled jobs | Cloudflare Cron + Queues | reminders, alert eval, SMS enqueue |
| Heavy jobs + rollups + **AI/Claude** | **FastAPI + Celery + Redis (Oracle VM)** | called via service token |
| Audit trail | Postgres append-only `audit_log` | INSERT-only; corrections = adjusting entries |
| Secrets | Cloudflare env / VM env | never `NEXT_PUBLIC_*` |

---

## 5. Data Model & Connection Management

Schema is unchanged from **SRS §4** — now expressed as **Drizzle schemas** in `db/schemas/*.ts` (migrations via `drizzle-kit`). Core tables all carry `tenant_id`: `tenants, users, employees, worker_profiles, production_units, batches, batch_movements, inventory_items, inventory_lots, feed_formulas, feeding_records, health_records, sampling_records, mortality_records, production_records, sales, purchases, payments, tasks, task_executions, alert_rules, alerts, audit_log, conflict_log, cost_allocations`.

**RLS posture:** because the server connects with one DB role, Supabase `auth.jwt()` RLS does not auto-apply. **Primary isolation is the app layer** (every query scoped by `tenant_id`); RLS stays enabled as **defense-in-depth** (`SET LOCAL app.tenant_id` inside the request transaction — valid under the transaction pooler).

**Connection management (already correct in `db/index.ts` — keep it):**
- Use the **Supabase transaction pooler** with **`prepare: false`** and a **per-request client** (the existing code does this; it's required because Workers forbids cross-request reuse of a DB socket, and transaction pooling forbids server-side prepared statements). Do **not** add a long-lived client-side pool on top.
- On Workers there is no persistent connection budget to tune the way a VM has; the pooler absorbs concurrency. If you instead run Next.js on **Node (Oracle VM, Option B-Node)**, set `CONN_MAX_AGE`/pool size so `web workers + celery concurrency ≤ pooler ceiling`.

---

## 6. Authentication, Field-Level Security & Secrets

### 6.1 Identities & sessions
- **Owner / Manager / Auditor / Vet:** email or phone + password (Argon2id). Optional TOTP 2FA = Phase 2 `[SCOPE+]`.
- **Worker:** **phone + PIN** via a custom server check (Argon2id-hashed). No SMS-OTP on the daily path (workers are offline at dawn).
- **Sessions:** httpOnly, secure, SameSite cookies; short-lived access + rotating refresh; remote revoke; device lock/auto-logout (`FR-M19-3`).
- **Offline unlock:** first online login caches an Argon2id hash of the PIN in IndexedDB (never the PIN); subsequent dawns verify locally to unlock queued work; fresh session on next sync. *(Already prototyped in `lib/offline/db.ts` — upgrade the demo hash to real Argon2id.)*

### 6.2 Field-level permissions — must move server-side
The prototype hides fields in a client store (`workerProfile`). For production this is **layout only, not the security boundary.** Enforce in a **server serializer** in the Route Handlers:
```
loadWorkerProfile(user) → for each output field:
   visible=false → DELETE from the object before it is serialized
   editable=false → reject writes to it
```
Because dropped fields are never serialized, hidden money values **do not exist in the payload** (`FR-M16`, `NFR-SEC-2`). CI test: assert forbidden keys are absent from a worker's API response.

### 6.3 Secrets
- All secrets (`DATABASE_URL`, R2 key, SMS/M-Pesa creds, `ANTHROPIC_API_KEY`, AI service token) live in **Cloudflare/VM env only**.
- **Only `NEXT_PUBLIC_*` reach the browser** — and those must be non-sensitive (public API base, feature flags). **Fix `lib/env.ts`** so `DATABASE_URL` is validated **server-side only** and never throws in the browser bundle.
- Photos via **time-limited signed URLs** minted server-side; bucket private.

---

## 7. Security & Privacy Controls (must pass before pilot)
| Control | Implementation | SRS |
|---|---|---|
| Tenant isolation | server query layer scopes every read/write by `tenant_id`; cross-tenant test suite | `NFR-AR-1` |
| RLS defense-in-depth | enabled on all tables; `SET LOCAL app.tenant_id` per request txn | `SEC-3` |
| Field-level perms | server serializer field-drop (§6.2) — **not** client hiding | `FR-M16` |
| Secrets | server/edge env only; no secret in `NEXT_PUBLIC_*` or client bundle | `SEC-3` |
| DB access boundary | Drizzle in `server-only` modules; client cannot import it | `NFR-SEC-2` |
| Transport / at rest | TLS, HSTS, secure cookies; Postgres + R2 encryption; encrypted IndexedDB where available | `NFR-SEC-1` |
| AI isolation | FastAPI internal-only; reached by service token; never public | `SEC-3` |
| Audit | append-only `audit_log` (UPDATE/DELETE revoked at grant level); corrections = adjusting entries | `FR-M18` |
| Input safety | zod validation; file-type/size checks; image re-encode (strips active content) | `BR-*` |
| Privacy rights | tenant export (JSON/CSV) + delete with grace window; configurable photo retention | `SEC-5`, `NFR-DATA-2` |
| Real client IP | use Cloudflare `CF-Connecting-IP` for throttling/audit (no Nginx proxy header juggling on Workers) | `NFR-SEC-2` |

---

## 8. Rate Limiting (Option B)
| Tier | Mechanism | Policy |
|---|---|---|
| Edge | **Cloudflare WAF / rate-limiting rules** | coarse per-IP ceiling; bot/DDoS shield (free tier covers basics) |
| App | **Upstash Ratelimit** in Route Handlers (Redis) | reads 100/min·user · writes 30/min·user · photo 10/min·user · report-gen 5/min·user |
| Auth | Upstash counter + backoff | **login 5/min·IP + lockout** (brute-force) |
| Background | Celery rate limits + idempotency keys | no retry storms / duplicate sends |
Return `429` + `Retry-After`; client honors it with exponential backoff during sync. Identify clients by `CF-Connecting-IP` + user id.

---

## 9. Offline Sync (finish the half-built loop)
The prototype **enqueues** writes (Dexie) but does **not drain** them — `submitRecord` is defined and never called. Build the drain:
- **Write path (done):** save to Dexie with client **UUID** + `capturedAt` + `status=pending`; instant "✓ saved"; queue badge (`FR-M17-1`).
- **Drain (to build):** a sync engine flushes `pending` → `POST /api/sync` (Next.js Route Handler) in batches → marks `synced`; photos compressed (~300 KB; **GPS captured separately, not EXIF** — already correct in `CameraCapture`).
- **Idempotency:** the client UUID is the server PK → retries never duplicate; a unique-violation on resend means "already accepted" → mark synced (not a conflict) (`FR-M17-5`).
- **Conflict (true edit clash):** last-write-wins by `capturedAt`, **loser preserved in `conflict_log`** → owner resolves (the `ConflictResolver` UI exists; wire it to real conflicts) (`FR-M17-3`).
- **Triggers:** Service Worker background sync where supported; else on reconnect / app-open / pull-to-refresh.

---

## 10. Background Jobs & AI
| Task | Where | Trigger |
|---|---|---|
| Vaccination/treatment reminders | Cloudflare Cron → tasks | daily |
| Alert evaluation (mortality spike, low stock, expiry, water-quality, feed-variance) | Cloudflare Queue on write + Cron | event + periodic (`FR-M14`) |
| SMS / push dispatch | Queue consumer | event; idempotent (`INT-2/3`) |
| Cost roll-ups / aggregation read-models | **Celery beat (VM)** | nightly + on event (`NFR-DATA-1`, `FR-M10`) |
| Heavy report generation (PDF/Excel) | **Celery (VM)** | on request → notify when ready (`FR-M15`) |
| Data archival (cold storage) | **Celery beat (VM)** | scheduled (`NFR-DATA-3`) |
| **Claude AI** (advisory chat, anomaly explanation, report narration) | **FastAPI (VM)** | server-to-server from Next.js |
| Supabase keep-alive (demo) | Cloudflare Cron | avoid 7-day pause |

**AI model:** `ANTHROPIC_MODEL_ID` env var — default `claude-sonnet-4-6` (cost), `claude-opus-4-8` for hardest reasoning. Use **current** ids, not deprecated `claude-3-*`. Broker = Redis now; RabbitMQ later (a Celery config change).

---

## 11. Hosting & Cost (genuinely free, and non-sleeping)
| Component | Where | Cost | Note |
|---|---|---|---|
| Next.js product | **Cloudflare Workers** (`@opennextjs/cloudflare`) | $0 free tier | global, **does not sleep** (unlike Render/Fly free web) |
| Database | **Supabase Postgres** (pooler) | $0 (500 MB) | pauses after 7 days idle → keep-alive cron; Pro $25/mo when needed |
| Photos | **Cloudflare R2** | $0 tier | or Supabase Storage 1 GB |
| Redis | **Upstash** (edge) + Redis on VM (Celery) | $0 tiers | watch command caps |
| **Python worker + AI** | **Oracle Cloud Always-Free ARM VM** (Docker: FastAPI + Celery + Redis) | $0, always-on | ~4 ARM cores/24 GB; the one box you manage |
| RabbitMQ (later) | CloudAMQP free / on VM | $0 tier | only when adopted |

> Verify current free-tier limits before relying on them — providers change them. The design depends on none of the specific numbers, only the bill.

**Option B-Node alternative:** if you'd rather avoid the Workers runtime model entirely, run **Next.js (Node) + the Python tier together in Docker on the Oracle VM**. Fewer moving parts and a familiar runtime, but you lose Cloudflare's global edge + auto-scale and you manage the box. Recommended only if the team is uncomfortable with Workers constraints (e.g., the per-request DB client rule).

---

## 12. Implementation Plan (adjusted for Option B)
| Phase | Weeks | Deliverable |
|---|---|---|
| **0 Cleanup & foundation** | 1 | Strip AI-builder branding (`HappySeedsWatermark`, `AgentationGuard`, `agentationFeedbackMode`, rename package); fix `env.ts` (server-only `DATABASE_URL`); decide R2 vs Supabase Storage; CI + secret-scan |
| **1 Data + server API** | 2–3 | Drizzle schemas (SRS §4) + migrations; Route Handlers for CRUD with **tenant scoping + field-level serializer**; auth (owner pw, worker PIN) |
| **2 Wire screens to real API** | 4–5 | Replace `lib/mock/api.ts` with real Route Handlers behind the same interface; field-perm stripping verified by test |
| **3 Offline drain + PWA** | 6–7 | Sync engine (UUID idempotency → `/api/sync` → mark synced); **add `manifest.json` + Service Worker** (installable, app-shell offline, background sync); conflict log wired |
| **4 Costing, sales, withdrawal** | 8–9 | Cost roll-ups; per-unit margin; batch P&L; sales with withdrawal **block** (`BR-WD`) |
| **5 Config, alerts, reports** | 10–11 | Worker-portal field config (server-enforced); Cloudflare Cron/Queue alerts + SMS; reports (heavy → Celery) |
| **6 Python tier + AI** | 12–13 | FastAPI + Celery + Redis on Oracle VM; nightly rollups; Claude advisory (Phase-2 features) |
| **7 Pilot** | 14–15 | Deploy; 2–3 worker phones (installed PWA); owner training; security checklist (§7) green; baseline capture |

---

## 13. Repository Structure (monorepo)
```
ifms/
├── app/                     # Next.js App Router (worker/owner/manager/auditor/vet)
│   └── api/                 # Route Handlers = the server API (was Django)
├── db/                      # Drizzle: index.ts (server-only) + schemas/*  ← add schemas
├── lib/
│   ├── server/              # field-perm serializer, auth, tenant scoping (server-only)
│   ├── offline/             # Dexie queue + sync engine (add drain)
│   ├── stores/              # zustand (client UI state only)
│   └── ... (mock → real api)
├── public/                  # add manifest.json + icons; service worker
├── services/
│   └── ai-worker/           # Python: FastAPI + Celery + Redis (Oracle VM, Docker)
├── infra/                   # docker-compose (VM tier), wrangler.toml (Cloudflare)
└── docs/  CONCEPT_NOTE.md · SRS.md · DESIGN.md · ARCHITECTURE.md
```

---

## 14. Migration Checklist From Current Prototype
- [ ] **Strip vendor scaffolding:** `HappySeedsWatermark.tsx`, `AgentationGuard.tsx`, `lib/agentationFeedbackMode.ts`, `agentation` dep, rename `vibe-next-template`.
- [ ] **Fix `env.ts`:** validate `DATABASE_URL` server-side only; never throw in the browser.
- [ ] **Keep** `db/index.ts` as-is (correct for Workers + pooler); add `db/schemas/*`.
- [ ] **Move field-level permission enforcement** from the client store into a server serializer (§6.2) + CI test.
- [ ] **Build the sync drain** (§9) — the queue currently fills but never sends.
- [ ] **Make it a PWA:** add `manifest.json`, icons, Service Worker (install + app-shell offline + background sync).
- [ ] **Replace mock API** with Route Handlers behind the same function signatures (low churn for screens).
- [ ] **Stand up the Python tier** (FastAPI + Celery + Redis) on the Oracle VM for heavy jobs + Claude.
- [ ] Confirm photo store (R2 vs Supabase) + signed-URL minting.

---

## 15. Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| Workers runtime surprises (DB sockets, no long tasks) | Med | `db/index.ts` already handles it; heavy/long work lives on the VM, not Workers |
| Field-perm left client-side → money data leaks | High | Server serializer + CI test asserting forbidden keys absent |
| Sync drain never finished | High | Phase 3 gate; idempotent UUID writes |
| Supabase pause / 500 MB | Med | keep-alive cron; rollups/archival; Pro or self-host Postgres on VM |
| Secret in client bundle | Critical | secret-scan in CI; only `NEXT_PUBLIC_*` shipped; `env.ts` fix |
| Single VM (Python tier) SPOF | Med | acceptable for pilot; product tier (Cloudflare) stays up regardless; backups |
| Vendor lock-in | Low | Postgres + S3-compatible + standard Next.js → portable |

---

## 16. Open Decisions
1. **Workers (B2, recommended — matches what's built) vs Node-on-VM (B-Node).** Recommend Workers.
2. **Photos: Cloudflare R2 vs Supabase Storage.** Recommend R2 (same platform as the app).
3. **Supabase Postgres vs Postgres on the Oracle VM** for demo. Recommend Supabase for demo; revisit at pilot.
4. **2FA for owners** — Phase 2 or now?
5. **SMS provider** — Africa's Talking (Kenya-native, recommended) vs Twilio.

---

*End of Architecture v3.0 (Option B). Next.js is the product and the API; the browser holds no secret and no DB access; field-level security and tenant isolation live in the Next.js server; Cloudflare hosts it free and always-on; a small FastAPI + Celery + Redis tier on a free Oracle VM does the heavy jobs and the Claude AI. Django is intentionally gone; your message-broker/worker wishes live on in the AI tier. The four prototype must-fixes (sync drain, PWA, server-side field perms, strip branding) are the migration's critical path.*
