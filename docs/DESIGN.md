> **As-built revision — 2026-06-24.** Updated to match the implemented UI. The original inception version is preserved untouched at `docs/inception/DESIGN.md`. See `docs/AS_BUILT.md` for the full deviation list.

# IFMS — Design Document (UX/UI & Interaction Specification)

| Field | Value |
|---|---|
| **Product** | Integrated Farm Management System (IFMS) |
| **Document type** | Design / Interaction Specification |
| **Version** | 1.0 (Baseline, supersedes earlier draft) |
| **Status** | For development — pilot |
| **Source of truth** | **SRS v1.0** — every screen here cites the `FR-`/`BR-`/`NFR-` it implements |
| **Audience** | UI/UX designers, frontend engineers, QA, owner (Kutswa) |

> **Reading contract.** The SRS says *what* and *why*; this document says *how it looks and behaves*. Where the two ever disagree, the SRS wins and this doc is corrected. Anything here that is **not** backed by an SRS ID is flagged `[SCOPE+]` so it does not silently inflate the MVP — see §13.

---

## 1. Design Philosophy

| Principle | UI manifestation | SRS link |
|---|---|---|
| **Two-minute rule** | Daily entries finish in < 2 min; minimal typing; the *right* control per data type (keypad for counts, stepper for small adjustments, toggle for states) | `NFR-U-2` |
| **Owner control, worker simplicity** | Worker sees only owner-exposed fields; hidden monetary fields are **stripped server-side before payload**, not CSS-hidden | `FR-M16-1/2`, `NFR-SEC-2` |
| **Offline-first = no waiting** | Every tap writes locally first and confirms instantly; a persistent connectivity badge; no blocking spinners on the field path | `FR-M17-*` |
| **Accountability through evidence** | Camera + GPS are primary, not buried; capture rules are owner-configured, not hardcoded | `FR-M9-1/2`, `FR-M18-1` |
| **Designed for the field, not the office** | Readable in direct sunlight; usable with one hand, gloves, dust; never relies on color alone | `NFR-U-1/3` (extends) |

---

## 2. Design System Foundations

### 2.1 The "never color alone" rule (field-critical)
Workers use cheap screens **outdoors in direct sun**, where color washes out and colour-blind users can't rely on hue. **Every status is encoded three ways: color + icon + text label.**

| Status | Color | Icon | Text |
|---|---|---|---|
| OK / Normal | Green | ✓ | "OK" |
| Warning | Amber | ▲ | "LOW" / "DUE" |
| Critical | Red | ⛔ | "BLOCKED" / "OVERDUE" |
| Offline/queued | Grey | ⤬ | "OFFLINE" |

- `DS-1` Minimum contrast ratio 4.5:1; a **high-contrast / sunlight mode** toggle in worker settings.
- `DS-2` Status is never conveyed by color alone (WCAG 1.4.1).

### 2.2 Touch & ergonomics
- `DS-3` Minimum touch target **48×48 dp**; primary action buttons full-width, ≥ 56 dp tall.
- `DS-4` Critical irreversible actions (mortality, sale, population adjustment) use a **distinct color + confirmation**, never adjacent to "next".
- `DS-5` Portrait-only for worker app; one-thumb reachable primary actions (bottom of screen).

### 2.3 Input control selection (corrects the earlier draft's stepper error)
Choosing the wrong control breaks the two-minute rule. The rule:

| Data shape | Control | Example | Why |
|---|---|---|---|
| **Large/arbitrary count** | **Large numeric keypad** (direct entry) + optional `+/−` for fine correction | eggs (48), feed kg (5.0) | Tapping `+` 48 times is absurd |
| **Small count (0–5)** | Stepper `+/−` | deaths, culls | Fast, typo-proof |
| **Fixed state (3–4 options)** | Big segmented toggle | water Low/OK/Full | One tap, no menu |
| **Selection from a list** | **Searchable** dropdown showing live context | batch, feed type (shows "Layer Mash — 42 kg left") | Avoids scrolling, surfaces stock |
| **Decimal measure** | Keypad with unit suffix | weight 1.85 kg, pH 7.2 | Precision needed |
| **Evidence** | Camera capture (see §2.4) | mortality photo | Accountability |

