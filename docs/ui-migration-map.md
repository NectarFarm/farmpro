# UI Migration Map — Reference (Grok/Vite) → IFMS (Next.js)

Source of the target design: `scratchpad/grok/` (Vite + TanStack Router, mock data).
Source of truth for data/behaviour: this repo's `app/api/*` and `components/farm/*`.
Rule used throughout: reference **look** wins, local **data** wins. Where the reference shows something our API can't back, the port shows an honest empty/"not tracked" state — never fake numbers.

## 0. Decisions made

**Overrides (lead designer, 2026-09-22), these win over the table below:**
- **D9 overridden:** the mobile bar is owner Home · Tasks · Units · Finance · **More**, manager Home · Tasks · Units · Inventory · **More**. "More" opens a bottom sheet holding the full role-gated sidebar IA, which includes Settings. The foundation package owns this.
- **D11 overridden:** Worker, Vet and Auditor are **in scope** (package I: phone-first, workers live on Android). Platform-admin gets a full rebuild as the **Admin console** (package H), with the new back office (plans/billing, support tickets, staff capabilities; see docs/backoffice-api.md once it lands) and a customer portal (Plan & billing, Support). Only the "no reference to port from" part of D11 stands: those screens are designed fresh with the ui-kit, keeping the same design intent.

No open questions are carried forward. Where the brief would normally ask "which way should we go," here is the call and why.

| # | Decision | Rationale |
|---|---|---|
| D1 | Reference's **Sites** page (`/dimensions` route, farm→division→house→batch tree) is **not** the same feature as local's `dimensions` ScreenId (GL analytical-dimensions register — Business Central-style codes/segments/account-requirement rules, real backend, real screen). Build Sites as a **new** screen (`components/farm/sites.tsx`, new ScreenId `sites`) instead of overloading the existing one. | The two "dimensions" words collide by accident, not by design. Renaming or merging either real feature to make the words match would destroy working functionality for a coincidence of naming. |
| D2 | Local's GL Dimensions register keeps its own nav row, relabelled **"GL Dimensions"** (was "By farm & house" — the old label was already describing Sites, a feature that didn't exist yet). The new Sites screen takes the "By farm & house" job and sits in the **Farm** sidebar group, not Money. | Money group is for the ledger's configuration; "where do my animals live" is a Farm question, matching where reference puts it (its Company section, but reachable from Units in one tap either way — see D3). |
| D3 | Sites is not a new top-level sidebar destination. It is a **5th tab on the existing Units screen** (`crops.tsx`, `params.tab=sites`), reusing the units/batches/farms data that screen already fetches. | Zero new API calls, zero new top-level nav row to justify to the foundation package, and it sits next to the Units/Livestock/Crops/Products tabs it summarises — exactly where reference's own farmer expects a "structure" view to live relative to a "list" view. |
| D4 | Reference's **Advisor** page (3 hardcoded notes with canned links) is **not** ported as a features-parity target. Local's `ai-chat.tsx` (real `POST /api/ai/advise`, grounded chat) is kept as the Advisor screen and only its chrome (header, kicker, layout rhythm) is restyled to match. | Shipping the reference's static notes would be a regression — local already has a working AI assistant. Copying the mock's fake content backwards is exactly the "never fake it" rule this map exists to enforce. |
| D5 | Reference's **Tasks** Queue/Crew/Week three-view structure replaces local's current List/Calendar two-view structure. | Reference's split (by-when / by-who / by-house-load) reads three different jobs; local's two views conflate "by-when" and "by-who" into one flat list. All the data (assigneeId, dueAt, unit inference) already exists locally — this is a pure restructure, no new fetch. |
| D6 | Reference's **Routines** page is a live daily clock (slot is live/done/next, "raise a missed-slot task"). Local's `routines.tsx` is a **configuration** editor for what a routine's steps are. Both are real and both stay — the port adds a **"Today"** tab (the live clock, default/first tab) in front of the existing editor, which is demoted to a **"Configure"** tab. | The clock is buildable today from existing data (`GET /api/routines` + `GET /api/routine-runs`, farm-scoped) with no new backend. Dropping the config editor to build only the clock would regress a real feature; ignoring the clock would ignore the reference's actual point (routines are the farm's rhythm, not a settings page). |
| D7 | Reference's Inventory **"Mixes"** tab is dropped entirely, not ported even as an honest empty state. | `inventory.tsx`'s own header comment already documents "no feed-mix backend anywhere on this branch," and the comment referring to "the Feed Mix tab below" is stale — the tab doesn't currently render at all (three tabs: Stock/Purchases/Variance). Adding a dead tab back just to look complete would be the fake-UI failure mode this project explicitly avoids elsewhere (see Reports' honest "labour" handling). |
| D8 | Local's dedicated **Purchases** tab in Inventory (reference has no equivalent — purchases only surface inline in a stock line's dossier) is **kept as its own tab**, restyled but not removed. | It is a real, already-used surface (`GET/POST /api/purchases`) with its own detail needs (supplier, payment method); folding it back into a stock-line dossier would be a regression for a page that already works. |
| D9 | Reference's 4-item mobile tab bar (Home/Tasks/Units/Finance) is **not** adopted. Local keeps its role-specific 5-tab bars (owner: Home/Farm/Finance/Tasks/Manage; manager: Home/Farm/Tasks/Inventory/Manage). | Local's richer Settings/Manage surface (6 sub-screens: appearance, regional, notifications, security, stages, about) has no door on mobile without a "Manage" tab. Reference's Settings is a single flat 4-tab page and can afford to live one tap deeper; local's can't. |
| D10 | Reference's Setup page and local's `getting-started.tsx` are treated as the same screen (`EXISTS`), keeping local's **server-tracked** progress (`GET /api/setup-state`) rather than reverting to reference's client-only `setupDone` array. | Local is strictly more correct (survives refresh, shared across devices); reference's version is the mock's limitation, not a design choice worth copying. |
| D11 | Worker, Vet, Auditor and Platform-admin screens (11 files, zero reference equivalents) are **out of scope for this port**. They inherit the new design tokens automatically (global.css variables, ui-kit primitives) but no page-port package rewrites their layouts. | The reference app never modelled these roles at all — there is nothing to port them *to*. Rewriting working, real screens with no target design would be scope creep, not migration. |
| D12 | Shared non-screen modules — `ui-shared.tsx` (17 consumers), `icons.tsx` (31 consumers), `data.ts` (7 consumers), `data-table.tsx` (3 consumers), `status-timeline.tsx` (3 consumers) — are **frozen** for every port package. | They're cross-package dependencies today; two packages editing the same shared file breaks the "never touch the same file" rule as surely as navigation.tsx would. Any package that needs a change to one of these routes it through the foundation package (candidate: promote into `components/ui-kit/`). |

