> **As-built revision — 2026-06-24.** Updated to match the implemented system. The original inception version is preserved untouched at `docs/inception/SRS.md`. See `docs/AS_BUILT.md` for the full deviation list.

# Software Requirements Specification (SRS)
## Integrated Farm Management System (IFMS)
### A Mobile-First, Offline-Capable Operating System for Diversified Farms

| Field | Value |
|---|---|
| **Product** | Integrated Farm Management System (IFMS) |
| **Document type** | Software Requirements Specification |
| **Version** | 1.1 (As-built) |
| **Owner** | Kutswa |
| **Date** | June 2026 (as-built revision 2026-06-24) |
| **Status** | Phase-1 built & proven — pilot release |
| **Audience** | Engineering, product, pilot farm, investors/technical due-diligence |

> **How to read this document.** Every requirement has a stable ID (`FR-xx-nn` functional, `NFR-xx` non-functional, `BR-nn` business rule). IDs never change once assigned — they are referenced by tests, the traceability matrix (§16), and the release plan (§12). Priority uses **MoSCoW**: **M**ust (MVP), **S**hould, **C**ould, **W**on't-yet (backlog).

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the complete functional and non-functional requirements for IFMS: a dual-portal (owner + worker) platform that captures the entire production ecocycle of a diversified farm — poultry, pigs, fish, and crops — and converts day-to-day field activity into structured data, real-time operational control, per-unit profitability, and audit-grade records.

### 1.2 Scope
IFMS will:
- Model a farm as a hierarchy of **production units** holding **batches** of animals or crops, each moving through a defined **lifecycle**.
- Let field workers record daily activity (feeding, mortality, production, health, sampling) in **under two minutes per task**, **fully offline**.
- Give owners a configurable control plane: dashboards, **per-unit costing**, alerts, reporting, and **granular control over exactly what each worker can see and enter**.
- Compute the performance and financial metrics that make a farm efficient to run and **fundable** (FCR, ADG, mortality, gross margin, cost of production).
- Operate as a **multi-tenant SaaS** so it scales from one founder's farm to thousands of farms.

**Out of scope (v1):** accounting-grade general ledger / tax filing, payroll processing, IoT sensor hardware, e-commerce marketplace. Hooks for these are specified (§9) but not built in v1.

### 1.3 Definitions, acronyms, glossary
Full glossary in §15. Key terms: **Batch/Cohort**, **Production Unit**, **FCR** (Feed Conversion Ratio), **ADG** (Average Daily Gain), **Hen-Day %**, **Withdrawal Period**, **Tenant**, **Biological Asset**.

### 1.4 References
- IEEE 830 (SRS structure, adapted).
- Domain practice: poultry brooding/laying programs, pig breeding cycles, tilapia/catfish pond management, smallholder crop agronomy.
- Kenyan context: mobile-money (M-Pesa) ubiquity, intermittent rural connectivity, English/Swahili bilingual workforce.

### 1.5 Document overview
§2 overall description and users; §3 architecture; §4 domain model & data dictionary (the heart of the system); §5 functional requirements by module; §6 end-to-end workflows; §7 business rules; §8 non-functional requirements; §9 integrations; §10 KPI/report catalog with formulas; §11 security; §12 release plan; §13 acceptance criteria; §14 risks; §15 glossary; §16 traceability.

---

## 2. Overall Description

### 2.1 Product perspective
IFMS is a greenfield, cloud-backed, offline-first system. It is **data-model-first**: the farm is not modeled as "chickens and pigs" but as generic *production units* and *batches* with *species-specific extensions*, so a new species (goats, cattle, bees, rabbits) or a new crop is added by **configuration, not re-engineering**.

### 2.2 User classes
| Role | Description | Primary device | Core need |
|---|---|---|---|
| **Owner / Admin** | Owns the farm tenant; full control | Web + mobile | Decide, cost, fund, configure |
| **Manager** (optional) | Delegated operations; no financial visibility by default | Web + mobile | Run operations, assign tasks |
| **Worker** | Field staff; sees only what owner exposes | Mobile (Android-first), low-end | Record fast, offline, reliably |
| **Veterinarian / Agronomist** (external, optional) | Read + advise on health/agronomy records for assigned units | Mobile/web | Diagnose remotely, prescribe |
| **Investor / Auditor** (read-only, time-boxed) | Scoped, read-only access to reports | Web | Verify performance & integrity |
| **Platform Super-Admin** (`super_admin`) | IFMS operator (us) | Web | Tenant lifecycle, plan/feature management, support |

### 2.3 Operating environment
- Worker app: Android 7.0+, low-RAM devices, **PWA + offline store**, camera + GPS.
- Owner web: evergreen browsers.
- Backend: cloud API, regional data residency where possible.
- Network: assume **frequent disconnection**; the field experience must never depend on live connectivity.

### 2.4 Constraints
- Bandwidth/data cost sensitivity → photos compressed client-side; sync is delta-based.
- Low digital literacy among some workers → icon-led, bilingual (EN/SW), minimal typing, large tap targets.
- Devices are shared and lost → no sensitive data cached unencrypted; PIN/biometric lock.

### 2.5 Assumptions & dependencies
- Each worker has (or shares) an Android phone.
- Mobile-money (M-Pesa/Daraja) available for sale/expense capture and, later, subscription billing.
- SMS gateway available for alerts to feature phones / offline owners.
- One farm = one tenant in v1; multi-farm-per-owner supported in data model, surfaced later.

---

## 3. System Architecture (informative)

```
┌────────────────────────────────────────────────────────────────────┐
│ CLIENTS                                                            │
│  Worker PWA (offline-first, local encrypted store)  Owner Web/PWA  │
│            │  delta sync (queue + conflict resolve)        │       │
└────────────┼───────────────────────────────────────────────┼──────┘
             ▼                                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ API GATEWAY  (auth, rate-limit, tenant routing, audit tap)        │
├────────────────────────────────────────────────────────────────────┤
│ DOMAIN SERVICES                                                    │
│  Farm/Org · Batch-Lifecycle · Inventory/Feed · Health · Sampling   │
│  Production · Mortality · Costing-Engine · Sales · Procurement      │
│  Tasks/Labor · Alerts-Engine · Reporting/Analytics · Config/Perms   │
├────────────────────────────────────────────────────────────────────┤
│ PLATFORM  Sync · Audit-Log · Notification(SMS/Push/Email) · Files   │
├────────────────────────────────────────────────────────────────────┤
│ DATA  Multi-tenant DB (row-level tenant isolation) · Object store  │
│       (photos) · Event log (append-only) · Read-model/analytics     │
└────────────────────────────────────────────────────────────────────┘
   Integrations: M-Pesa(Daraja) · SMS gateway · Weather · Market price
```

**Architectural requirements**
- `NFR-AR-1` (M) Every persisted row carries `tenant_id`; isolation enforced at the data layer (row-level), not just app layer.
- `NFR-AR-2` (M) All state-changing operations emit an **append-only audit event** (`who, what, when, before→after, device, geo, online/offline`).
- `NFR-AR-3` (S) Read models for dashboards/reports are derived from the event/transaction store so analytics never block operational writes.