### 2.4 Camera & geotag (corrects the EXIF error)
- `DS-6` **GPS is captured independently from the device location API at the moment of capture and attached to the record** — the system does **not** rely on photo EXIF, because client-side compression (`NFR-P-3`, ~300 KB) strips EXIF on most Android pipelines. The photo and its `{lat,lng,accuracy,timestamp,captured_by}` are stored as separate, linked fields. `FR-M9-1`, `FR-M18-1`
- `DS-7` Photo requirement is read from the **worker profile config** (`FR-M16-1`), never hardcoded. The capture button shows "Required" or "Optional" based on the live threshold (`FR-M9-2`).
- `DS-8` If GPS is unavailable, capture still succeeds; the record is tagged `geo: unavailable` (degraded, not blocked).

### 2.5 Typography & language
- `DS-9` Body ≥ 16 sp; numeric entry fields ≥ 22 sp; labels never below 14 sp.
- `DS-10` **Runtime EN/SW toggle** on the login screen and in settings, switchable offline (`NFR-L-2`).

### 2.6 Visual language (as-built)
The owner/manager web portal carries a deliberate **jungle-green** identity; the worker app stays large-touch and emoji-led for speed and low literacy.
- **Owner sidebar**: dark **jungle-green** rail (`bg-green-950`) with the `🌾 IFMS` wordmark, the signed-in name + role pill, and **lucide vector nav icons** (not emoji): `LayoutDashboard`, `Tractor`, `Boxes`, `Wallet`, `Users`, `ClipboardList`, `Settings`, `BarChart3`, `Bell`. The active item is a filled green pill; the same icon repeats in the breadcrumb.
- **KPI cards (redesigned)**: each card is `tinted icon chip + large value + label` — no fake repeated sparklines. The chip colour matches the metric (emerald, sky, violet, rose, amber, indigo, orange); values colour-shift on threshold (FCR turns emerald when ≤ 2.8, mortality red at ≥ 5%, gross margin green/red on sign).
- **Status everywhere** still obeys §2.1 (colour + icon + text) via a shared `StatusChip`.
- **Worker app** keeps emoji-titled screens and big primary buttons (red for mortality, green for routine) — the visual refresh above is owner-portal scope, by design.

---

## 3. Persona → UI Surface Matrix (all six personas)

The earlier draft designed only Owner and Worker. The SRS defines six user classes (`§2.2`); **all are specified here.**

| Persona | Device | Lands on | Can do | Cannot do | SRS |
|---|---|---|---|---|---|
| **Owner / Admin** | Web (full) + Mobile (viewer) | Dashboard | Everything: setup, config, costing, reports, manage people | — | `FR-M19-2` |
| **Manager** | Web + Mobile | Operations dashboard (no financials) | Assign tasks, view production/health, run ops reports, record data | See costs/margins/revenue, configure worker profiles, manage employees, export financials | `FR-M19-2`, `FR-M13-1` |
| **Worker** | Mobile (Android-first) | Today's Tasks | Record assigned data offline | See anything owner hid; configure; view reports | `FR-M16-*` |
| **Vet / Agronomist** (external) | Mobile/Web | Assigned-units health view | Read health/sampling history, add advisory note / prescription on assigned units only | See financials, other units, edit production records | `FR-M5-5` |
| **Auditor / Investor** (read-only, time-boxed) | Web | Scoped report set | View reports/dashboards via expiring link; export if granted | Edit anything; see beyond scope/time window | `FR-M15-6`, `SEC-1` |
| **Super-Admin** (platform operator) | Web (ops console at `/admin/dashboard`) | Farms & Subscriptions list | Per-farm **plan** (free/standard/pro) + per-feature ON/OFF toggles | Edit a tenant's operational/financial data directly | `SEC-3` |

---

## 4. Information Architecture