---

## 1. Target nav vs local nav

Reference `src/components/layout/nav-config.ts`:

| Section | Item | Reference route |
|---|---|---|
| Overview | Dashboard | `/dashboard` |
| Overview | Setup (badge) | `/setup` |
| Farm | Units | `/units` |
| Farm | Inventory | `/inventory` |
| Farm | People | `/people` |
| Daily | Tasks (badge) | `/tasks` |
| Daily | Routines | `/routines` |
| Daily | Weather | `/weather` |
| Daily | Advisor | `/advisor` |
| Company | Governance | `/` |
| Company | Finance | `/finance` |
| Company | Sites | `/dimensions` |
| Company | Reports | `/reports` |
| Company | Settings | `/settings` |

Mobile tab bar (reference): Home, Tasks, Units, Finance.

### Mapping to local ScreenIds

| Reference item | Local ScreenId(s) | Status |
|---|---|---|
| Dashboard | `dashboard` | EXISTS |
| Setup | `getting-started` (+ `setup-progress.tsx` widget, also embedded on Dashboard) | EXISTS |
| Units | `crops` (tabs `livestock`/`crops`/`units`/`products` — **already the exact same four tabs as reference**) + `batch-detail` + `crop-schedule` | EXISTS |
| — (new, D1–D3) | `sites` (new) — a 5th tab on `crops` | NEW, see D3 |
| Inventory | `inventory` (+ `inventory-detail`) | EXISTS, restructured tabs (D7/D8) |
| People | `people` (+ `people-detail`) | EXISTS |
| Tasks | `tasks` | EXISTS, restructured views (D5) |
| Routines | `routines` | PARTIAL → EXISTS after D6 |
| Weather | `weather` | EXISTS |
| Advisor | `ai-chat` | EXISTS, different paradigm kept (D4) |
| Governance | `governance` | EXISTS — **owned by the foundation package, in progress; not touched by any port package** |
| Finance | `finance` | EXISTS |
| Sites | `sites` (new) | NEW, see D1–D3 |
| Reports | `reports` | EXISTS |
| Settings | `settings` + `security-settings` + `ui-customise` + `about` + `getting-started` + `notification-settings` + `farm-config` | EXISTS — 1 reference page maps to 7 local screens (local is more granular; kept, see §2) |

### Local nav entries with no reference slot

| Local entry | Where it goes in the target IA |
|---|---|
| `notifications` (bell icon, sidebar row) | Stays as its own screen; reference has no notification centre (only a "Notices" popover). No reference layout to imitate — keep local's list-with-mark-read layout, apply new visual tokens only. |
| `notification-settings` | Stays; reached from Settings, same as today. |
| `security-settings` | Stays; reached from Settings' profile card and "Security & access" row, same as today. |
| `ui-customise` | Stays; reached from Settings → "Farm Setup" → "UI Customise". |
| `about` | Stays; reached from Settings → "App" → "About IFMS". |
| `farm-config` (Stages/Products/Structure) | Stages/Products tabs stay, reached from Settings and from the Units screen's "Farm" tab-menu. **Structure tab is deleted** — it was only a set of links to Units/Routines/People/Governance, and D3's new Sites screen now covers that job better. |
| `role-notice` | Stays (vet/auditor deep-link guard); no visual target, cosmetic pass only. |
| `worker-*`, `admin-*`, `auditor-reports`, `vet-herd` | Out of scope, D11. |

---

## 2. Per reference page

For each page: layout, hero element (what the eye lands on / the job it exists for), what's demoted, and its features mapped to local.

### Dashboard
**Reference layout**: greeting header → alert chips (overdue/approvals/low-stock) → setup-progress card → **revenue hero card** (big KSh figure, M/Q/Y segmented control, mini area chart, In/Out/Net row) → 3-up stat tiles (batches/tasks/approvals) → weather teaser row → work-queue list → "Go to" icon grid.
**Hero element**: the revenue card — big number + chart, tap-through to Finance. Everything else is a status chip or a door.
**Demoted**: the "Go to" grid (8 icon tiles) is filler for screens the sidebar already lists — kept small, bottom of page, never above the fold.