> **As-built (2026-06-24).** The system was implemented as **"Option B": a single Next.js 16 (App Router) full-stack app** in `Frontend/` rather than the Django/DRF + Celery + separate-frontend split drawn above. UI, API route handlers, auth, costing, alerts, and reporting are one deployable. Persistence is **PostgreSQL via Drizzle ORM** (`Frontend/db/schemas/`, migrations in `Frontend/drizzle/`). The **API-gateway concerns** (auth, tenant routing, role gating, audit) are realised as **edge middleware** (`Frontend/middleware.ts`) plus per-route session checks. The **separate read-model/analytics tier (`NFR-AR-3`) is not yet a materialised store**: dashboards, costing and alert evaluation are computed **on-read / on-demand** (e.g. costing when a batch is viewed, `POST /api/alerts/evaluate`), which covers pilot scale. The **scheduled/background tier** (cron alert evaluation, heavy async report generation) and **API rate-limiting** are **deferred** (see §8, §11). Deployment is Dockerised (`Frontend/Dockerfile`, `docker-compose.yml`).

---

## 4. Domain Model & Data Dictionary

> This is the most important section. Workflows are disposable; the model is forever. The draft modeled records; this model adds **lifecycle, breeding, sampling, costing, traceability, and food-safety** — the things a *powerful* system needs from day one.

### 4.1 Entity map

```
TENANT (Owner account)
 └─ FARM
     ├─ SITE/ZONE
     │   └─ PRODUCTION UNIT  {type: CAGE|PEN|HOUSE|POND|TANK|PLOT}
     │         └─ BATCH (cohort)  ──┬─ split/merge ─┐
     │               ├─ ANIMAL (optional, high-value: sows, boars, breeders)
     │               ├─ STAGE TRANSITION (brooding→grow→lay/finish→cull/harvest)
     │               ├─ FEEDING RECORD ─────────────► consumes INVENTORY LOT
     │               ├─ HEALTH/TREATMENT RECORD ─────► consumes INVENTORY LOT, sets WITHDRAWAL
     │               ├─ SAMPLING RECORD (weight / count / water quality)
     │               ├─ PRODUCTION RECORD (eggs/meat/fish/crop)
     │               ├─ MORTALITY/CULL RECORD (+photo, +recorder)
     │               └─ ENVIRONMENT READING (temp/humidity/DO/pH/ammonia)
     │
     ├─ BREEDING (pigs/poultry): SERVICE → GESTATION → FARROW/HATCH → WEAN
     │
     INVENTORY
      ├─ ITEM {FEED_FINISHED|FEED_INGREDIENT|MED|VACCINE|SEED|FERTILIZER|PESTICIDE|EQUIPMENT|CONSUMABLE}
      ├─ LOT (FIFO, batch no., expiry, unit cost)        ← traceability
      └─ FEED FORMULA (recipe: ingredients → finished feed, with target nutrition)
     FINANCE
      ├─ EXPENSE / PURCHASE (→ links to LOT and/or BATCH/UNIT)
      ├─ SALE / SALES ORDER (→ links to BATCH/UNIT, CUSTOMER, PAYMENT)
      ├─ PAYMENT (cash / M-Pesa / credit)
      ├─ LABOR COST (task hours × rate, allocated to BATCH/UNIT)
      └─ COST ALLOCATION (engine output: rolled-up cost per BATCH/UNIT)
     PEOPLE
      ├─ USER / ROLE / PERMISSION SET
      ├─ EMPLOYEE (HR-light: rate, attendance)
      └─ CUSTOMER / SUPPLIER
     CONFIG
      ├─ WORKER PORTAL PROFILE (field visibility, required fields, thresholds)
      ├─ ALERT RULE
      └─ TASK TEMPLATE / SCHEDULE
```

### 4.2 Core entities — data dictionary (selected, abbreviated)

**PRODUCTION UNIT**
| Attr | Type | Notes |
|---|---|---|
| id, tenant_id, farm_id, zone_id | id | |
| type | enum | CAGE, PEN, HOUSE, POND, TANK, PLOT |
| name/code | string | human + scannable (QR optional) |
| capacity | number | max animals / area (m² or acres for plots) |
| status | enum | ACTIVE, EMPTY, CLEANING, QUARANTINE, OUT_OF_SERVICE |
| attributes | json | species-specific (pond volume, house floor type…) |

**BATCH (COHORT)** — the costing & performance anchor
| Attr | Type | Notes |
|---|---|---|
| id, tenant_id, unit_id, species_id, breed/subtype | | |
| source | enum | PURCHASED, HATCHED, BORN, TRANSFERRED, SPLIT, MERGED |
| acquired_date, age_at_acquire | date/num | drives age-in-days |
| initial_qty, current_qty | number | current = derived from movements |
| stage | enum | see §4.3 state machine |
| parent_batch_id(s) | id | for split/merge lineage (traceability) |
| acquisition_cost | money | per-head × qty (opening cost) |
| status | enum | ACTIVE, CLOSED (sold/culled out), ARCHIVED |

**INVENTORY LOT** (FIFO + food-safety traceability)
| Attr | Type | Notes |
|---|---|---|
| item_id, lot_no, qty_on_hand, unit, unit_cost | | |
| expiry_date | date | drives expiry alerts; blocks use if expired (configurable) |
| supplier_id, received_date | | |
| withdrawal_days | num | for meds/vaccines — see BR-WD |

**HEALTH/TREATMENT RECORD**
| Attr | Type | Notes |
|---|---|---|
| batch_id, type | enum | VACCINE, MEDICATION, SUPPLEMENT, DEWORM, OTHER |
| product_lot_id, dose, route | | consumes inventory |
| applied_by, applied_at, next_due_at | | reminder scheduled |
| **withdrawal_until** | date | **= applied_at + lot.withdrawal_days** → blocks/flags sale of product before this date (food safety) |
| photo_id, notes | | |

**SAMPLING RECORD** (the missing performance backbone)
| Attr | Type | Notes |
|---|---|---|
| batch_id, sample_type | enum | WEIGHT, COUNT, WATER_QUALITY, BODY_CONDITION |
| sample_size, avg_value, unit | | e.g., avg weight 1.85 kg from 10 birds |
| measured_at, measured_by | | feeds ADG, FCR-by-weight, harvest readiness |

**FEED FORMULA**
| Attr | Type | Notes |
|---|---|---|
| name, target_species/stage | | e.g., "Layer mash" |
| components[] | list | {ingredient_item_id, ratio_pct} |
| target_nutrition | json | optional (CP %, energy) |
| yield_unit_cost | derived | rolled from ingredient lot costs at mix time |

**PRODUCT** *(as-built — the per-batch catalog that replaced hard-coded "eggs")*
| Attr | Type | Notes |
|---|---|---|
| id, tenant_id, batch_id | id | a product belongs to a batch (and so to its enterprise) |
| name | string | "Eggs", "Manure", "Pork (live weight)", "Piglets", "Maize grain", … |
| base_unit | string | piece \| kg \| head \| bag |
| sale_units | json | `[{name, perBase, price}]` — **multiple priced sale units** (e.g. Tray=30 @360, Piece=1 @13) |
| collect_frequency | enum | daily \| weekly \| monthly \| per_cycle |
| flow | enum | `sale` (output/revenue) \| `expense` (input) |
| field_key | string | the `collect_*` worker-permission key that gates collecting this product |
| active | bool | products (incl. system defaults) are **owner-editable**; prices are not fixed |

**PHOTO** *(as-built — captured field evidence, previously discarded)*
| Attr | Type | Notes |
|---|---|---|
| id, tenant_id | id | tenant-scoped |
| data | string | compressed image bytes (data URL in the demo; object store in production) |
| gps_lat, gps_lng | num | capture location |
| captured_by, captured_at | | served via `/api/photos/[id]` to **non-worker roles only** |