### 4.1 Worker mobile (Android/PWA) — as-built
Three-tab bottom bar: **🏠 Home · 📋 Record · 👤 Profile**. Top bar shows the page title + `SyncBadge` + logout.
```
Login (Phone + PIN) → Home
│
├─ 🏠 HOME  ◄ default  (/worker/home)
│   ├─ Greeting ("Good morning, {first name}") · date · "↑ N pending" sync badge
│   ├─ ⚠ Alerts: unacknowledged cards (red/amber/blue + StatusChip)
│   ├─ 📋 Today's Tasks (color+icon+text: ⛔Overdue ▲Due ✓Done; icon per task type)
│   └─ ➕ Record: 2-col grid of 8 quick links →
│        🥚 Collect Products · 🌅 Morning Round · 💀 Mortality · 🌾 Feeding ·
│        💉 Health/Vaccine · ⚖️ Weight Sample · 🔢 Physical Count · 📦 Closing Stock
│
├─ 📋 RECORD FLOWS  (each works fully offline; tab default = Morning Round)
│   ├─ 🥚 Collect Products  (batch → product → quantity)   ← drives the dashboard charts
│   ├─ 🌅 Morning Round (guided: start → unit → fields → next)
│   │     • Poultry card (eggs+cracked)  • Fish/Pond card (water colour + DO/pH/temp/ammonia)
│   ├─ 🌾 Feeding Log (searchable feed w/ live stock; FIFO decrement)
│   ├─ 💀 Mortality (stepper + mandatory photo per config + auto-GPS)
│   ├─ 💉 Health / Vaccination (consumes lot, sets withdrawal)
│   ├─ ⚖️ Weight Sampling (ADG)
│   ├─ 🔢 Physical Count / Reconciliation (variance + reason)
│   └─ 📦 Closing Stock Count (variance)
│
└─ 👤 PROFILE
    ├─ Today's completed records   ├─ High-contrast/sunlight mode
    ├─ Language EN/SW              └─ Logout
```
> **Note (as-built):** the worker quick-record grid is `🥚 Collect Products` first; the dedicated Water-Quality reading from the inception draft is folded into the **Morning Round fish/pond card**, not a separate flow.

### 4.2 Owner web portal (as-built)
Shell = **jungle-green left sidebar** (desktop) + **mobile bottom tab bar** (first 6 items) + a sticky white top header with breadcrumb, a **notification bell** (red unacknowledged-alert count badge), name/role and logout. Nav items below are **plan-gated** by `/api/me` features. The old dashboard "quick-link" cards and the on-dashboard "active alerts" list were **removed** — redundant with the menu and the bell.
```
Login (email/phone + password)
│
Sidebar (top→bottom):  Dashboard · Farm · Inventory · Finance* · People · Activity* · Config · Reports* · Alerts*
                       (* feature-gated)   Top header: 🔔 bell with red unack-count badge
│
├─ DASHBOARD ◄ default — 8 redesigned KPI cards (icon chip + value + label) ·
│      "Daily Production & Revenue" chart (stacked bars by REAL product name + revenue line)
│      (no quick-links, no on-page alert list)
├─ FARM (🐄)
│   ├─ Production Units heatmap (density/mortality colour)   ├─ Batches table (age, qty, mortality, stage, status)
│   ├─ Add Unit / Add Batch (batch picks an enterprise → auto-creates products)
│   └─ Batch detail: per-batch Products panel (add/edit name, units, prices) · Worker Activity feed (photo thumbs + 📍GPS)
├─ INVENTORY (📦) — tabs: Stock & Lots (FIFO, expiry, WD) · Feed Formulation (recipe builder) · Variance Flags
├─ FINANCE (💰) — Record Sale (product-driven, price prefills) · tabs: Sales (WD check) · Purchases · Batch P&L
├─ PEOPLE — employees & roles
├─ ACTIVITY (📝) — farm-wide worker log, by worker + by day, photo thumbs + GPS
├─ CONFIG (⚙️) — ★ Worker Portal Config (field-level permissions + photo threshold)
├─ REPORTS — exports (gated by `reports` feature)
└─ ALERTS (🔔) — active (clickable → responsible screen) · acknowledged · editable alert rules
```

### 4.3 Manager portal
Same shell as Owner web/mobile, **financial nodes and Worker-Portal-Config removed**; Inventory shows quantities but **not costs**; Batches show production/health/FCR but **not margin/cost** (`FR-M19-2`). Manager can assign tasks and record data.

### 4.4 Vet/Agronomist portal (lightweight)
```
Login → Assigned Units list → Unit/Batch Health Timeline (read)
   → [+ Advisory Note] / [+ Prescription] (treatment recommendation, dose, withdrawal note)
```
No financials, no other units (`FR-M5-5`).