| Feature | Local screen/component | Endpoint | Status |
|---|---|---|---|
| Greeting + farm/date header | `dashboard.tsx` | `GET /api/settings` (custom greeting) | EXISTS |
| Alert chips (overdue/approvals/low stock) | `dashboard.tsx` | `GET /api/tasks?due=today`, `GET /api/dashboard/kpis` | EXISTS |
| Setup progress card | embedded `SetupChecklist` (`setup-progress.tsx`) | `GET /api/setup-state` | EXISTS, server-tracked (better than reference) |
| Revenue hero + M/Q/Y range + chart | `dashboard.tsx` | `GET /api/dashboard/kpis?period=` | EXISTS |
| Batches/Tasks/Approvals tiles | `dashboard.tsx` | `GET /api/dashboard/kpis` | EXISTS |
| Weather teaser | `dashboard.tsx` | not currently wired — dashboard shows tasks/notifications, no weather strip today | PARTIAL — add a one-line "Weather" teaser card reading `GET /api/weather` for the active farm; endpoint exists, just not called from Dashboard yet |
| Work queue (overdue → today → upcoming) | `dashboard.tsx` | `GET /api/tasks?due=today&farmId=` | EXISTS |
| "Go to" grid | `dashboard.tsx` | n/a (links) | EXISTS |
| Notifications bell | `dashboard.tsx` (`NotificationsScreen`) | `GET/PATCH /api/notifications` | EXISTS, richer (own screen + settings) |

### Setup
**Reference layout**: header with "N of 9 done" → vertical numbered list, done rows tinted green, next row ringed, each with a "Do this now" / "Mark done" button.
**Hero element**: the next actionable step — visually ringed, only one at a time.
**Local**: `getting-started.tsx` renders the exact same shape via `SetupChecklist`, fed by real `GET /api/setup-state` instead of a client array. EXISTS. 9 steps locally (`lib/onboarding-guide.ts`): sign-in, farm, units, batch, products, stock, employees, routines, approvals — a different 9 than reference's (profile, houses, stock, people, bank, rules, products, feed, health) but the same shape and same job; no content changes needed, only chrome.

### Units (livestock / crops / houses / products)
**Reference layout**: KPI row (Livestock/Crops/Animals/Placement cost) → farm chips → 4-tab segmented control (Livestock/Crops/Houses/Products) → status chip filter → list (left) + dossier (right, desktop) / Inspector sheet (mobile).
**Hero element**: the list+dossier split — picking a row is the whole interaction; the dossier is where the read happens.
**Demoted**: the KPI row is a strip, not tiles — four numbers in one row, not four cards.

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| 4 tabs Livestock/Crops/Houses/Products | `units-page.tsx` TABS | `crops.tsx` `CROPS_TABS` — **identical 4 tabs already** | `GET /api/batches`, `GET /api/units`, `GET /api/products` | EXISTS |
| KPI strip | `Kpi` row | summary strip (`crops.tsx` lines ~746-759) | same | EXISTS |
| Farm chips | `Chips` | farm filter chip row (`activeFarm === 'ALL'`) | n/a | EXISTS |
| Status filter chips | `STATUSES` | filter row (ACTIVE/QUARANTINE/CLOSED/HARVESTED) | n/a | EXISTS |
| List + dossier / mobile Inspector | `FileCard`/`Inspector` | today: **full-screen navigate to `batch-detail`**, no split-pane | n/a | PARTIAL — port the reference's master-detail layout: desktop shows list + inline dossier pane; batch-detail's full richness (below) becomes the dossier's content instead of a separate screen. Mobile keeps a full push (reference does the same on mobile via Inspector, functionally a screen push). |
| Add product sheet | `ProductDialog` | `AddProductSheet` | `POST /api/products` | EXISTS |
| Add unit ("house") | implicit via product dialog only | `AddUnitSheet` | `POST /api/units` | EXISTS, local is more complete (reference has no add-unit flow at all) |
| Batch/enterprise creation | n/a (reference has no create-batch flow, only seed data) | `CropScheduleScreen` — 4-step wizard (basics → unit → schedule/cost → worker assignment) | `POST /api/units`, `POST /api/batches`, `PATCH /api/employees/[id]` | EXISTS, local-only, far richer — keep entirely |
| Batch file: head/stage/mortality/cost/dates | `FileBody` | `BatchDetailScreen` hero card | `GET /api/batches/[id]` | EXISTS |
| Batch head-count **ledger** (who changed it, deaths vs correction) | none | `BatchLedger` | `GET /api/batches/[id]/movements` | LOCAL-ONLY, keep (§3) |
| Batch cost breakdown / revenue / margin | reference: sold-so-far KV lines | `costTab === 'breakdown'` | `GET /api/batches/[id]/cost-breakdown` | EXISTS, more structured (tracked-vs-not-tracked categories) |
| Batch "Processes" (routine completion per batch) | none | `costTab === 'processes'` | `GET /api/routines`, `GET /api/routine-runs?batchId=` | LOCAL-ONLY, keep (§3) |
| Unit transfer | none | `showTransferForm` | `PATCH /api/batches/[id]` | LOCAL-ONLY, keep |
| Advance stage | free-text stage in reference | dropdown of farm-configured stages | `PATCH /api/batches/[id]`, `GET /api/stages` | EXISTS, better (reference lets typos through) |
| Products inherited from unit + override sheet | none (reference has no per-unit product config) | `BatchProductOverridesSheet`, `UnitProductsSheet` | `GET/PUT /api/batches/[id]/products`, `GET/PUT /api/units/[id]/products` | LOCAL-ONLY, keep |
| CSV import for units/batches | none | **not present in crops.tsx** (CSV import only exists for Inventory and People) | n/a | N/A — no gap, reference has none either |
| Structure/Sites tree | `structure-map.tsx` `StructureWorkspace` | none today | `GET /api/farms`, `GET /api/units`, `GET /api/batches` (all existing) | NEW — build as 5th tab, D1–D3 |