**CLOSING STOCK COUNT** *(as-built — drives feed/inventory variance, `FR-M4-4`)*
| Attr | Type | Notes |
|---|---|---|
| client_uuid (PK), tenant_id | id | offline-synced; idempotent |
| item_id, closing_qty | | worker's physical count vs. system on-hand |
| recorded_by, captured_at | | variance surfaced at `/api/inventory/variance` |

### 4.3 State machines (explicit lifecycle — what the draft lacked)

**Batch lifecycle (generic, species overlays):**
```
CREATED ─► BROODING/NURSERY ─► GROWING ─► [LAYING | FINISHING | FATTENING]
        ─► HARVESTING/CULLING ─► CLOSED
   ▲                 │
   └── SPLIT / MERGE / TRANSFER (any active stage) ──┘
```
- Poultry layer overlay: `BROODING → PULLET/GROWER → POINT-OF-LAY → LAYING → SPENT/CULL`.
- Poultry broiler / pig / fish overlay: `…→ GROWING → FINISHING → HARVEST`.
- `FR-BL-1` (M) Stage transitions are recorded events with date; age-based suggested transitions are prompted but owner/worker-confirmed.

**Breeding cycle (pigs; poultry hatching analog):**
```
SOW: OPEN ─►(service)─► SERVED ─►(preg check)─► PREGNANT ─►(farrow)─►
     FARROWED/LACTATING ─►(wean)─► OPEN  (cycle repeats; litter → new BATCH)
```
- `FR-BR-1` (S) System tracks service date, expected farrow date (gestation default editable), farrow outcome (born alive/dead/mummified), wean date and count; weaned litter is **created as a new batch** with lineage to dam/sire.

**Sales order:** `DRAFT → CONFIRMED → DELIVERED → (PAID | PARTIALLY_PAID | CREDIT) → CLOSED`.
**Task:** `ASSIGNED → IN_PROGRESS → DONE | MISSED | SKIPPED(reason)`.

### 4.4 As-built schema (implemented tables)

> The model above is the contract; this is the **table set actually implemented** (Drizzle, `Frontend/db/schemas/index.ts`). The Phase-1 build collapses some inception entities (e.g. there is no separate `farm`/`zone` table — `production_units` carry `farm_id`/`zone_id` directly — and the typed field-event tables stand in for "RECORD" subtypes).

- **Tenancy / people**: `tenants` (now with `plan` + `features` jsonb — see §11/§12), `users` (PBKDF2 `password_hash` / `pin_hash`), `employees`, `worker_profiles` (field config, modules, `mortality_photo_threshold`, alert thresholds).
- **Spatial / livestock**: `production_units`, `batches` (`parent_batch_ids` for split/merge lineage).
- **Inventory / feed**: `inventory_items`, `inventory_lots` (FIFO cost, expiry, `withdrawal_days`), `feed_formulas` (mix events).
- **Field events** (offline-synced, `client_uuid` PK → idempotent): `feeding_records`, `mortality_records` (→ `photo_id`), `production_records` (per real product type), `health_records`, `labor_logs`, `closing_stock_counts`, plus a generic `records` landing table.
- **Commerce / costing**: `sales` (with `withdrawal_check` / `withdrawal_until`), `purchases`, `overheads`, **`products`** (the per-batch catalog), **`photos`**.
- **Ops / governance**: `tasks`, `alerts`, `alert_rules`, `audit_log` (append-only), `conflict_log`.

---

## 5. Functional Requirements

> Format: `ID (Priority) Requirement.` Acceptance criteria (**AC**) given for headline requirements. Modules: M1 Setup/Tenancy · M2 Spatial · M3 Batch/Livestock · M4 Feed/Inventory · M5 Health/Biosecurity · M6 Sampling/Performance · M7 Production/Harvest · M8 Crops · M9 Mortality · M10 Costing · M11 Sales/Payments · M12 Procurement · M13 Labor/Tasks · M14 Alerts · M15 Reporting · M16 Worker-Config/Perms · M17 Offline/Sync · M18 Audit · M19 Auth · M20 Commercialization/Platform-Admin *(as-built)*.

### M1 — Tenant, Farm & Initial Setup
- `FR-M1-1` (M) Owner self-registers, creating a **tenant**; all data is tenant-scoped.
- `FR-M1-2` (M) Guided **first-visit setup wizard**: farm profile → zones → production units → species/breeds → current batches (with age & acquisition cost) → opening inventory & unit costs → employees & PINs → worker-portal profile → alert thresholds → financial preferences (currency KES, categories).
- `FR-M1-3` (M) Setup is resumable and editable; nothing requires "getting it perfect" on day one. **AC:** owner can complete a minimum viable setup (1 farm, 1 unit, 1 batch, 1 worker) in < 15 minutes and start recording.
- `FR-M1-4` (S) **Quick-start templates** per enterprise (Layers, Broilers, Pig fattening, Pig breeding, Tilapia pond, Catfish, Maize) pre-fill units, stages, default vaccination/feeding schedules, and report set — owner edits rather than authors. **As-built (`lib/server/productTemplates.ts`):** each enterprise also defines its **default product catalog** (layers → Eggs + Manure + Spent hen; broilers → Live bird + Manure; pig_fatten → Pork; pig_breed → Piglets; tilapia/catfish → Fish; maize → Maize grain), so a pig or maize farm never sees eggs. Species → enterprise is inferred when not chosen explicitly.
- `FR-M1-5` (C) Owner manages **multiple farms** under one tenant.
- `FR-M1-6` (M) **As-built — onboarding without seed data.** A floating **Setup Guide** plus `POST /api/setup` bulk-persists a farm's initial units, batches, inventory and workers in one step, so a fresh tenant reaches a usable state without pre-seeded demo rows. (The Setup Guide is itself a plan-gated feature, `setup_guide` — see §12.)

### M2 — Spatial / Production Units
- `FR-M2-1` (M) CRUD production units with type, capacity, status; optional QR code.
- `FR-M2-2` (M) Unit status lifecycle (ACTIVE/EMPTY/CLEANING/QUARANTINE/OUT_OF_SERVICE); empty/cleaning units excluded from "active stocking density" but retained for history.
- `FR-M2-3` (S) **Stocking density** computed (current_qty ÷ capacity) with over-stocking warning.

### M3 — Batch & Livestock Lifecycle
- `FR-M3-1` (M) Create batch from source (purchased/hatched/born/transferred); auto-track age-in-days and current quantity from movement events.
- `FR-M3-1a` (M) **As-built — product auto-provisioning on batch creation** (`lib/server/products.ts`). Creating a batch **auto-creates the enterprise's default `products`** (each with priced sale units, a collection frequency, and a `flow`), **auto-adds a `collect_*` permission field** to every worker profile for each product, and **raises an "Assign a collector" alert** so the owner assigns who collects each product. (See M7 / M16.)
- `FR-M3-2` (M) **Split** a batch across units and **merge** compatible batches, preserving lineage and apportioning cost. **AC:** splitting 100 birds into 60+40 produces two batches whose costs sum to the original; lineage links retained.
- `FR-M3-3` (M) **Transfer** a batch between units (e.g., brooder → grower house) as a dated event.
- `FR-M3-4` (M) Record **stage transitions** (§4.3); age-based suggestions prompted.
- `FR-M3-5` (S) Optional **individual-animal** tracking for high-value stock (sows, boars, breeding cockerels) with ID/tag, weight history, breeding history.
- `FR-M3-6` (M) Batch "close-out" when sold/culled out: locks the batch and produces a **batch performance & P&L card**.
- `FR-M3-7` (S) **Periodic physical count / reconciliation**: owner or worker records a manual headcount of a batch; the system compares it to the **derived** population (opening − mortalities − culls − sales − transfers). Any variance forces a **Population Adjustment event** with a **mandatory reason** (e.g., "found 5 extra pigs", "missing 3 birds — suspected theft", "uncounted deaths"). This is an adjusting entry (`BR-10`), never a silent overwrite, and closes the accountability gap left by derived-only population. **AC:** if derived = 97 but the physical count = 94, the system requires a reason before accepting 94 and logs the −3 as an audited adjustment.