### 4.5 Auditor portal (read-only, time-boxed)
```
Expiring link → scoped Dashboard + Report set (read) → Export (if granted)
Banner: "Read-only · access expires {date}"  (SEC-1, FR-M15-6)
```

### 4.6 Platform admin portal (super-admin — as-built, new)
A separate console at `/admin/dashboard` under a black "🛡️ Platform Admin" banner (shared `SignedInTopBar`).
```
Login (super-admin) → "Farms & Subscriptions"
   └─ One card per farm:  name · {batches/users/workers} ·
         [ Plan ▼ ] selector (free / standard / pro)
         feature grid — per-feature ON/OFF toggle buttons (green ON / grey OFF)
   "Changes apply on their farm's next page load."
```
This drives the plan-gating the owner portal reads from `/api/me`.

---

## 5. Global States (the unhappy & empty paths the draft omitted)

### 5.1 Connectivity & sync (`FR-M17-*`)
| State | UI |
|---|---|
| Offline | Persistent grey pill: "⤬ OFFLINE · 5 queued" |
| Syncing | Header cloud icon animates: "Syncing 5…" |
| Saved locally | Bottom toast: "✓ Saved — will sync" |
| Sync done | Toast: "✓ Synced to owner" |
| **Conflict** (`FR-M17-3`) | Red badge on sync icon → **Resolve Conflict** screen showing *mine* vs *server* side-by-side, capture times, and "Keep mine / Keep server"; loser preserved in conflict log |

### 5.2 Empty / first-run states (added — pilot day 1 must not look broken)
| Screen | Empty state |
|---|---|
| Worker Home | "No tasks yet. Your manager will assign them. Pull to refresh." + illustration |
| Owner Dashboard | "Your farm has no active batches yet." banner → Farm; progress lives in the floating Setup Guide |
| Production chart | "No production recorded yet — your workers' collections (eggs, milk, meat…) appear here." |
| Batch list | "No batches. Add your first batch →" CTA → Farm |
| Inventory variance | "No variance flags 🎉" · Alerts: "No active alerts 🎉" |
| Collect Products | "No products set for this batch yet. Ask the owner to add them." |

### 5.3 Validation / error states → mapped to business rules (added)
The UI must show **rule-specific** messages, not a generic error.

| Attempted action | UI response | Rule |
|---|---|---|
| Feed out more than on hand | Inline: "Only 37 kg of Layer Mash on hand" — submit disabled | `BR-1` |
| Record more deaths than alive | "Batch has 85 birds; cannot record 90 deaths" | `BR-2` |
| Harvest/sell more than alive | "Only 485 birds in batch" | `BR-3` |
| Mortality without required photo | Submit disabled; camera button pulses + "Photo required" | `BR-5` |
| **Sell within withdrawal/PHI window** | **Blocked/warn modal — see §6.9** | `BR-WD` |
| Physical count ≠ derived | Forces reason before accepting | `BR-12` |
| Expired lot consumption | "This lot expired {date}" — block or warn per config | `BR-7` |

### 5.4 Loading
- Skeleton placeholders on web (`NFR-P-2`); never a full-screen blocking spinner on the worker path.

---

## 6. Persona Journeys (screen-level)