### Inventory
**Reference layout**: header + 2 action buttons (Add mix / Record purchase) → 4 stat tiles → 3-tab segmented (Stock/Mixes/Lots) → list+dossier.
**Hero element**: the Stock list, sorted by days-of-cover ascending — the shortest bar is what the eye finds first.
**Demoted**: Mixes tab dropped (D7).

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| Stock list (days-of-cover bar, sorted worst-first) | `StockBoard` | `tab === 'stock'` | `GET /api/inventory/items` | EXISTS |
| Record purchase | `PurchaseDialog` | purchase sheet | `POST /api/purchases` | EXISTS |
| Purchases as own tab | not a tab (inline in dossier) | `tab === 'purchases'` | `GET /api/purchases` | LOCAL-ONLY, keep as own tab (D8) |
| Lots / recount-needed | `LotsBoard` | `tab === 'variance'` (staleness-based) | `GET /api/inventory/variance`, `PATCH /api/inventory/lots/[id]` | EXISTS, different name/shape — relabel local's "Variance" tab title to **"Lots"** to match reference's mental model, keep the reason-required adjustment flow (richer than reference's read-only lot list) |
| Item usage history | none | usage-history view | `GET /api/inventory/items/[id]/usage-history` | LOCAL-ONLY, keep |
| Mixes (feed formulas) | `MixBoard`, live-preview composer | none | none | NO BACKEND — drop entirely, D7 |
| CSV import (stock items) | none | `CsvImportModal` trigger in Inventory toolbar | n/a | LOCAL-ONLY, keep — reference has no bulk import anywhere |

### People
**Reference layout**: header → avatar-led list (name, title/farm, role badge) → tap opens Inspector (title/farm/email/salary/open-tasks KV list) → footer link "See what this role can do" → Governance.
**Hero element**: the list itself — one line per person, role badge is the only colour.
**Local (`people.tsx`, richer)**:

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| Avatar + name + title/farm + role badge list | `People` route | directory list | `GET /api/employees` | EXISTS |
| Inspector: title/farm/email/salary/open tasks | `Inspector`/`Kv` | `PeopleDetailScreen` "profile" section | `GET /api/employees/[id]` | EXISTS |
| "See what this role can do" → Governance | link | link to role-permissions view | `GET /api/role-permissions` | EXISTS |
| Per-person permission overrides | none (only the fixed role matrix) | `PeopleDetailScreen` "permissions" section | `GET /api/role-permissions` | LOCAL-ONLY, keep |
| Payroll history per person | none | `PeopleDetailScreen` "payroll" section (payslips) | `GET /api/payroll/payslips?employeeId=` | LOCAL-ONLY, keep |
| Worker login provisioning (issue a phone+PIN account) | none | edit-employee flow | `POST /api/employees/[id]/login`, `POST /api/security/worker-pins` | LOCAL-ONLY, keep — reference's worker "PIN" login exists on the Login screen but nothing ever provisions one |
| Assigned batches | none | shown on employee edit/detail | `GET /api/batches` (batch-lite lookup) | LOCAL-ONLY, keep |
| CSV import (employees) | none | `CsvImportModal` trigger | n/a | LOCAL-ONLY, keep |

### Tasks
**Reference layout**: header + "Assign work" → 4 stat tiles (Overdue/Today/Coming/On the crew) → 3-view segmented (Queue/Crew/Week) → list+dossier.
**Hero element**: the Queue view's grouped list (overdue → today → upcoming → done) — the grouping headers are doing the work a filter would elsewhere.
**Local today**: List (grouped by status) + Calendar. Restructure per D5.

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| Queue (grouped by due bucket) | `Queue` | today's "List" view, ungrouped-ish | `GET /api/tasks` | EXISTS → regroup into overdue/today/upcoming/done sections (client-side, no new fetch) |
| Crew (grouped by assignee, load bar) | `Crew` | none | `GET /api/tasks` + `GET /api/employees` (both already fetched) | NEW view, no new backend — pure client aggregation, D5 |
| Week (7-day bar chart + day drill-in) | `Week` | "Calendar" view (already similar) | `GET /api/tasks` | EXISTS, rename to "Week" and align bar-chart visual |
| Assign task | `TaskDialog` | `AddTaskSheet` | `POST /api/tasks` | EXISTS |
| Task → "Open in Governance" when it needs approval | link | linked, plus **named approver** (who specifically must sign it) | `GET /api/approvals/approvers`, `PATCH /api/tasks/[id]` (status→approval) | EXISTS, richer than reference (reference has no per-task approver assignment) |
| Mark done | `markDone` | done action | `PATCH /api/tasks/[id]` | EXISTS |

### Routines
**Reference layout**: header + 3 mini stats (Closed/Live/Still ahead) → vertical timeline (dot colour = done/live/next) → dossier with "raise a missed-slot task" button.
**Hero element**: the live dot on the timeline — literally "where is the day right now."
**Local today**: pure configuration (define routines + steps, per farm/enterprise) — no live view. Per D6, add a "Today" tab in front.

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| Live daily clock (done/live/next per slot) | `Page` in `routines.tsx` route | none | `GET /api/routines`, `GET /api/routine-runs` (filter to today, client-side) | NEW "Today" tab, no new backend, D6 |
| "Raise a missed-slot task" | `raise()` | none | `POST /api/tasks` (existing) | NEW, part of the Today tab |
| Define a routine + its steps (feed/produce/deaths/count/health/weight/check) | none (reference has no config UI — routines are hardcoded seed data) | `RoutinesScreen` editor | `GET/POST/PATCH /api/routines`, `GET/PATCH /api/routines/[id]` | LOCAL-ONLY, keep as "Configure" tab, D6 |

### Weather
**Reference layout**: header → current-conditions hero card (big temp, one-line sky) with an embedded 7-day mini bar chart (hi/lo/rain) → "what the houses need" alert list → day-file dossier.
**Hero element**: the current-temp card — the number the farmer actually wants first thing.
**Local (richer)**:

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| Current conditions + 7-day strip | static `WEEK` array | real forecast | `GET /api/weather` | EXISTS, real (reference is 100% mock) |
| Per-house alerts tied to forecast | hardcoded `houses` per day | AI-generated recommendations, each tagged with its **basis** (records / forecast / general) and a source link when it's general web guidance | `GET /api/weather/advice` | EXISTS, substantially richer — keep the basis-tagging, it's the honesty mechanism this whole map is built around |
| "Assign the dusk cover" quick-task | `assignCover()` | none wired from Weather specifically | `POST /api/tasks` (existing) | PARTIAL — add a one-tap "Assign this" button on a recommendation card, reusing the existing task-create call |

### Advisor
Kept as local's real chat (D4). Reference's list+dossier shape (numbered notes on the left, detail on the right/Inspector on mobile) is **not** adopted — a chat transcript doesn't have discrete "rows" to master-detail. Chrome only: page header styled like every other Daily-section page (kicker/title/lede), suggested-prompt chips replacing reference's 3 hardcoded notes (chips can be generated from real dashboard signals — overdue tasks, low stock, pending approvals — as starting questions, not canned advice).

### Governance
Owned by the foundation package (in progress) — **not analysed for restyle here**, no port package touches `governance.tsx`. For reference: local's 3 tabs (Approvals/Roles/Activity Log) already match reference's 3 tabs (Approvals/Roles & rules/Audit trail) 1:1, and local's version is functionally ahead (named-approver review sheet that loads the underlying record before deciding; per-feature-group role permission matrix instead of a fixed CRUD table; role builder create/edit/delete). No feature gaps in either direction worth flagging beyond what the foundation package already knows.

### Finance
**Reference layout**: header + "Record sale/purchase/payroll" (label follows active tab) → 5-tab segmented (Overview/Sales/Expenses/GL accounts/Payroll) → Overview: money-in/out/net card + mini chart + Batch P&L table.
**Hero element**: the Overview tab's money-in/out/net card — three numbers, one tap to their source list.

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| 5 tabs Overview/Sales/Expenses/GL/Payroll | `TABS` | `finance.tsx` — **same 5 tabs already** (Expenses labelled "Expenses" too) | `GET /api/data/sales`, `/api/purchases`, `/api/gl/accounts`, `/api/gl/trial-balance`, `/api/payroll/runs` | EXISTS |
| Batch P&L table | inline table | composed from `cost-breakdown` per batch | `GET /api/batches`, `GET /api/batches/[id]/cost-breakdown` | EXISTS |
| Record sale/purchase/payroll | 3 dialogs | 3 sheets | `POST /api/data/sales`, `/api/purchases`, `/api/payroll/runs` | EXISTS |
| Export GL to CSV | `exportGl()` | export button | client-side CSV from `GET /api/gl/trial-balance` | EXISTS |

### Sites (new — reference's `/dimensions`)
**Reference layout**: 4-stat mini strip (Farms/Divisions/Houses/Head) → search box → indented tree (farm → division → house, with occupancy fill-bar and a "Q" badge for quarantined houses) → file panel on the right (or Inspector on mobile) showing whatever level is selected.
**Hero element**: the tree with inline occupancy bars — you can see which house is full without opening anything.
**Local**: does not exist yet. Build as `crops.tsx` tab `sites` (D3), reading the same `apiUnits`/`apiBatches`/`farms` the screen already has in state. "Division" is not a real local entity — group units by `unit.type` (house/pen/paddock/parlor), which is more honest than reference's species-sniffing heuristic (`divisionName()` in `structure-map.tsx` guesses "Layers" vs "Broilers" from species text). Occupancy = sum of `currentQty` of non-closed batches in a unit — no capacity column exists locally either, same honest limitation reference doesn't have (reference fakes a capacity number in seed data; local shows "no capacity tracked" rather than inventing one). **PARTIAL, buildable with zero new endpoints.**

### Reports
**Reference layout**: nav list of 7 report types (left) + a single "printed document" panel (right): letterhead header, headline figure tiles, itemised table, notes-and-basis block, collapsible "data fields returned."
**Hero element**: the document itself — this page's whole point is that it *looks* like something you'd hand to a bank.
**Local (`reports.tsx`)**: already renders the same document shape (`lib/report-export.ts`) for 7 report types, with a share-link feature reference also has (auditor link).

| Feature | Reference | Local | Endpoint | Status |
|---|---|---|---|---|
| P&L / Batch P&L / FCR / Feed / Mortality / Vaccination(=Treatments) / Production | 7 catalogued types | 8 catalogued types (adds Production, matches Vaccination↔Treatments) | `GET /api/reports/pl`, `/batch-pl`, `/fcr`, `/feed-consumption`, `/mortality`, `/vaccination`, `/production` | EXISTS |
| Labour & task cost | fudged (`"hours are estimated... not a timesheet"`) | **honestly blocked**, names exactly what's missing (no hours-worked record) | none | NO BACKEND — local's honest handling is already correct; do **not** copy reference's fake-hours estimate when porting the visual design |
| Export CSV / PDF | `exportCsv`/`exportPdf` | same | client-side from report payload | EXISTS |
| Auditor share link | `shareLink()` (fake token, clipboard only) | real, expiring, revocable | `GET/POST/DELETE /api/auditor-link` | EXISTS, real (reference's is decorative) |

### Settings
**Reference layout**: 4 tabs — Structure (embeds the Sites tree), Appearance (theme/text-size/regional/modules toggle), Access (PINs/sessions/backup/sign-out), Account (profile/alerts/stage progressions).
**Hero element**: whichever tab is open — this is a config page, not a page with one focal object; each tab's own hero is its first card (theme swatches on Appearance, the PIN form on Access).
**Local**: one hub screen (`settings.tsx`, "Manage") with profile card + 7 grouped sections, fanning out to 6 further screens. Reference's 4-tab flatness does **not** get imposed back onto local — local's IA is already more scalable (7 grouped sections vs 4 tabs that would each get overloaded). Apply reference's *visual* language (card-per-control, theme swatches with a live preview swatch, section eyebrows) onto local's existing groups.

| Reference tab | Local equivalent | Status |
|---|---|---|
| Structure (Sites tree) | superseded by new `sites` tab on Units (D1–D3); Settings' own "Structure" link (in `farm-config.tsx`) is deleted, replaced by a direct link to Units → Sites | EXISTS after D3 |
| Appearance (theme, text size) | Settings "Appearance & Accessibility" section | EXISTS, same 4 themes conceptually (local: Dark Farm/High Contrast/Light Farm/Sun Mode vs reference: Desk/Yard/Night/Contrast) — cosmetic rename only if desired, not required |
| Appearance (regional: currency/weight/timezone/date format) | Settings "Regional & Units" section | EXISTS |
| Appearance (modules toggle) | `ui-customise.tsx` (modules + **labels** + **branding**, richer) | EXISTS, richer |
| Access (worker PINs) | `security-settings.tsx` "Worker PINs" | EXISTS |
| Access (sessions) | `security-settings.tsx` "Active sessions" | EXISTS |
| Access (backup) | `security-settings.tsx` "Farm backup" | EXISTS |
| Access (change password) | Settings "Security" section → password modal | EXISTS |
| Account (profile) | Settings profile card | EXISTS |
| Account (stage progressions) | `farm-config.tsx` "Stages" tab | EXISTS, own screen instead of a Settings sub-section — reachable from Settings "Farm Setup" |
| Account (alerts note) | Settings "Notifications" section (push/sound marked "coming soon" honestly, not faked as working) | EXISTS, more honest than reference's static paragraph |

### Login / Apply / Reset
**Reference layout**: split screen — brand panel (left, hidden on mobile) with product pitch + 3 feature bullets; form panel (right) with a segmented Office/Field toggle (email+password vs phone+PIN).
**Hero element**: the segmented toggle itself — it's the one decision the page asks for before anything else.
**Local (`auth.tsx`)**: already implements the identical toggle (`email`/`pin` tabs, phone+PIN lockout logic, real `POST /api/auth/login`), plus a `RegisterScreen` with the same GPS-detect-location step as reference's Apply wizard. EXISTS, near 1:1 — restyle only (brand panel treatment, illustration/hills graphic is cosmetic and can be skipped or replaced with local branding).

---

## 3. Local features that must not be lost

| Feature | Current home | New home in target IA |
|---|---|---|
| CSV import (employees, inventory items) | `people.tsx`, `inventory.tsx` via `csv-import.tsx` | Same screens, restyled trigger button in each list's toolbar (reference has no import anywhere to conflict with) |
| Batch head-count ledger (movements: intake/mortality/sale/count/manual/transfer) | `crops.tsx` `BatchLedger` | Stays inside the Units batch dossier (§2 Units) |
| Batch "Processes" tab (real routine-run history per batch) | `crops.tsx` `BatchDetailScreen` | Stays inside the batch dossier, as a segmented sub-view next to "Breakdown" |
| Batch unit-transfer / advance-stage forms | `crops.tsx` | Stay inside the batch dossier's action row |
| Per-unit and per-batch product overrides (inheritance model) | `crops.tsx` | Stay — Units tab "Products" button, batch dossier "Customise" |
| Crop/batch creation wizard (4-step, worker assignment) | `crops.tsx` `CropScheduleScreen` | Stays as its own flow, launched from the Units screen's "+" |
| Farm Config: Stages editor, Products↔batches reverse-linker | `farm-config.tsx` | Stays as its own screen, reached from Settings "Farm Setup" and Units tab-menu; the "Structure" tab within it is deleted (D3) |
| Per-employee permission overrides, payroll payslip history, worker login/PIN provisioning | `people.tsx` | Stay inside People detail's Permissions/Payroll sections |
| Inventory usage-history, stale-lot variance with reason-required adjustment | `inventory.tsx` | Stay as Inventory's "Variance"/"Lots" tab (renamed, D-table above) |
| Named-approver assignment on tasks | `tasks.tsx` | Stays in the Assign-work sheet and task dossier |
| Routine step configuration (feed/produce/deaths/count/health/weight/check kinds) | `routines.tsx` | Stays as the "Configure" tab (D6) |
| Weather AI advice with basis-tagging (records/forecast/general) + source links | `weather.tsx` | Stays as the Weather page's alert list |
| Real AI chat advisor | `ai-chat.tsx` | Stays as the Advisor page's content (D4) |
| GL Dimensions register (codes/segments/account-requirement rules) | `dimensions.tsx` | Stays as its own screen, relabelled "GL Dimensions" (D2) |
| Auditor share-link (real, expiring, revocable) | `reports.tsx` | Stays |
| Notification centre + granular notification settings | `dashboard.tsx` (Notifications), `notification-settings` screen | Stay as-is |
| UI Customise: module toggle + label rename + branding (accent colour, logo emoji, dashboard greeting) | `ui-customise.tsx` | Stays as its own screen |
| About IFMS page | `about.tsx` | Stays, reached from Settings "App" |
| Getting-started / setup guide with server-tracked progress | `getting-started.tsx` | Stays, reached from Settings "App" and Dashboard's setup card |
| Worker portal (home, feeding/mortality/physical-count/routine-run recording forms, pay, profile) | `worker.tsx` | Untouched, out of scope (D11) |
| Vet herd-health screen | `vet.tsx` | Untouched, out of scope (D11) |
| Auditor read-only reports screen | `auditor.tsx` | Untouched, out of scope (D11) |
| Platform-admin suite (dashboard/farms/settings/onboarding/users incl. password-resets & impersonation log/enterprise requests) | `admin.tsx`, `admin-users.tsx`, `admin-onboarding.tsx`, `admin-enterprise-requests.tsx` | Untouched, out of scope (D11) |
| Farm-config "Structure" quick-links tab | `farm-config.tsx` | **Deleted** — superseded by the new Sites tab, which does the job with an actual tree instead of a list of links |

---

## 4. Moved features

- **Feed-mix UI** — used to be a planned/stale-commented tab in Inventory → **removed entirely** (D7). Nothing to move to; it never had a backend.
- **Farm-config's "Structure" tab** (links to Crops/Routines/People/Governance) — was in `farm-config.tsx` → **replaced by** the new Sites tab on the Units screen (`crops.tsx`, D3), which shows the actual tree instead of four links.
- **Settings' implied "Structure" tab** (reference has one, showing the Sites tree inline in Settings) — **does not get built in Settings at all** → lives only on the Units screen's new Sites tab (D3); Settings gets a one-line link across instead of a duplicate tree.
- **Tasks' flat List view** — was the default view in `tasks.tsx` → **becomes the "Queue" view**, regrouped by overdue/today/upcoming/done sections (D5).
- **Tasks' Calendar view** — was in `tasks.tsx` → **renamed "Week"**, restyled to reference's bar-chart day-picker (D5).
- **Tasks' by-assignee breakdown** — did not exist → **new "Crew" view**, built from data both Queue and the employee list already fetch (D5).
- **Routines' step-configuration UI** — was the *whole* `routines.tsx` screen → **demoted to a "Configure" tab**, second to a new "Today" live-clock tab (D6).
- **Weather's "assign work" affordance** — existed generically via Tasks, not from Weather → **surfaces directly on a recommendation card** in `weather.tsx` (one-tap task creation reusing the existing `POST /api/tasks`).
- **GL Dimensions register's nav label** — was "By farm & house" (`components/farm/navigation.tsx` `NAV.byFarm`) → **relabelled "GL Dimensions"** (foundation request, D2), freeing that label's meaning for the new Sites screen.

---

## 5. Screen port groups

Foundation package (already in progress, **no other package edits these**): `components/farm/navigation.tsx`, `app/global.css`, `app/page.tsx`, `components/ui-kit/*`, `components/farm/governance.tsx`.

**Requests for the foundation package to integrate:**
1. New ScreenId `sites` — no new screen file needed at the nav layer (it renders inside `crops.tsx` as a tab), but `app/page.tsx`'s switch doesn't need a new case since `sites` is reached via `crops` with `params.tab='sites'`, same mechanism as `livestock`/`units`/`products` today. **No `page.tsx` change needed at all** — only `navigation.tsx`'s `TAB_MENUS.crops.items` needs a 5th row (`{ screen: 'crops', params: { tab: 'sites' }, label: 'Sites', ... }`) and the desktop sidebar's "The farm" group needs the matching row.
2. Relabel `NAV.byFarm` from `'By farm & house'` to `'GL Dimensions'` in `navigation.tsx` (D2).
3. Delete the `farm-config` "Structure" tab's entry point *only if* the foundation wants Settings' own copy removed too — otherwise Package B (below) handles the in-file deletion alone.
4. Promote `status-timeline.tsx`, `ui-shared.tsx`, `icons.tsx`, `data.ts`, `data-table.tsx` into `components/ui-kit/` if/when the foundation wants a single shared-primitives location (not required for this port to proceed — packages below treat them as frozen either way, D12).

### Package A — Entry & Home
- **Owns**: `components/farm/auth.tsx`, `components/farm/dashboard.tsx`, `components/farm/getting-started.tsx`, `components/farm/setup-progress.tsx`
- **Ports from**: `src/components/auth/auth-pages.tsx`, `src/routes/login.tsx`/`apply.tsx`/`reset.tsx`, `src/components/dashboard/dashboard-page.tsx`, `src/routes/setup.tsx`
- **Moves its responsible for**: none from §4 (Dashboard/Setup/Auth are near-1:1, chrome-only restyle)
- **New work**: add a one-line Weather teaser card to Dashboard reading `GET /api/weather` (§2 Dashboard table)

### Package B — Farm structure (Units, Batches, Sites, Stages)
- **Owns**: `components/farm/crops.tsx`, `components/farm/farm-config.tsx`, new `components/farm/sites.tsx`-equivalent code (lives inside `crops.tsx` per D3, so no new file is strictly required — a package may still factor it into a co-located file it alone owns, e.g. `crops-sites-tab.tsx`, as long as `crops.tsx` imports it)
- **Ports from**: `src/components/units/units-page.tsx`, `src/components/farm/structure-map.tsx`
- **Moves its responsible for**: builds the new Sites tab (D1–D3); deletes `farm-config.tsx`'s "Structure" tab (§4)
- **Dependency note**: consumes but does not edit `status-timeline.tsx`, `data.ts` (D12)

### Package C — Inventory & People
- **Owns**: `components/farm/inventory.tsx`, `components/farm/people.tsx`
- **Ports from**: `src/components/inventory/inventory-page.tsx`, `src/routes/people.tsx`
- **Moves its responsible for**: none from §4; drops the Mixes tab (D7), keeps Purchases as its own tab (D8), renames Variance→Lots in the tab label only
- **Dependency note**: consumes but does not edit `csv-import.tsx`, `data-table.tsx`, `status-timeline.tsx` (D12) — if `csv-import.tsx`'s own look needs to change to match the new design, that's a shared request, not an in-package edit, since People also depends on it

### Package D — Tasks & Routines
- **Owns**: `components/farm/tasks.tsx`, `components/farm/routines.tsx`
- **Ports from**: `src/components/tasks/tasks-page.tsx`, `src/routes/routines.tsx`
- **Moves its responsible for**: List→Queue, Calendar→Week, new Crew view (D5); new "Today" live-clock tab + demoted "Configure" tab (D6)
- **Dependency note**: consumes but does not edit `status-timeline.tsx` (D12)

### Package E — Weather & Advisor
- **Owns**: `components/farm/weather.tsx`, `components/farm/ai-chat.tsx`
- **Ports from**: `src/routes/weather.tsx`, `src/routes/advisor.tsx`
- **Moves its responsible for**: one-tap "assign this" button on a weather recommendation card (§2 Weather)
- **New work**: keep D4's decision (chat stays, chrome-only restyle) — no structural change to `ai-chat.tsx`'s message flow

### Package F — Finance & Reports
- **Owns**: `components/farm/finance.tsx`, `components/farm/reports.tsx`
- **Ports from**: `src/components/finance/finance-page.tsx`, `src/components/reports/reports-page.tsx`
- **Moves its responsible for**: none from §4 — both are already near-1:1 with reference; restyle only
- **Explicit non-change**: keep the "Labour & task cost" report's honest not-available state; do not port reference's fudged-hours estimate

### Package G — Settings & Account surfaces
- **Owns**: `components/farm/settings.tsx`, `components/farm/ui-customise.tsx`, `components/farm/about.tsx`
- **Ports from**: `src/components/settings/settings-page.tsx`
- **Moves its responsible for**: replaces the Structure-tab link with a link to Units → Sites (D3/§4); no other structural change — local's 7-section hub stays flatter than reference's 4 tabs, restyled with reference's card/eyebrow visual language
- **Dependency note**: does not touch `security-settings` logic beyond restyling the screen it's declared in (same file as `settings.tsx`, `SecuritySettingsScreen`) — since it's the same file as Settings, this package owns it by definition, no separate ownership needed

Out of scope for every package (D11): `components/farm/worker.tsx`, `vet.tsx`, `auditor.tsx`, `admin.tsx`, `admin-users.tsx`, `admin-onboarding.tsx`, `admin-enterprise-requests.tsx`. These inherit new design tokens for free once the foundation's `global.css`/`ui-kit` land; no page-port package edits them.