### M4 — Feed, Formulation & Inventory
- `FR-M4-1` (M) Maintain inventory items and **lots** (lot no., qty, unit cost, expiry) with **FIFO** consumption valuation.
- `FR-M4-2` (M) Record **feeding** against a batch; decrement inventory; capture leftover/refusal to refine consumption.
- `FR-M4-3` (M) **Feed formulation**: define recipes (ingredient ratios), record a mixing event that consumes ingredient lots and produces a finished-feed lot with **rolled-up unit cost** and label.
- `FR-M4-4` (M) **Daily/periodic closing-stock count** per item; system computes consumption = opening + receipts − closing and **flags variance** vs. logged feedings (theft/waste/error detection). **AC:** a 5 kg unexplained gap between counted and logged consumption raises a variance flag on the owner dashboard. **As-built:** worker counts land in `closing_stock_counts`; the Inventory **variance tab** is fed by real data from `GET /api/inventory/variance` (no mock figures).
- `FR-M4-5` (M) **Low-stock** and **expiry** alerts at configurable thresholds, to worker and owner.
- `FR-M4-6` (S) Per-batch **cumulative feed cost** maintained continuously for live FCR/cost views.

### M5 — Health, Treatment & Biosecurity
- `FR-M5-1` (M) Record vaccine/medication/treatment against a batch (or individual), consuming an inventory lot, capturing dose/route/applied_by, optional photo.
- `FR-M5-2` (M) **Vaccination/treatment schedules**: define program per species/stage; system generates **due/overdue reminders** and worker tasks. **AC:** a Newcastle vaccine due at day 7 appears as a worker task on the due date and escalates to the owner if missed.
- `FR-M5-3` (M) **Drug withdrawal periods** — every treatment sets `withdrawal_until`; the system **warns/blocks** sale or harvest of product (eggs/meat/fish) from that batch before the withdrawal date. This is a food-safety differentiator. (`BR-WD`)
- `FR-M5-4` (S) **Biosecurity / quarantine**: mark a unit/batch quarantined; restrict transfers in/out; log visitor/biosecurity events.
- `FR-M5-5` (C) **Vet/agronomist role**: external advisor with scoped read + advisory notes/prescriptions on assigned units.

### M6 — Sampling & Performance Measurement
- `FR-M6-1` (M) Record **weight samples** (sample size + average) for pigs/broilers/fish; compute **ADG** (average daily gain) and project harvest weight/date.
- `FR-M6-2` (M) **Water-quality readings** for ponds/tanks (temperature, dissolved oxygen, pH, ammonia, clarity) with safe-range alerts. (Fish die fast when water goes wrong — this is core, not optional.)
- `FR-M6-3` (S) Poultry environment readings (brooder temp, humidity) with stage-appropriate target ranges and deviation alerts.
- `FR-M6-4` (M) System computes **FCR by weight** (feed consumed ÷ weight gained) and **FCR by eggs**, per batch, continuously.