### 6.1 Worker — Login
PIN/biometric (no password typing at 6 a.m.); EN/SW toggle visible; lands on Home (greeting + alerts + Today's Tasks + record grid). Connectivity badge shows immediately. `FR-M19-1`

### 6.1a Worker — Collect Products (as-built — drives the production charts)
The primary daily-yield capture, replacing the egg-only assumption. Products are per-batch and enterprise-specific.
```
┌──────────────────────────────────────────────┐
│ 🥚 Collect Products                          │
│ "Record what you collected — eggs, milk, …"  │
│ Batch   [ Layer #003 · 1200 ▼ ]              │
│ Product  [ Eggs ] [ Manure ]   ← 2-col grid  │
│          (name · "Collect daily" · "in pieces")│
│ Quantity collected (pieces)  [  360  ] (keypad)│
│ [ SUBMIT ]   → "✓ 360 pieces of Eggs saved — will sync" │
└──────────────────────────────────────────────┘
```
A pig/maize farm never sees "eggs" — the product buttons come from the batch's auto-provisioned catalog. Offline-enqueued as a `production` record; feeds the dashboard "Daily Production & Revenue" chart by real product name. `FR-M7-*`

### 6.2 Worker — Morning Round (incl. fish/water-quality — corrected egg control)
Guided session: **Start Round** (timestamp) → pick site → iterate units.

**Poultry cage card** (note: egg count is a **keypad**, not a stepper; "Abnormal?" has **no pre-selected default**):
```
┌──────────────────────────────────────────────┐
│ Cage A1 · Layer #003 · 85 birds             │
│ ──────────────────────────────────────────   │
│ 💧 Water     [ Low ] [ OK ✓ ] [ Full ]     │  ← toggle
│ 🌾 Feed left   [   5   ] kg     (keypad)    │
│ 🥚 Eggs        [  48   ]        (keypad)    │  ← was stepper (fixed)
│    cracked     [   2   ]                     │
│ ▲ Abnormal?    ( ) No   ( ) Yes  — required │  ← no default (fixed)
│ ──────────────────────────────────────────   │
│ [ SAVE & NEXT ]                              │
└──────────────────────────────────────────────┘
```

**Fish/pond card (added — `FR-M6-2`):**
```
┌──────────────────────────────────────────────┐
│ Pond 3 · Tilapia #011                        │
│ Water colour   [Clear][Green✓][Murky]        │
│ Temp °C  [27.5]   DO mg/L [5.8]   pH [7.2]   │  ← keypads, safe-range hints
│ Ammonia  [0.2]  ▲ shows AMBER if out of range│  (alert on sync, FR-M6-2)
│ 🌾 Feed given  [ 2.0 ] kg                     │
│ [ SAVE & NEXT ]                              │
└──────────────────────────────────────────────┘
```
End Round → summary ("48 eggs, 5 kg feed, 1 pond reading") → Finish → queued offline. `FR-M13-5`

### 6.3 Worker — Record Mortality (corrected: configurable threshold, real GPS)
```
┌──────────────────────────────────────────────┐
│ ⛔ Record Mortality                          │
│ Unit  [ Cage A1 ▼ ]                          │
│ Batch  Layer #003 · 85 → 83                  │
│ Deaths [ − ] 2 [ + ]            (stepper, small count) │
│ Cause  [ Sudden death ▼ ] (optional)         │
│ ─────────────────────────────────────────    │
│ 📷 Evidence Photo  — REQUIRED when deaths > threshold │  ← from config (FR-M9-2)
│   📍 GPS captured automatically (device API, not EXIF) │
│ ▲ Rate now 2.3% (threshold 2.0%)             │
│ [ SUBMIT ] (red) → ConfirmSheet:             │
│    "Recording 2 death(s) in Cage A1. Population → 83. │
│     This action is audited and cannot be silently undone." │
└──────────────────────────────────────────────┘
```
Photo is blocked-missing above the configured threshold ("Photo mandatory above {n} death(s)"). On confirm: population → 83; photo uploaded on sync and served via `/api/photos/[id]`; mortality alert raised; audit event written. `FR-M9-1/2/3`, `DS-6/7`

### 6.4 Worker — Feeding Log
Searchable feed dropdown shows live stock; quantity keypad; leftover/refusal optional; on submit decrements lot (FIFO) and adds to batch feed cost; low-stock alert if crossing threshold. `FR-M4-2/5`

### 6.5 Worker — Health / Vaccination
Batch → product (from inventory lot) → dose/route → optional photo → submit. System sets `next_due` and **`withdrawal_until`** and schedules reminder. Confirmation explicitly states: "Withdrawal until {date} — no sale of product before then." `FR-M5-1/2/3`

### 6.6 Worker — Weight Sampling (added — `FR-M6-1`)
```
Batch → Sample size [10] → Avg weight [1.85] kg  →  Save
System shows: "ADG 48 g/day · projected 2.5 kg by day 49"
```

### 6.7 Worker — Physical Count / Reconciliation (added — `FR-M3-7`, `BR-12`)
```
┌──────────────────────────────────────────────┐
│ Physical Count · Pen B (Pigs)                │
│ System expects: 94   (opening − deaths − sales)│
│ You counted:    [ 91 ]                        │
│ ▲ Variance −3 — reason required:             │
│ [ Missing — suspected theft ▼ ] + note       │
│ [ SUBMIT ADJUSTMENT ]                         │
└──────────────────────────────────────────────┘
```
Creates an audited Population Adjustment (never silent). `FR-M3-7`, `BR-10/12`

### 6.8 Worker — Closing Stock (added — `FR-M4-4`)
Per item, enter remaining qty → system computes consumption (opening + receipts − closing) and **flags variance** vs logged feedings on the owner dashboard.

### 6.9 Owner — Worker Portal Config (the moat) with **blocked-state honesty**
At `/owner/config` ("⚙️ Worker Portal Config"). Pick/create a **profile** (profile-selector buttons + "+ New Profile"), then set each field to one of **three states** (radio): Editable [green] / Read-only [blue] / Hidden [red], plus a **Required** checkbox (disabled when Hidden). The **mortality photo threshold** is set here with a −/+ stepper (feeds §6.3). Live phone-preview is `[SCOPE+]` (§13).
```
Profile:  [ Field Worker ✓ ] [ Vet ] [ + New Profile ]
FIELD                  EDITABLE  READ-ONLY  HIDDEN   REQUIRED
Feed unit cost (KES)     ( )       ( )       (•)        ✗
Feed quantity (kg)       (•)       ( )       ( )        ✓
Egg sale price           ( )       ( )       (•)        ✗
Mortality cause          (•)       ( )       ( )        ✓
Batch profit/loss        ( )       ( )       (•)        ✗
Photo required if deaths >   [ − ] 1 [ + ]    ← drives FR-M9-2
[ Save Profile ]   "Changes propagate on next sync."
```
`FR-M16-1/2`. An amber security note states hidden fields are stripped server-side before the response — not CSS-hidden — verified by tests asserting forbidden keys are absent from worker responses (`NFR-SEC-2`).

### 6.10 Owner — Batch Detail + Record Sale (corrected numbers + withdrawal-blocked state)
Header: `Broiler #005 · day 42 · 500 → 485`. KPI row: `FCR 2.4 (target ≤2.8 ✓) · Mortality 3.0% ✓ · Cost/kg KES 351`. Cost donut: Feed 75% / Chicks 16% / Meds 5% / Labor 4%.

**Coherent costing example (replaces the earlier incoherent one):**
> Cost-to-date ≈ KES 375,000 (chicks 60k + feed 280k + meds 20k + labor 15k). A **full harvest** of 485 birds × 2.2 kg = 1,067 kg × KES 400 = **426,800 revenue → gross margin +51,800**; cost/kg = 375,000 ÷ 1,067 = **KES 351**. A **partial** sale of 50 birds (≈110 kg → ~44,000) does **not** flip the batch positive — gross margin is *cumulative* (revenue-to-date − cost-to-date) and stays negative until enough is sold. The UI shows cumulative bars filling toward break-even, never a misleading instant flip. `FR-M10-1/4/6`

**Record Sale modal — product-driven (as-built, `FR-M11-1`):**
```
Record a Sale
  Batch    [ Broiler #005 ▼ ]
  Product  [ Meat ▼ ]          ← from batch catalog; disabled until batch picked
  Sale unit[ Crate — KES 500 ▼ ]  ← price PREFILLS from the chosen unit
  Quantity [ 12 ]   Price/unit (KES) [ 500 ]   Total: KES 6,000
  Buyer    [ ____ ]   [ Save Sale ]
```
**Withdrawal check (`BR-WD`):** each row in the Finance → Sales tab carries a WD-check StatusChip — `✓ Cleared` (withdrawal elapsed) or `⛔ Blocked` (still inside a vaccine/medication withdrawal window) so unsafe-window sales are flagged rather than silent.

### 6.11 Owner — Onboarding: Setup Guide + Wizard (as-built, no seed data)
The system runs with **no seed data**; onboarding is driven two ways:
- **Floating Setup Guide** (📖, bottom-right drawer, progress badge `{done}/{total}`, persisted in `localStorage`). Three phases with deep-links into the right page:
  *Phase 1 — Set up your farm (~20 min):* units → batches → check products & set prices → stock the store → add workers → choose what each worker sees → alert rules.
  *Phase 2 — Run it every day:* assign tasks → workers record in the field → record sales & purchases.
  *Phase 3 — See your results:* watch the dashboard → open any batch's P&L → export reports.
- **Setup Wizard** (linked "⁺ Setup Wizard" from the dashboard): Farm → Units → Batches (qty, age, cost) → Inventory → Employees+PIN → Worker profile → Thresholds, with an enterprise **template grid** (🐔 Layers/Broilers · 🐖 Fatten/Breed · 🐟 Tilapia/Catfish · 🌽 Maize) that auto-provisions products, worker `collect_*` permissions, and an "assign a collector" alert. `FR-M1-2/3/4`

### 6.12 Manager — daily flow
Operations dashboard (no money): assign/track tasks, review production & health, run production/mortality reports, record data. Financial widgets simply absent. `FR-M19-2`, `FR-M13-1`

### 6.13 Vet/Agronomist — review & prescribe
Assigned-units list → batch health timeline (vaccinations, treatments, mortality curve, photos) → **+ Prescription** (product, dose, withdrawal note) → owner/worker notified; appears as a suggested task. `FR-M5-5`

### 6.14 Auditor — verify
Open expiring link → read-only dashboard + impact/financial reports within scope → export if granted. Persistent "Read-only · expires {date}" banner. `FR-M15-6`

### 6.15 Owner/Manager — AI Farm Advisor (as-built, new)
A floating **🤖 AI Advisor** (bottom-left), gated by the `ai_advisor` feature. Opens a chat panel ("🤖 AI Farm Advisor · Uses your live data · remembers this chat") with starter prompts ("Why might my mortality be high?", "How can I cut my feed cost?", "Which batch is most profitable?", "What should I record more of?"). Answers are **grounded** in live farm data (KPIs, batches, active alerts, low stock, recent production); the conversation is **multi-turn and persisted in `localStorage`** (survives reloads; "Clear" resets it). Degrades gracefully when no model key is configured.

### 6.16 Super-Admin — manage tenants & plans (as-built, new)
At `/admin/dashboard` ("Farms & Subscriptions"): one card per farm with a **Plan selector** (free / standard / pro) and a **per-feature ON/OFF toggle grid**. Changes take effect on the farm's next page load and gate that owner's nav, Setup Guide, and AI Advisor (§4.6).

---

## 7. Component Library (interaction patterns)

| Component | Use | Behavior |
|---|---|---|
| Segmented toggle | water level, yes/no | one tap; selected = filled + icon + text |
| Numeric keypad field | eggs, kg, weights, pH | large digits, unit suffix, decimal where valid |
| Stepper `+/−` | small counts (deaths) | haptic; bounds-checked to population (`BR-2`) |
| Searchable select | batch, feed, product | shows live stock/context in label |
| Camera capture | evidence | native camera → thumbnail → separate GPS attach (`DS-6`) |
| Status chip | any status | **color + icon + text** always (`DS-1/2`) |
| Confirm sheet | mortality, count, health treatment | summary + explicit confirm; `danger` flag for irreversible acts |
| Product button grid | Collect Products, batch products | 2-col tappable cards (name · frequency · base unit), per-batch catalog |
| KPI card | owner dashboard | tinted icon chip + value + label; threshold colour-shift (no sparklines) |
| Notification bell | owner top header | lucide `Bell` + red unack-alert count badge → routes to Alerts |
| AI Advisor panel | owner/manager (`ai_advisor`) | floating "🤖 AI Advisor"; grounded chat, history in `localStorage` (§6.15) |
| Setup Guide drawer | owner (`setup_guide`) | floating "📖 Setup Guide"; phased steps + progress, deep-links (§6.11) |
| Conflict resolver | sync conflict | side-by-side mine/server (`FR-M17-3`) |

---

## 8. Data Visualization (owner/auditor)

| Chart | Where | Shows |
|---|---|---|
| KPI cards (icon chip + value + label) | dashboard | 8 live metrics; **no sparklines** — values colour-shift on threshold |
| **Stacked bar + revenue line** | dashboard ("Daily Production & Revenue") | daily output stacked by **real product name** (Eggs, Manure, Pork…) + a daily-revenue line; never a generic "produced" total |
| **Cumulative cost vs revenue** | batch P&L / detail | cumulative cost vs revenue toward break-even (`FR-M10-6`) — honest cumulative, no instant flips |
| Farm heatmap | farm units | stocking density / mortality coloured per unit |

---

## 9. Responsiveness & Navigation
- Worker: portrait-only; **3-tab bottom bar (🏠 Home · 📋 Record · 👤 Profile)**; the record grid on Home is the launchpad for the 8 flows; step-through between units in Morning Round.
- Owner web: jungle-green **left sidebar** (desktop) collapses to a **mobile bottom tab bar** (first 6 items); the **notification bell** with red unack-count badge sits in the top header. Nav items are plan-gated. `NFR-U-1`

---

## 10. Accessibility & Field Conditions
- `A11Y-1` Color never sole signal (`DS-2`); sunlight/high-contrast mode (`DS-1`).
- `A11Y-2` Targets ≥ 48 dp; primary actions one-thumb reachable.
- `A11Y-3` EN/SW runtime toggle (`NFR-L-2`); icons accompany text for low literacy.
- `A11Y-4` Works on ≤ 2 GB RAM Android without crashing (`NFR-U-3`).
- `A11Y-5` Usable with dusty/wet hands: large targets, no tiny long-press-only actions.

---

## 11. Open Design Decisions (need owner input before/at build)
1. QR codes on units — print/stick at pilot, or skip for v1? (affects §6.3 scan)
2. Worker biometric vs PIN-only on shared phones — default?
3. Sunlight mode: manual toggle vs auto via ambient sensor?
4. Withdrawal override: owner-only with reason (current assumption) — confirm.
5. Owner mobile: viewer-only confirmed, or allow light config?

---

## 12. Traceability (UI surface → SRS)
| UI surface | SRS |
|---|---|
| Collect Products → production charts | `FR-M7-*` |
| Morning Round cards (incl. pond) | `FR-M13-5`, `FR-M6-2`, `FR-M7-1` |
| Mortality + photo + GPS (served via `/api/photos/[id]`) | `FR-M9-1/2/3`, `DS-6/7` |
| Worker Activity feed (per-batch + farm-wide) | `FR-M9-*`, `FR-M13-5` |
| Feeding / closing stock / variance | `FR-M4-2/4/5` |
| Health / withdrawal | `FR-M5-1/2/3`, `BR-WD` |
| Weight sampling | `FR-M6-1` |
| Physical count | `FR-M3-7`, `BR-12` |
| Worker portal config | `FR-M16-1/2`, `NFR-SEC-2` |
| Batch P&L + sale | `FR-M10-*`, `FR-M11-1` |
| Setup wizard | `FR-M1-2/3/4` |
| Manager portal | `FR-M19-2`, `FR-M13-1` |
| Vet portal | `FR-M5-5` |
| Auditor portal | `FR-M15-6`, `SEC-1` |
| Platform-admin plans & feature toggles | `SEC-3` (as-built) |
| AI Farm Advisor (grounded, persisted chat) | as-built |
| Alert bell badge + clickable → responsible screen | `FR-M14-*` |
| Offline/conflict/empty/error states | `FR-M17-*`, `BR-1/2/3/5/7/12` |

---

## 13. `[SCOPE+]` — items NOT in SRS v1.0 (do not build for MVP without a decision)
| Item | Where introduced | Recommendation |
|---|---|---|
| Owner 2FA at login | §4.2 | Defer to Phase 2 unless investor security requires; add `FR` first |
| Live phone-mockup preview in worker config | §6.9 | Nice-to-have; Phase 2 |
| QR scan on units | §6.3 | Optional; decide in §11 |
| Auto sunlight mode via ambient sensor | §10 | Manual toggle for MVP |

> Nothing in this list ships in the MVP unless it is first added to the SRS with its own `FR-`/`NFR-` ID. This keeps the design honest to the spec.

---

*End of Design Document v1.0. Build the `M`-priority SRS items using these layouts; the SRS state machines (§4.3) decide when controls are enabled, this document decides how they look and behave. Unhappy paths, empty states, and all six personas are now specified — the inception is complete enough to start.*
