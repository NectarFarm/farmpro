# IFMS — As-Built Notes & Deviations from the Original Specs

**Status:** Phase-1 implementation built and proven (Next.js full-stack) — deployed to
production, packaged as a sideloadable Android APK, carrying a full corporate UI
redesign, and hardened against a university-style NFR checklist audit (battery,
compatibility, backup/recovery, availability, security-at-rest, scalability,
reliability — §21) as of this revision.
**Last updated:** 2026-07-14 (previous revision: 2026-06-24).

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

## 10. Rate limiting — correction to the original as-built note

The 2026-06-24 revision of this doc said login rate-limiting was "not yet built." That was
wrong at the time this revision was written: an **in-memory token-bucket limiter**
(`lib/server/rateLimit.ts`) is wired into login (`checkLoginRateLimit`, per identifier+IP)
and every read/write Route Handler (`checkReadRateLimit`/`checkWriteRateLimit`). It resets
on server restart and is **per-lambda on Vercel** (each serverless instance has its own
bucket, so it's a soft ceiling rather than a durable global one) — acceptable for pilot
scale, but a Redis/Upstash-backed shared counter is still the right upgrade before public
exposure at higher traffic. See §11–17 below for everything built since 2026-06-24.

## 11. Offline reliability hardening

- **Offline read-cache** (`lib/offline/refCache.ts`): worker record-form dropdowns
  (batches/units/items/lots/tasks/products) previously went **empty offline** — reference
  data was fetched live and the Service Worker didn't cache `/api/*`. Now a Dexie-backed
  cache-through wrapper serves last-known-good data when the network fails, with a visible
  **stale-data banner** (`components/worker/StaleDataNotice.tsx`) showing how old it is.
  Warmed on app load and after every successful sync flush.
- **Sync retry backoff** (`lib/offline/sync.ts`): the flush loop previously retried a failed
  batch every 30s forever. It now backs off exponentially (30s → 15min cap, jittered) on
  failure and resets immediately on `online`/success, with 401 (session expired) and
  400/422 (schema-rejected, capped at 3 attempts → `rejected`) handled distinctly from
  ordinary transient network failures (which retry indefinitely under the backoff cap).
- **Background Sync API** (`public/sw.js`, progressive enhancement): pending records now
  flush even if the app is closed, on browsers that support it (not iOS/Firefox — the
  in-app interval remains the primary path there). Raw IndexedDB in the Service Worker
  (no Dexie, no version arg on `indexedDB.open` — avoids upgrade races with the page).

## 12. Mobile/PWA polish, stability & installability

- **Safe-area handling**: bottom nav/tab bars and sticky headers respect
  `env(safe-area-inset-*)` — previously the worker bottom tab bar sat under the Android
  gesture bar. `viewport-fit: cover` set; the previous `maximumScale: 1` (which blocked
  pinch-zoom, a WCAG 1.4.4 violation) was removed.
- **Touch fixes**: the batch-detail "Manage" menu was hover-only (unusable on touch) →
  click-toggled Radix dropdown; sub-44px touch targets brought up to 44px; clipped tables
  (`overflow-hidden`) fixed to `overflow-x-auto` across 7 owner list pages.
- **Bundle size**: `recharts` was statically imported on 3 dashboard-adjacent routes
  (~100KB gz each) — now `next/dynamic` with `ssr:false` and a skeleton loader.
- **Stability**: added `app/global-error.tsx` (renders its own `<html>/<body>`, inline
  styles only, since `globals.css` isn't loaded when the root layout itself crashes) and
  `app/error.tsx` (segment boundary — a page crash keeps nav alive). Both lead with
  plain-language reassurance ("your saved records are safe on this phone") before any
  technical detail, in English and Swahili.
- **PWA is now genuinely installable**: `public/manifest.json` (maskable + regular icons,
  split by `purpose`), `public/apple-touch-icon.png`, Service Worker registers in
  production builds only (`components/PWARegister.tsx`) — this closes out what the
  2026-06-24 revision listed as "PWA install / Service Worker — deferred."

## 13. Production deployment — Vercel + Neon (supersedes Docker-as-primary)

The as-built architecture through 2026-06-24 described Docker as the deployment story.
**The system now actually runs on Vercel (compute) + Neon (pooled serverless Postgres)** —
free-tier, zero-ops hosting suited to a pilot. Docker (`Frontend/Dockerfile` +
`docker-compose.yml`) still works and remains the recommended **local dev** path and a
portable option for self-hosting, but it is not what's deployed today.
- `vercel --prod` deploys; the project is linked (`.vercel/project.json`).
- Neon's **pooled** connection string (`-pooler` suffix) is required — serverless functions
  need connection pooling, not a direct Postgres connection.
- `SESSION_SECRET` **fails closed** in production if unset or left at the insecure dev
  default (`middleware.ts` and the Node-runtime session code both check this).
- Known pilot-grade limitation carried over from §10 above: the in-memory rate limiter is
  per-lambda on Vercel, not a durable global limit.

## 14. Android APK — Bubblewrap TWA, direct sideload

Packaged as a **Trusted Web Activity** (not Capacitor — the app has no native-plugin needs
the camera-capture `<input>` doesn't already cover, and Capacitor would need a static
export the app's SSR/route-handler architecture can't produce). Every web deploy updates
the installed app instantly; there's no separate APK release cycle except when the
assetlinks/signing identity itself changes.
- Build recipe: `bubblewrap init --manifest https://<domain>/manifest.json` →
  `./gradlew assembleRelease` + manual `zipalign`/`apksigner` (the `bubblewrap build`
  CLI command itself doesn't work in a nonstandard Android SDK layout — this is a known,
  documented workaround, not a design choice).
- `public/.well-known/assetlinks.json` binds the APK's signing certificate to the web
  origin; a keystore mismatch here is the #1 cause of the TWA falling back to a browser
  chrome (URL bar visible) instead of opening full-screen.
- **Distribution: direct sideload** (WhatsApp/Drive link/SD card) — no Play Store listing.
  Requires Chrome on-device (default on Tecno/Infinix) and "install unknown apps" enabled
  once for the sharing app.

## 15. Production bug fixes (post-launch, real user reports)

- **`useTranslation()`'s `t()` was unmemoized** — any `useEffect` depending on `t` re-fired
  every render, silently resetting component state. This was the root cause of two real
  reported bugs: Morning Round "can't select options" (reported by a real farm owner) and
  a related worker-record-page state-reset class of bug. Fixed with `useCallback`.
- **`useDraggableFab`** (the shared floating-button positioning hook behind
  AIAdvisor/SetupGuide/TestingGuide) only re-clamped a dragged position to the viewport on
  `resize` — a position saved on one device/orientation could render off-screen or
  overlapping another element on a different screen. Now clamps on initial load too.
- **Payroll reliability audit**: gross pay-as-expense now correctly links to the batch it's
  assigned to (feeds break-even/costing), Reports date-range filtering uses real
  period-overlap logic (was a since-removed day-proration formula that silently produced
  wrong totals), and Reports gained a per-production-unit filter with a unit-level
  breakdown.
- **Report/PDF quality**: letterhead, ruled totals, formatted numbers, per-farm branding
  (farm name replaces "IFMS" throughout worker portal + reports once a farm sets its own
  branding).
- **Auth hydration race** (found and fixed during the UI-revamp visual-verification pass,
  §16): four pages (owner dashboard, worker home, worker profile, vet units) checked
  `!user` before Zustand's persisted session finished rehydrating from `localStorage`,
  bouncing an already-logged-in user back to the login screen on every hard refresh or
  deep link. Fixed by gating the redirect on a `hasHydrated` flag with a 3s grace-period
  fallback (matches the pattern already used correctly on the root splash page).

## 16. UI/UX corporate redesign (worker + owner + admin, mobile + desktop)

Triggered by direct user feedback that the UI "looks like other AI stuff" — generic,
templated. Reworked across five phases, keeping the existing green identity (deepened/
desaturated for a more institutional feel) rather than replacing it, per explicit
direction that layout/navigation/wording matter more than color:
- **Design tokens**: `app/globals.css`'s existing-but-unused shadcn oklch token system
  (`--primary`, new `--success`/`--warning`/`--brand-accent`) now actually drives the
  green identity, replacing ~150 hardcoded `bg-green-*` occurrences across owner/admin.
  `next-themes` is wired but pinned to light for now (see §17 risk note below).
- **Navigation — fixed a real bug**: the owner mobile bottom-nav hard-cut to
  `navItems.slice(0, 6)`, silently dropping 5 of 11 nav items with no indication more
  existed. Replaced with a grouped drawer (`components/layout/NavDrawer.tsx`, on the
  existing shadcn `Sheet`) — all items reachable, grouped by function (Overview / Farm /
  Money & People / Records / Setup). Applied to admin too, before it independently hits
  the same failure mode once it grows past 5 items.
- **Worker portal** got a **real, distinct desktop layout** (persistent sidebar, wider
  tile grid, centered forms) for the first time, added without touching the offline-sync
  wiring (`useSync()`, the online/offline listener, `warmRefCache()`) — that logic stays
  mounted exactly once in `app/worker/layout.tsx` regardless of viewport. Worker record
  types are now grouped by real operational cadence (Every day / As needed / Stock
  counts) instead of an arbitrary flat list, on both the record menu and home screen.
  A new `components/worker/RecordPageShell.tsx` de-duplicates the hero-header and
  "saved, will sync" success-screen markup that was hand-copied across all 8 record pages.
- **Owner/admin**: hand-rolled KPI-card grids replaced with a shared `StatPanel`
  component (hairline border, small ink badge instead of a pastel icon-circle, tabular
  numerals); 13 raw `<table>` occurrences across 11 files replaced with the
  already-installed-but-unused shadcn `Table` primitives.
- **Verification**: since claude-in-chrome isn't connected in this environment, a small
  CDP-based headless-Chrome screenshot harness was built ad hoc for this pass (log in via
  the real API + inject the zustand-persist localStorage shape, navigate, screenshot at
  phone/desktop widths) — this is a one-off verification tool, not part of the shipped app.

## 17. Batch enterprise/species classification — accuracy fix

The batch-creation enterprise picker (12 tiles: layers/broilers/pigs/fish/goats/dairy/
ducks/rabbits/bees/maize) auto-filled the batch's `species` field from **the first word
of the tile's marketing description** (e.g. "Eggs + manure + spent hen" → `"eggs"`) rather
than an actual species value. Since every downstream consumer (costing/margin, lifecycle
auto-advance, the alert engine, default live-weight for weight-based sales) resolved
"which enterprise is this batch" by regex-matching `species` text
(`enterpriseFromSpecies()`), this silently broke **6 of the 12 enterprise types** (Layers,
Broilers, Goats, Dairy, Rabbits, Maize all resolved to `null`) and **misclassified Tilapia
as Catfish** (both derived to `"fish"` — Tilapia batches got Catfish's live-weight default,
1.0kg vs the correct 0.4kg, a 2.5× error feeding into any weight-based sale cap).

Fixed at the root rather than patched at the picker:
- **New `batches.enterprise` column** (migration `0035_batches_enterprise.sql`, nullable)
  — the enterprise is now persisted directly from the picker at creation time instead of
  being re-guessed later from free text.
- **`resolveEnterprise(batch)`** (`lib/server/productTemplates.ts`) is now the single
  resolution path everywhere enterprise was previously inferred from species text
  (`costing.ts`, `alertEngine.ts`, the lifecycle and lifecycle-due routes, the live-weight
  default) — it prefers the persisted column, falling back to the old text-matching only
  for batches created before this column existed.
- Each picker tile now carries an explicit, correct `defaultSpecies` value instead of a
  derived one, and the picker itself is grouped by animal family (Poultry / Fish /
  Livestock / Other) instead of one flat 12-tile grid.
- Verified end-to-end against the real database (not just unit-level): created and
  inspected test batches for the three worst-affected cases (Layers, Goats, Tilapia),
  confirmed correct `enterprise`, `avg_weight_kg`, and auto-provisioned product templates,
  then removed the test data.

## 18. Farm dashboard layout

The Farm page (`/owner/farm`) required significant scrolling before showing any real
content: a 5-button action row wrapped across 2–3 lines on mobile before the units heatmap
(the actual "is anything wrong" glance-view) even started. Action row is now a single row
(primary "+ Add Batch" first, others in a horizontally-scrolling strip on mobile instead of
wrapping), the subtitle line is hidden below `sm:`, and the units grid is slightly denser.
Net effect on a 390px-wide phone: roughly 6–7 full unit cards visible without scrolling,
versus needing an immediate scroll before. (Full-page zero-scroll was considered and
rejected as a goal — see the design discussion this revision is based on: forcing an
11-unit heatmap + a full batch table onto one no-scroll screen on a small phone would mean
either illegible tiles or hiding real data, neither better than a normal scroll. The fix
targets *what's above the fold*, not eliminating scrolling.)

## 19. AI Advisor — status note

The OpenRouter integration (`lib/server/ai.ts`, §6 above) was tested end-to-end during
this revision: login → `/api/ai/advise` → OpenRouter, with a real (user-supplied) key.
The integration itself is correct — auth succeeds, the request reaches OpenRouter, and the
response is parsed correctly. The specific key tested had **zero purchased credits** on
its OpenRouter account, which needs the account topped up
(https://openrouter.ai/settings/credits) — not a code issue. Added a distinct error
message for the 402 (insufficient credits) case so this is diagnosable from the UI without
reading server logs next time.

## 20. NFR checklist audit & remediation (2026-07-14)

A university-style NFR checklist (Usability, Performance, Offline Capability,
Reliability, Security, RBAC, Scalability, Availability, Compatibility,
Maintainability, Battery Efficiency, Data Integrity, Backup and Recovery,
Accessibility, Network Efficiency) was checked against the **actual code**, not
the docs. Most items held up; seven had real, confirmed gaps. All seven were
fixed and verified this revision — hosting stayed on Neon, no infra migration.

- **Battery Efficiency** — `lib/offline/sync.ts`'s poll loop called a local Dexie
  `getPendingCount()` read every 30s tick even while exponential backoff had
  already suppressed the actual network flush attempt. Every worker record page
  already calls `setPendingCount` itself right after enqueueing, so the badge
  doesn't go stale from skipping this redundant read during the backoff window.
  GPS (one-shot `getCurrentPosition`) and camera (native `<input capture>`, no
  `getUserMedia`/`MediaStream`) were already efficient — no changes needed there.
- **Compatibility (iOS)** — audited the GPS/camera/PWA code paths; found no
  blocking iOS Safari API. **Not device-tested** — this is documented honestly
  as "code-audited, no known blocker" rather than "iOS verified," since no
  physical iOS device or simulator was available to confirm.
- **Backup and Recovery** — two gaps, both closed:
  - **Server-side:** owner-only `GET /api/backup/export` (`app/api/backup/export/route.ts`),
    a JSON download of the tenant's 14 core business tables (users minus
    `passwordHash`/`pinHash` — see note below, workerProfiles, employees,
    payslips, employeeLedger, productionUnits, batches, batchStageEvents,
    inventoryItems, inventoryLots, tasks, sales, purchases, records). A
    "Download backup" button lives in Owner → Config. This is a
    **supplementary** safety net, not a substitute for Neon's own
    point-in-time-recovery retention — the owner should separately verify that
    in the Neon dashboard, which isn't something this app can check or
    configure without account access.
  - **Device-side:** `SyncBadge` now surfaces a distinct warning when the
    oldest still-unsynced record exceeds 24h old, prompting the worker to
    reconnect before a lost/destroyed device would mean losing that data for
    good (`lib/stores/sync.ts`'s `oldestPendingCapturedAt`, computed in
    `lib/offline/sync.ts`'s `useSync()`).
  - **Security note found during implementation:** the first version of the
    backup export used `db.select().from(users)` unfiltered, which included
    `passwordHash`/`pinHash`. Caught before shipping and fixed to select an
    explicit column list — a downloaded file is far more likely to end up
    somewhere insecure (email, USB, personal cloud drive) than the database
    itself, and worker PINs are low-entropy enough to be crackable offline
    from a leaked hash even at 100k PBKDF2 iterations.
- **Availability** — `/api/health` was previously a static 200 with no DB
  check, so it would report "healthy" even with Neon unreachable. It now runs
  `db.execute(sql`select 1`)` with a 3s timeout, returning 503 on failure or
  timeout. Wiring a free external monitor (e.g. UptimeRobot) against this
  endpoint is documented as a next step, not implemented — creating a
  third-party monitoring account is outside what this pass could do.
- **Security — local storage encryption** — Dexie/IndexedDB on the worker's
  device (queued records, cached reference data) was plaintext, readable by
  anyone who could inspect the device's browser profile (e.g. a lost/stolen
  phone plugged into a PC). New `lib/offline/crypto.ts`: one **AES-256-GCM**
  key per device, `crypto.subtle.generateKey(..., false /* non-extractable */,
  ...)`, stored directly as a `CryptoKey` object in a new Dexie `keyStore`
  table (IndexedDB natively structured-clones `CryptoKey`) — **not**
  PIN-derived, because the worker's session (zustand-persist) never re-prompts
  for the PIN after first login, so a PIN-derived in-memory-only key would be
  lost on every routine background-kill/reload. New writes to `pending` and
  `refCache` encrypt going forward (`enc: 1` flag); pre-existing plaintext
  rows are read via a legacy fallback path, no backfill migration.
  **Threat model, stated plainly:** this protects a lost/stolen device that's
  locked or logged out — it does **not** and cannot protect a device that's
  unlocked and already logged in, since the running page can call decrypt
  itself at that point, same as any client-side scheme.
  **Bug caught during real-device verification (not by `pnpm build` or the
  test suite):** the first implementation used `await import('./crypto')`
  (dynamic import) inside `enqueuePendingRecord`. A dynamic import is a
  separate on-demand chunk that Turbopack/webpack fetches **over the
  network** the first time it's called — which silently broke offline record
  submission (the worker got "Couldn't save — please try again" on every
  offline attempt) even though the same module was already loaded elsewhere
  on the page. Fixed by making both `db.ts`'s and `sync.ts`'s imports of
  `crypto.ts` static; the resulting `db.ts`↔`crypto.ts` circular import is
  safe because both sides only touch the imported binding inside function
  bodies, never at module-init time. Found via a real headless-browser test
  (Playwright + a cached Chromium binary, since no interactive browser was
  available): logged in as a worker, went offline, submitted a mortality
  record, inspected IndexedDB directly to confirm an `{iv, ct}` envelope with
  `enc: 1` (no plaintext field names visible), went back online and confirmed
  it synced, and separately confirmed a manually-inserted legacy plaintext
  row still reads and syncs correctly — proving backward compatibility.
- **Scalability** — two parts:
  - `db/schemas/index.ts` had **zero** `index()` declarations despite ~36
    indexes already existing in Postgres via earlier raw-SQL migrations
    (`0022`, `0026`) — a real schema/DB drift that would make future
    `drizzle-kit generate` runs blind to them. Migration `0036_*` mirrors them
    all in verbatim (patched with `IF NOT EXISTS` since drizzle-kit doesn't
    know they already exist), adds the one genuinely missing one
    (`healthRecords (tenant_id, captured_at)` — every sibling table had this,
    health didn't), and `tasks (tenant_id, due_at)`.
  - New `lib/server/ttlCache.ts` — a short-TTL (45s) in-memory cache, wired
    into `app/api/dashboard/kpis/route.ts` only (the single most expensive
    on-read query, a full-tenant aggregation). Deliberately **not** cached
    inside `computeDashboardKPIs` itself — that would break
    `tests/unit/costing.test.ts`'s per-call mock setup. Same per-instance
    caveat as the existing rate limiter (`lib/server/rateLimit.ts`): resets on
    cold start, not shared across serverless instances — stated, not hidden.
- **Reliability — error tracking** — errors were caught (error boundaries
  existed) but never reported anywhere beyond `console.error`. New
  `lib/errorReporter.ts` (client-side, best-effort, never throws) wired into
  all 7 error boundaries (`app/{global-error,error}.tsx` and the 5
  section-level ones: `app/{worker,owner,admin,manager,auditor}/error.tsx`).
  Reports POST to `app/api/errors/route.ts` — new `error_logs` table,
  IP-rate-limited via the existing `writeRateLimited`, **deliberately no
  session required**: a broken/expired session is exactly one of the
  situations this needs to keep working in. `GET /api/admin/errors`
  (super_admin-gated) is a route-only viewer this pass — most-recent-first,
  capped at 200 rows, no dedicated UI page yet.

All seven fixes were verified with the same discipline used elsewhere in this
project: `pnpm build` after each phase, `pnpm test:ci` (the pre-existing 7
rate-limit-related integration-test failures reproduce on an unmodified tree
too — not a regression, confirmed by running the same suite before and after
this pass with a freshly-restarted dev server each time), direct `curl`
verification of every new route against a running dev server (health,
owner-only 403 for manager on `/api/backup/export`, KPI cache hit timing,
error POST → `/api/admin/errors` roundtrip), and — for encryption, which has
no automated Dexie test harness in this repo — a real headless-browser
end-to-end pass as described above.

## 21. Still deferred (not yet built)

- Scheduled/background tier (Celery/FastAPI equivalent): cron alert evaluation, heavy async report generation.
- Redis/Upstash-backed durable rate limiting (the in-memory limiter in §10 above is a soft, per-instance ceiling — fine for pilot, not for scale). The new §20 TTL cache and error-rate-limiting share the same per-instance caveat.
- Conflict detection for non-production sync record types (production is done).
- Dark mode: the token infrastructure is wired (`next-themes`, `.dark` CSS) but pinned to light — most page markup still hardcodes light-mode Tailwind classes (`bg-white`, `text-gray-900`) rather than the tokens that would respond to `.dark`. Flipping the default before that coverage lands would mix correctly-dark shadcn primitives against still-light page content.
- iOS device testing (§20) — code-audited only, never run on a physical iOS device or simulator.
- Wiring an external uptime monitor (e.g. UptimeRobot) against `/api/health` (§20) — the endpoint is ready, the account/wiring isn't.
- A dedicated admin UI page for `/api/admin/errors` (§20) — route exists, super_admin-gated, no page built yet.