### M7 — Production & Harvest
> **As-built — production is product-driven, not egg-centric.** A worker collects against the **products** defined for a batch (M3-1a). Each collection writes a `production_records` row keyed by the product/type; the charts and metrics aggregate **by real product name** (Eggs, Manure, Pork, Piglets, Fish, Maize grain…), not a generic "produced" total.
- `FR-M7-1` (M) **Worker product-collection flow** (`/worker/record/collect`, `lib/server/charts.ts`): worker picks batch → product → quantity (in any of the product's sale units) → entry is **offline-enqueued** as a `production` record and **drives the dynamic per-product charts**. For layer products this still yields the **Hen-Day %** / **Hen-Housed %** metrics.
- `FR-M7-1a` (S) **Egg grading & storage** (sizes/grades), saleable vs. rejected, simple egg-stock balance (collected − sold − broken). *(Backlog — base egg collection is built; grade split is not yet.)*
- `FR-M7-2` (M) **Meat/fish/crop harvest**: count + total weight, link to batch (reduces population), optional immediate-sale capture, optional photo — captured through the same product-collection flow.
- `FR-M7-3` (M) Production records roll into per-unit production metrics and, when sold, into batch revenue and P&L.

### M8 — Crops / Agronomy
- `FR-M8-1` (M) Model a **plot** + **crop cycle** (land prep → planting → growth stages → harvest) with planting date, variety, area.
- `FR-M8-2` (M) Record **agronomic operations** (fertilizer, pesticide, herbicide, irrigation) consuming inventory, with **PHI (pre-harvest interval)** analogous to withdrawal (`BR-WD` applies to crops too).
- `FR-M8-3` (S) **Scouting/observation** log (pests, disease, weather damage) with photos.
- `FR-M8-4` (M) **Crop harvest** (weight/bags) by plot, cost roll-up, yield per acre.
- `FR-M8-5` (C) **Ecocycle linkage**: record resource transfers (e.g., pond effluent → crop irrigation; manure → fertilizer) as inter-enterprise flows for sustainability reporting.

### M9 — Mortality & Accountability
- `FR-M9-1` (M) Record mortality/cull by batch: quantity, optional cause, **recorder identity (auto)**, optional **timestamped, geotagged photo**; decrement population. **As-built:** the photo is actually **captured, uploaded on sync, stored** (`photos` table with GPS) and **served via `/api/photos/[id]` to non-worker roles only** — previously the image was discarded.
- `FR-M9-2` (M) **Photo mandatory** above a configurable count threshold (`worker_profiles.mortality_photo_threshold`); entry blocked until attached (anti-fraud, enables remote diagnosis).
- `FR-M9-5` (M) **As-built — Worker Activity feed.** Mortality (with photo + GPS), health, feeding and collection events surface in a **Worker Activity feed**, both **per-batch** (on the batch page) and **farm-wide** (`/owner/activity`, `/api/worker-activity`, `/api/batch-activity`), grouped by worker and day — closing the field-accountability loop. The feed is plan-gated by the `activity_log` feature (§12).
- `FR-M9-3` (M) Trigger **mortality-rate alert** when per-batch rate over a window exceeds threshold; surface day-of-cycle mortality curve.
- `FR-M9-4` (S) Distinguish **mortality vs. cull vs. theft/missing**; reconcile against expected population.

### M10 — Costing Engine (per-unit profitability)
- `FR-M10-1` (M) **Activity-based cost roll-up per batch**: acquisition + feed (FIFO-valued) + health + allocated labor + allocated overhead.
- `FR-M10-2` (M) **Labor allocation**: task hours × employee rate, allocated to the batch/unit the task targeted; un-targeted labor allocated by configurable rule (even split / by population / manual).
- `FR-M10-3` (S) **Overhead allocation** (rent, utilities, depreciation) by chosen driver (population, floor area, revenue share).
- `FR-M10-4` (M) Compute **cost of production per output unit** (per egg/crate, per kg meat/fish, per bag of maize) and **gross margin per production unit**.
- `FR-M10-5` (S) **Biological-asset valuation**: current standing value of live batches (cost-to-date or market-weight basis) for balance-sheet/funding views.
- `FR-M10-6` (M) **Break-even age/point** per batch (cumulative revenue ≥ cumulative cost). **AC:** owner can open any batch and see cost-to-date, revenue-to-date, margin, cost/output-unit, and projected break-even — all without manual calculation.

### M11 — Sales, Customers & Payments
- `FR-M11-1` (M) Record a **sale** linked to a **source batch/unit** (traceability), product, quantity/weight, unit price, buyer (or "Market"), optional receipt photo. **Blocks/warns** if withdrawal/PHI not elapsed (`BR-WD`).
- `FR-M11-2` (M) Revenue posts to the batch (drives margin); inventory/population reduced.
- `FR-M11-3` (S) **Customers** with purchase history; **credit sales** with outstanding balance and reminders.
- `FR-M11-4` (S) **M-Pesa (Daraja) integration**: capture/confirm mobile-money payment against a sale; reconcile.
- `FR-M11-5` (C) **Sales orders / pre-orders** and simple delivery tracking.
- `FR-M11-6` (S) **Price book** per product with optional market-price reference.

### M12 — Procurement & Suppliers
- `FR-M12-1` (M) Record **purchases/expenses** linked to item→lot and optionally to a batch/unit; capture supplier, unit cost, receipt photo; increment inventory.
- `FR-M12-2` (S) Supplier directory with purchase history and simple price comparison.
- `FR-M12-3` (C) Reorder suggestions from consumption rate + lead time.

### M13 — Labor, Tasks & Workforce
- `FR-M13-1` (M) Owner/manager assign **tasks** (one-off, daily, weekly, recurring) from **templates** (Morning Round, Vaccination, Stock Count, Feeding, Sampling, Custom), optionally scoped to units/batches.
- `FR-M13-2` (M) Worker home screen shows **today's tasks + alerts**; tasks have lifecycle ASSIGNED→IN_PROGRESS→DONE/MISSED/SKIPPED(reason) with timestamps.
- `FR-M13-3` (S) **Attendance / hours** (clock-in/out or per-task hours) feeding labor cost (`FR-M10-2`).
- `FR-M13-4` (S) **Task completion** evidence (photo/data) and per-worker completion-rate metric.
- `FR-M13-5` (M) **Guided "Morning Round"** flow walks the worker unit-by-unit, capturing water/feed/eggs/observations in one offline session (§6.2).

### M14 — Alerts & Notification Engine
- `FR-M14-1` (M) Rule-based engine evaluates events and thresholds to raise alerts: low stock, expiry, mortality spike, overdue vaccination, withdrawal-period violation attempt, water-quality out of range, feed-variance, task missed, credit overdue. **As-built (`lib/server/alertEngine.ts`):** evaluation runs **on-demand** (`POST /api/alerts/evaluate`) — the scheduled/cron tier is **deferred** (§3, §8).
- `FR-M14-2` (M) Alert **routing & severity**: in-app delivery with per-alert severity. **As-built — alerts are actionable:** clicking an alert **routes to the screen responsible for acting on it** (`lib/alerts.ts` `alertDestination`, e.g. low-stock → Inventory, "Assign a collector" → People, mortality spike → the batch), and a red **notification-bell badge shows the unacknowledged-alert count**. **Push (FCM) and SMS delivery are deferred** (§9) — in-app is the v1 channel.
- `FR-M14-3` (S) Owner can **create/edit alert rules** (metric, threshold, window) without code (`alert_rules` table, `/api/alert-rules`).
- `FR-M14-4` (S) **Escalation**: unacknowledged critical alerts escalate (worker → manager → owner) after a delay. *(Backlog — needs the scheduled tier.)*

### M15 — Reporting, Analytics & Forecasting
- `FR-M15-1` (M) **Owner dashboard**: FCR, mortality %, production/unit, gross margin, inventory status, task completion, recent activity feed, alerts — real-time, per-species filterable.
- `FR-M15-2` (M) **Report catalog** (§10) with date range + filters (species/batch/unit), **export to PDF/CSV** (jspdf, on-demand). Gated by the `reports` plan feature (§12).
- `FR-M15-3` (M) **Baseline vs. period** impact report (Month-1 baseline vs. later) for funding/operations.
- `FR-M15-4` (S) **Trend visualizations.** **As-built:** the production chart plots **real product names** (Eggs, Manure, Pork…), not a generic "produced" total (`/api/charts/production`); the batch view shows a **cumulative cost-vs-revenue P&L chart** (`/api/charts/cumulative`). Per-unit heatmap is backlog.
- `FR-M15-5` (C) **Forecasting**: project harvest weight/date (from ADG), feed requirement & cost to harvest, and simple scenario ("+X feed → +Y kg").
- `FR-M15-6` (S) **Investor/auditor read-only** scoped, time-boxed report access link (`/auditor`, `/api/auditor-link`).
- `FR-M15-7` (S) **As-built — AI Farm Advisor** (`components/AIAdvisor.tsx`, `POST /api/ai/advise`, `lib/server/ai.ts`). A floating advisor for owner/manager that calls an LLM via **OpenRouter** (OpenAI-compatible; model set by `OPENROUTER_MODEL`). It is **grounded in live farm data** (KPIs, batches, active alerts, low stock, 14-day production) and **multi-turn**, with conversation history persisted in `localStorage` so it survives reloads. It degrades gracefully when no API key is configured. Gated by the `ai_advisor` plan feature (§12).

### M16 — Worker-Portal Configuration & Permissions (the defining feature)
- `FR-M16-1` (M) Owner defines a **Worker Portal Profile** controlling, per role/worker: **field-level visibility** (hide costs/margins/revenue), **required vs. optional fields**, **photo-required rules**, **which modules/tasks are available**, and **alert thresholds**. **AC:** with "show costs = off", no cost/price/margin value appears anywhere in that worker's app, including on feeding/sales screens.
- `FR-M16-2` (M) **Field-level permission** model (not just screen-level): a field can be hidden, read-only, or editable per role.
- `FR-M16-3` (S) Multiple profiles (e.g., "Poultry worker", "Trusted manager") assignable per worker.
- `FR-M16-4` (M) Changes to a worker profile propagate on next sync; worker app enforces locally even while offline.
- `FR-M16-5` (M) **As-built — enforcement is server-side, not cosmetic** (`lib/server/fieldPermissions.ts`). Sensitive properties are **dropped from the response object on the server** before it leaves the API — a worker whose profile hides a financial field never receives that property in the JSON. **Financial keys default-deny** (`feed_unit_cost`, `egg_sale_price`, `batch_profit_loss`): they stay hidden unless the profile **explicitly** marks them editable/readonly, so a partial or mangled profile can never leak money. Writes are likewise checked (`assertWritable`) so a worker cannot set a non-editable field. Per-product **`collect_*` permission keys** (M3-1a) plug into the same model — only collectors with that key see/record a given product.

### M17 — Offline & Synchronization
- `FR-M17-1` (M) All worker data-entry works **fully offline**; entries queue locally with capture timestamp and online/offline flag.
- `FR-M17-2` (M) **Delta sync** on reconnect: upload queued writes, download config/tasks/alerts; photos upload-only with compression.
- `FR-M17-3` (M) **Conflict resolution**: deterministic policy (server-authoritative for config; for field data, last-write-wins by capture time with **owner-visible conflict log** for manual override). **AC:** two workers editing the same batch offline never silently lose data; the loser's value is preserved in the conflict log. **As-built (`/api/sync`, `conflict_log` table):** conflict detection/resolution is **implemented for `production` records** (same batch + product + day with a differing quantity → LWW by `capturedAt`, loser logged). For **other record types it is deferred** — they upsert idempotently by `client_uuid` but are not yet diffed for edit-conflicts.
- `FR-M17-4` (M) Clear **offline indicator** and pending-sync count; sync is automatic + manual-trigger.
- `FR-M17-5` (S) Idempotent writes (client-generated IDs) so retries never duplicate records.

### M18 — Audit & Data Integrity
- `FR-M18-1` (M) **Append-only audit trail** for every create/update/delete: actor, timestamp, device, geo (if available), before→after, sync origin.
- `FR-M18-2` (M) Records are **corrected via adjusting entries**, not silent edits, for financial/population-affecting data (auditability for investors).
- `FR-M18-3` (S) Owner can view an entity's full history timeline.

### M19 — Authentication, Roles & Access
- `FR-M19-1` (M) Owner: email/phone + password; Worker: **phone + PIN** (and/or biometric) for fast field login on shared devices. **As-built:** passwords and PINs are hashed with **PBKDF2 (Web Crypto)** (`lib/server/crypto.ts`); the offline PIN cache was upgraded from reversible `btoa` to PBKDF2. **No account enumeration** — login returns the same error for unknown-user and wrong-password, and a DB outage returns a friendly 503, never a raw 500.
- `FR-M19-2` (M) **RBAC** — roles `owner`, `manager`, `worker`, `vet`, `auditor`, **`super_admin`** — refined by field-level permissions (`FR-M16-2`). **As-built — enforced at the edge** (`middleware.ts`): every protected route is checked **before render** against a **HMAC-signed, httpOnly, expiring session cookie**; logged-out users are redirected to the correct login and each section is role-locked (owner ≠ worker ≠ admin), so no page shell leaks to the unauthenticated. The same token is verified server-side per API route, and every query is tenant-scoped (`NFR-AR-1`).
- `FR-M19-3` (M) Device lock + auto-logout (session expiry); remote revoke of a lost device's session. *(Session expiry is built; explicit remote-revoke UI is backlog.)*
- `FR-M19-4` (S) Multi-language UI (English/Swahili) selectable per user (`users.language`).
- `FR-M19-5` (S) **As-built — login rate-limiting is deferred** (needs a Redis/Upstash tier); see §11 `SEC-6`.

### M20 — Commercialization & Platform Administration *(as-built — new)*
> Implements the multi-tenant SaaS billing/entitlement layer that §2.1's "Platform Super-Admin" and §12's "scale to thousands of farms" imply.
- `FR-M20-1` (M) Each tenant carries a **`plan`** and a **`features`** entitlement list (`tenants.plan`, `tenants.features` jsonb). Plans **free / standard / pro** map to feature sets in `lib/features.ts` (features: `setup_guide`, `ai_advisor`, `reports`, `activity_log`, `alerts`, `finance`).
- `FR-M20-2` (M) **Platform admin dashboard** (`/admin/dashboard`, `super_admin` only, `/api/admin/tenants`): the operator manages each farm's **plan** and toggles **individual features** per farm.
- `FR-M20-3` (M) **`GET /api/me`** returns the tenant's enabled `features`; the owner UI **gates** nav items, the Setup Guide, the AI Advisor, reports, alerts, finance and the activity log by what the plan unlocks.

---

## 6. Key End-to-End Workflows

### 6.1 First-Visit Setup (Owner) — `FR-M1-2`
Farm profile → add zones & units → pick enterprise template(s) → enter current batches (qty, age, cost) → opening inventory & costs → add workers + PINs → choose worker-portal profile (hide costs) → set thresholds (mortality %, low-stock) → done. Owner can start with one unit/batch and expand.

### 6.2 Daily Morning Round (Worker, offline) — `FR-M13-5`
```
Start Round (timestamp+GPS)
  → Poultry House 1 → per cage: water [Low/OK/Full] · feed remaining (kg)
                       · eggs collected (+cracked) · abnormality? (+note/photo)
  → Pig pens → water · feed · body condition / abnormality
  → Fish ponds → water color/clarity · DO/pH/temp (if measured) · feed given (kg)
  → Any deaths? → Mortality flow (photo if > threshold)
  → Any due tasks (vaccination)? → Health flow
End Round (timestamp) → queued offline → syncs later
```
Each effect is automatic: feeding decrements stock & adds to batch feed-cost; eggs create production records & update hen-day %; water-quality out of range raises an alert on sync.

### 6.3 Record a Sale (with traceability + food safety) — `FR-M11-1`, `BR-WD`
Select product → select **source batch** → quantity/weight → price → buyer → (M-Pesa confirm) → receipt photo → submit. System checks **withdrawal/PHI**: if not elapsed, **warn/block**. Revenue posts to the batch; margin and cost/unit update instantly.

### 6.4 Vaccination cycle — `FR-M5-2`, `FR-M5-3`
Schedule defined at setup → due task auto-appears on date → worker administers (consumes lot, records dose, photo) → `next_due` and `withdrawal_until` set → overdue escalates to owner.

### 6.5 Pig breeding cycle — `FR-BR-1`
Service (sow + boar, date) → pregnancy check → expected farrow date → farrow outcome (born alive/dead) → wean (count, date) → **litter becomes a new batch** with parent lineage → sow returns to OPEN.

### 6.6 Batch close-out & P&L — `FR-M3-6`, `FR-M10-6`
On final sale/cull, batch closes → generates performance card: FCR, mortality %, ADG, total cost (broken down), total revenue, gross margin, cost/output-unit, break-even age, days-on-farm.

---

## 7. Business Rules & Validation

| ID | Rule |
|---|---|
| `BR-1` | Feed/medication consumed ≤ lot quantity on hand (FIFO); over-consumption rejected. |
| `BR-2` | Mortality + culls + sales (population-reducing) ≤ current batch quantity. |
| `BR-3` | Harvest count ≤ current batch quantity. |
| `BR-4` | Counts/weights/prices ≥ 0; weights and prices accept decimals; counts are integers. |
| `BR-5` | Photo mandatory when mortality count > configured threshold (`FR-M9-2`). |
| `BR-6` | A task cannot be marked DONE before its scheduled date; future-dating data entry beyond device date is flagged. |
| `BR-WD` | **No sale/harvest of product from a batch before `withdrawal_until` (meds/vaccines) or crop PHI; attempt warns and, if configured strict, blocks** (`FR-M5-3`, `FR-M8-2`, `FR-M11-1`). |
| `BR-7` | Expired inventory lots are flagged and (configurably) blocked from consumption. |
| `BR-8` | Every sale and every cost must reference a batch/unit (or be explicitly marked "unallocated/overhead") so costing stays complete. |
| `BR-9` | Split/merge must conserve quantity and cost (outputs reconcile to inputs). |
| `BR-10` | Financial/population records are corrected by adjusting entries, never silent overwrite (`FR-M18-2`). |
| `BR-11` | Feed-variance beyond tolerance (counted vs. logged) raises a flag, not an auto-correction. |
| `BR-12` | A physical count differing from derived population requires a mandatory reason and is recorded as an audited Population Adjustment (`FR-M3-7`), never a silent overwrite. |

---

## 8. Non-Functional Requirements

**Performance**
- `NFR-P-1` (M) Offline app cold-start < 3 s; data-entry submit (local) < 1 s.
- `NFR-P-2` (M) Dashboard < 5 s; standard report < 10 s on typical farm data volumes.
- `NFR-P-3` (S) Photo client-compressed to ≤ ~300 KB before upload; upload resilient/resumable.

**Reliability & availability**
- `NFR-R-1` (M) No data loss across offline→online transitions (idempotent, queued, audited).
- `NFR-R-2` (S) Backend ≥ 99.5% monthly availability; nightly backups; point-in-time restore.

**Scalability (SaaS)**
- `NFR-S-1` (M) Multi-tenant; horizontal scale; tenant data isolation (`NFR-AR-1`).
- `NFR-S-2` (S) Add a new species/crop via configuration (no schema change) — proven by adding "goats" without a deploy.

**Usability & accessibility**
- `NFR-U-1` (M) Worker flows usable by low-literacy users: icon-led, minimal typing, large targets, EN/SW.
- `NFR-U-2` (M) Two-minute rule: each routine entry achievable in < 2 minutes.
- `NFR-U-3` (S) Works on low-end Android (≤ 2 GB RAM) without crashing.

**Security & privacy** (detail in §11)
- `NFR-SEC-1` (M) Encryption in transit (TLS) and at rest (DB + local store + photos).
- `NFR-SEC-2` (M) Field-level RBAC enforced server-side and mirrored client-side offline.
- `NFR-SEC-3` (S) Regional data residency where available; tenant data export & delete on request.

> **As-built (security):** `NFR-SEC-1` is met in transit (TLS) and field-level RBAC (`NFR-SEC-2`) is enforced server-side with default-deny financials (`FR-M16-5`). At-rest encryption of the local store/photos and tenant export/delete remain to harden. The **scheduled/background tier** (`NFR-AR-3` materialised read-models, cron alert evaluation, heavy async reports) is **deferred** — on-read compute covers pilot scale.

**Data retention, aggregation & archiving**
- `NFR-DATA-1` (M) **Rollups by design.** Daily transactional detail (feedings, egg counts, mortality events, readings) is continuously aggregated into daily/weekly/monthly **summary read-models** that power dashboards and reports. Live analytics query the aggregates, never the raw event stream — so performance stays flat as a farm accumulates years of records (a 1,000-bird farm generates ~1M+ rows over a few years). Raw detail is retained for audit/drill-down but is not on the dashboard hot path.
- `NFR-DATA-2` (S) **Configurable retention.** Owner can set retention for high-cost data — e.g., "delete mortality/harvest photos older than N months" to control cloud storage — with an explicit warning before any irreversible deletion. Structured records are retained (or cold-archived) far longer than media.
- `NFR-DATA-3` (S) **Cold archive.** Detail older than a configurable horizon (default 12 months) moves to cheaper archival storage; it remains queryable for audit/export but is excluded from real-time rendering.

**Maintainability & observability**
- `NFR-M-1` (S) Structured logging, error tracking, sync-health metrics per tenant.
- `NFR-M-2` (C) Feature flags per tenant for staged rollout.

**Localization**
- `NFR-L-1` (M) Currency KES (multi-currency-ready); metric units; EN/SW; East Africa time; configurable date formats.
- `NFR-L-2` (M) Language is a **runtime toggle**, not build-time — selectable on the login screen and per user, switchable offline without reinstall.

---

## 9. External Integrations

| ID | Integration | Priority | Purpose |
|---|---|---|---|
| `INT-0` | **AI Advisor via OpenRouter** *(as-built, built)* | S | Grounded multi-turn farm advice; LLM behind OpenRouter, `OPENROUTER_MODEL` (`FR-M15-7`) |
| `INT-1` | **M-Pesa (Daraja)** | S | Capture/confirm sale payments; later, subscription billing *(deferred)* |
| `INT-2` | **SMS gateway** | M | Alerts to offline owners / feature phones; OTP *(deferred — in-app is the v1 alert channel)* |
| `INT-3` | **Push (FCM)** | M | In-app alerts/tasks *(deferred — alerts are in-app + bell badge in v1)* |
| `INT-4` | **Weather API** | C | Crop planning, heat-stress alerts |
| `INT-5` | **Market price feed** | C | Reference pricing for sales decisions |
| `INT-6` | **Accounting export** | C | CSV/Excel/API export to QuickBooks-style tools |
| `INT-7` | **IoT sensor ingest** | W | Future: automated water-quality/temperature feeds |
| `INT-8` | **USSD lightweight entry** | C | Feature-phone fallback for the most basic records |

---

## 10. KPI & Report Catalog (with formulas)

**Performance KPIs**
| KPI | Formula | Notes |
|---|---|---|
| FCR (weight) | total feed kg ÷ total weight gain kg | per batch; lower is better |
| FCR (eggs) | total feed kg ÷ total eggs (or egg-mass) | layers |
| ADG | (current avg weight − start avg weight) ÷ days | from sampling |
| Mortality rate | deaths ÷ starting population × 100 | per batch / per window |
| Hen-Day % | eggs collected ÷ live hens that day × 100 | daily productivity |
| Hen-Housed % | cumulative eggs ÷ hens housed at start of lay | lifetime productivity |
| Survivability | (start − deaths) ÷ start × 100 | |
| Yield/acre | crop kg ÷ plot acres | crops |

**Financial KPIs**
| KPI | Formula |
|---|---|
| Total batch cost | acquisition + feed(FIFO) + health + labor + overhead |
| Cost of production / unit | total cost ÷ total output units |
| Gross margin / unit | revenue − (feed + health + labor + other) per production unit |
| Break-even age | first day where cumulative revenue ≥ cumulative cost |
| Biological-asset value | standing cost-to-date (or market-weight) of live batches |

**Reports (each PDF/Excel/CSV, date-ranged, filterable):** Profit & Loss (by species/batch/unit) · Production Summary · FCR & ADG Analysis · Mortality Report (by day-of-cycle & cause) · Inventory & Feed-Variance · Sales & Receivables · Vaccination/Treatment Compliance & Withdrawal Log · Labor & Task Completion · Baseline-vs-Period Impact · Batch Performance Card.

---

## 11. Security & Privacy

- `SEC-1` (M) RBAC + field-level permissions; principle of least privilege; worker sees only owner-exposed data. **As-built:** enforced server-side by stripping sensitive properties from responses, with **default-deny for financial keys** (`FR-M16-5`); edge middleware role-locks every section (`FR-M19-2`).
- `SEC-2` (M) Encryption in transit + at rest; encrypted local store; PIN/biometric device lock; auto-logout; remote session revoke. **As-built:** TLS in transit; **PBKDF2** password/PIN hashing and **HMAC-signed httpOnly expiring sessions** (`FR-M19-1/2`). At-rest DB/local-store/photo encryption and remote revoke are to harden.
- `SEC-3` (M) Tenant isolation (`NFR-AR-1`); no cross-tenant data access. **Super-admin (platform operator) has no direct, unlogged SQL access to production tenant data** — all operator access is brokered through audited, justified, time-boxed support sessions. This is an explicit trust signal for investor due-diligence. **As-built:** the `super_admin` operates through the `/admin` dashboard (plan/feature management per tenant), which is role-gated like every other section; the brokered-support-session model above is the target operating posture.
- `SEC-4` (S) Audit trail immutable/append-only; financial corrections via adjusting entries.
- `SEC-5` (S) Data subject rights: tenant export & deletion; configurable photo/data retention.
- `SEC-6` (S) Rate-limiting, input validation, OWASP-aligned API hardening; secrets management. **As-built:** input validation, no account enumeration, friendly errors (no leaky 500s), and secrets via env/compose (not baked into the image) are in place. **Login rate-limiting is deferred** (needs a Redis/Upstash tier).

---

## 12. Release Plan (MoSCoW → phases)

**Phase 1 — MVP / Pilot (all `M`):** tenancy + setup wizard; units; batches with lifecycle, split/merge/transfer; feed/inventory + formulation + closing-stock variance; health + schedules + **withdrawal**; mortality + photo accountability; sampling + water-quality + FCR/ADG; production/harvest + hen-day; **costing engine + per-batch P&L**; sales with traceability + procurement; tasks + morning round; **alerts engine (in-app/push/SMS)**; dashboard + core reports + export; **worker-portal field-level config**; **offline + delta sync + conflict log**; audit trail; auth/RBAC; EN/SW.

> **As-built — what Phase 1 actually shipped (2026-06-24).** Built and proven: tenancy + onboarding (Setup Guide, no seed data); units; batches with the **per-batch product catalog** (auto-provisioned, editable); feed/inventory + formulation + **closing-stock variance**; mortality + **stored, served, GPS-tagged photos** + **Worker Activity feed**; costing engine + **per-batch P&L charts**; product-driven sales/finance; **on-demand alerts engine with clickable alerts + notification-bell badge**; dashboard + **dynamic per-product charts**; PDF/CSV reports; **server-side field-level permission stripping (default-deny financials)**; **offline + delta sync** with **production-record conflict log**; append-only audit; **edge-gated auth/RBAC with PBKDF2 + HMAC sessions**; **multi-tenant commercialization (plans/features + `/admin`)**; **AI Advisor (OpenRouter)**; Dockerised deploy. **Deferred from Phase 1:** push/SMS delivery, M-Pesa, the scheduled/background tier (cron alerts, async reports), login rate-limiting, and conflict detection for non-production sync types — these move to later phases.

**Phase 2 — `S`:** M-Pesa; credit sales & customers; breeding cycle; biosecurity/quarantine; egg grading; overhead allocation; biological-asset value; trend charts/heatmap; owner-editable alert rules + escalation; auditor read-only links; attendance/hours.

**Phase 3 — `C`/`W`:** forecasting/scenarios; weather & market price; ecocycle resource flows; sales orders; USSD; accounting export; multi-farm UI; IoT ingest; vet/agronomist portal.

---

## 13. Acceptance & Success Criteria

**System acceptance (pilot):**
- A worker completes a full morning round **offline** in < 10 min; data appears on owner dashboard after sync with zero loss.
- "Hide costs" worker profile shows **no monetary values anywhere** in that worker's app.
- Any batch shows live FCR, mortality %, cost-to-date, revenue, margin, cost/unit, projected break-even **without manual calculation**.
- A sale within a drug withdrawal window is **warned/blocked** per `BR-WD`.
- A feed count vs. logged-consumption gap raises a **variance flag**.

**Adoption / outcome targets (measured by the system):**
| Metric | Target |
|---|---|
| Worker daily-active / required entries logged | > 95% |
| Sync success rate | > 98% |
| Mortality-photo attachment rate | > 90% |
| FCR (vs. Month-1 baseline) | improving toward 15% gain |
| Mortality rate (vs. baseline) | toward 20% reduction |
| Inventory accuracy | from ±30% → ±5% |

---

## 14. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Workers fake/avoid data entry | Two-minute design; give workers value (live stock, task clarity); photo accountability; variance flags |
| Connectivity gaps | Offline-first is a hard requirement, not a feature |
| Over-complex UI for low literacy | Icon-led, bilingual, templates, progressive disclosure |
| Owner over-configures and stalls | Quick-start templates + resumable minimal setup |
| Data integrity disputes | Append-only audit, adjusting entries, conflict log |
| Food-safety liability | Built-in withdrawal/PHI enforcement |
| Scaling cost | Multi-tenant, delta sync, compressed media from day one |

---

## 15. Glossary
**Batch/Cohort** — group of animals/plants of similar age managed and costed as a unit. **Production Unit** — cage/pen/house/pond/tank/plot. **FCR** — feed ÷ output (gain or eggs). **ADG** — average daily weight gain. **Hen-Day %** — daily eggs per live hen. **Hen-Housed %** — cumulative eggs per hen originally housed. **Withdrawal Period** — time after a drug before product is safe to sell. **PHI** — pre-harvest interval (crop analog of withdrawal). **Tenant** — an owner's isolated account/data space. **Biological Asset** — living livestock/crops as a valued asset. **FIFO** — first-in-first-out inventory valuation. **Lot** — a received quantity of an item with its own cost/expiry/traceability.

---

## 16. Requirements Traceability (excerpt)
| Need (from owner) | Requirements | KPI/Report |
|---|---|---|
| "Know feeds remaining / when to buy" | FR-M4-1/4/5, FR-M14-1 | Inventory & Feed-Variance |
| "Feed goes to the labelled animals" | FR-M4-2/3, FR-M3 | Per-batch feed cost, FCR |
| "Numbers per flock; group by cage/age" | FR-M2, FR-M3-1/2/3/4 | Stocking density, Batch card |
| "Trust the headcount (catch theft/missed deaths)" | FR-M3-7, BR-12, FR-M9-4 | Population Adjustment / audit log |
| "Products back (eggs/meat/maize)" | FR-M3-1a, FR-M7-1/2/3, FR-M8-4 | Production Summary (per-product), Hen-Day |
| "Workers collect the right products only" | FR-M16-5, FR-M3-1a | Worker Activity feed |
| "Sell IFMS as a product (plans/billing)" | FR-M20-1/2/3 | Platform admin (`/admin`) |
| "Advice from my own farm data" | FR-M15-7 | AI Advisor |
| "Record mortalities, who + photo" | FR-M9-1/2/3 | Mortality Report |
| "Vaccines/inputs never lost" | FR-M5-1/2/3, FR-M8-2 | Treatment Compliance & Withdrawal |
| "Cost per cage; financial stats on dashboard" | FR-M10-*, FR-M15-1 | P&L, Batch Performance Card |
| "Owner controls what worker sees" | FR-M16-*, FR-M19-2 | — |
| "Export reports that visualize" | FR-M15-2/4 | Report catalog (§10) |
| "Scalable, not rigid" | NFR-S-1/2, FR-M1-4 | — |
| "Measure outcomes over time" | FR-M15-3, FR-M6, FR-M10 | Baseline-vs-Period Impact |

---

*End of SRS v1.1 (as-built). IDs are stable; extend modules with new `FR-Mxx-nn` IDs rather than renumbering. The model in §4 is the contract; §5 is what we build; §13 is how we know it works. See `docs/AS_BUILT.md` for the full deviation list.*
