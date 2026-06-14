# Requirements Document — FarmPro Poultry Farm Management System

**Version**: 1.0  
**Date**: 2026-06-12  
**Status**: Approved

---

## 1. Introduction

### 1.1 Purpose
This document defines the functional and non-functional requirements for FarmPro, a web-based poultry farm management system designed for Kenyan commercial poultry operations. It serves as the single source of truth for what the system must do and how it must perform.

### 1.2 Scope
FarmPro covers the complete operational lifecycle of a poultry farm: bird acquisition, growth stage management, feed and health monitoring, egg production, sales, financial reporting, and customer relationship management. It replaces manual record-keeping with a role-based digital system accessible on any device.

### 1.3 Stakeholders

| Role | Description | Access Level |
|---|---|---|
| **Farm Owner** | Business owner, sees all data, approves deletions, configures system | Full access |
| **Employee** | Farm worker, logs daily operations (eggs, feed, mortality) | Restricted data entry |
| **Customer** | Buyer of eggs or chicks, uses portal for orders | Self-service portal |

---

## 2. Functional Requirements

### 2.1 Authentication (AUTH)

| ID | Requirement |
|---|---|
| AUTH-01 | System shall authenticate users via a 4-digit numeric PIN |
| AUTH-02 | There shall be exactly one owner account; owner PIN is set in Settings |
| AUTH-03 | Owner shall be able to create employee accounts with name and PIN |
| AUTH-04 | Owner shall be able to grant customers portal access with a PIN |
| AUTH-05 | Sessions shall expire after 7 days of inactivity |
| AUTH-06 | Session cookies shall be HTTP-only and secure in production |
| AUTH-07 | Failed login attempts shall return a generic error (no account enumeration) |
| AUTH-08 | Owner shall be able to change the owner PIN from Settings |
| AUTH-09 | Owner shall be able to change any employee's PIN |
| AUTH-10 | Owner shall be able to revoke customer portal access |

### 2.2 Flock Management (FLOCK)

| ID | Requirement |
|---|---|
| FLOCK-01 | System shall support creating named flock cohorts with: name, breed, source, acquisition date, initial count, purchase cost per chick, initial weight |
| FLOCK-02 | Every flock shall have a lifecycle stage. Stages are farmer-configurable (see STAGE requirements) with default stages: Brooder → Grower → Layer → Disposal → Sold |
| FLOCK-03 | Owner/employee shall be able to manually advance a flock to any later stage |
| FLOCK-04 | System shall track current bird count, updated on mortality and sales events |
| FLOCK-05 | Flocks shall be assignable to a physical cage/pen |
| FLOCK-06 | Owner shall be able to delete a flock (cascades to all linked records) |
| FLOCK-07 | System shall display mortality rate per flock as a percentage |
| FLOCK-08 | Flocks shall support free-text notes |

### 2.3 Mortality Recording (MORT)

| ID | Requirement |
|---|---|
| MORT-01 | Employee/owner shall be able to log mortality events: flock, date, count, cause |
| MORT-02 | Each mortality event shall automatically decrement the flock's current count |
| MORT-03 | System shall alert when a flock's daily mortality exceeds 5% of current count |
| MORT-04 | All mortality records shall be retained for audit purposes |

### 2.4 Feed Management (FEED)

| ID | Requirement |
|---|---|
| FEED-01 | System shall maintain an inventory of four feed types: Starter, Grower, Layer, Finisher |
| FEED-02 | Owner/manager shall be able to add feed stock purchases (feed type, source, quantity kg, cost per kg) |
| FEED-03 | Purchasing feed shall increase the corresponding feed inventory stock level |
| FEED-04 | Employee shall be able to log daily feed dispensed to a specific flock |
| FEED-05 | Dispensing feed shall decrease the corresponding feed inventory stock level |
| FEED-06 | System shall display available stock per feed type when employee logs dispensing |
| FEED-07 | System shall prevent logging a dispense quantity that exceeds available stock (warning + block) |
| FEED-08 | System shall display the FCR-recommended daily quantity based on flock size and stage |
| FEED-09 | Owner shall be able to set reorder level thresholds per feed type |
| FEED-10 | System shall generate a low-feed alert when stock falls below the reorder level |
| FEED-11 | Feed type shall be recorded as source: purchased or produced-on-farm |

### 2.5 Vaccination Management (VACC)

| ID | Requirement |
|---|---|
| VACC-01 | Owner/employee shall be able to schedule vaccinations per flock (vaccine name, date, dosage, cost) |
| VACC-02 | Owner/employee shall be able to mark a vaccination as completed on a given date |
| VACC-03 | System shall generate an alert for vaccinations that pass their scheduled date without completion |
| VACC-04 | Vaccination cost shall be tracked per flock for break-even analysis |

### 2.6 Egg Collection (EGGS)

| ID | Requirement |
|---|---|
| EGGS-01 | Employee/owner shall log daily egg collection per layer flock: total count and broken eggs |
| EGGS-02 | System shall auto-calculate sellable eggs as (total − broken) |
| EGGS-03 | All egg collections shall be retained for production trend analysis |
| EGGS-04 | Inventory page shall display total sellable stock = sum(sellable) − sum(quantity sold as eggs) |

### 2.7 Sales Management (SALES)

| ID | Requirement |
|---|---|
| SALES-01 | Owner/employee shall be able to record a sale: customer, product (eggs or birds), quantity, price per unit, flock reference, date |
| SALES-02 | Selling birds from a flock shall automatically decrement that flock's current count |
| SALES-03 | System shall validate that the sale quantity does not exceed available stock (eggs: sellable − already sold; birds: flock current count) |
| SALES-04 | System shall block and warn when attempting to oversell stock |
| SALES-05 | Employee shall be able to request a sale deletion with a mandatory reason |
| SALES-06 | Owner shall be able to approve or reject a pending deletion request |
| SALES-07 | Owner shall be able to delete a sale directly without a request workflow |
| SALES-08 | Deleting a bird sale shall restore the sold quantity back to the flock's current count |
| SALES-09 | Deletion request state shall be visible to owner (amber highlighting, pending banner) |
| SALES-10 | Sales table shall support filtering by customer, product type, and date range |

### 2.8 Bird Stage Sales / Valuation (BSALE)

| ID | Requirement |
|---|---|
| BSALE-01 | Owner shall be able to record a bird sale at a given lifecycle stage from the Flock Valuation tab |
| BSALE-02 | Stage sale shall record: quantity, price per bird, break-even price, total amount, optional customer, date |
| BSALE-03 | Stage sale shall automatically decrement the flock's current count |
| BSALE-04 | Deleting a stage sale shall restore the quantity to the flock |
| BSALE-05 | Stage sale revenue shall be counted separately in Finance P&L and Dashboard KPIs |

### 2.9 Financial Management (FIN)

| ID | Requirement |
|---|---|
| FIN-01 | Finance page shall display a P&L statement covering: Sales revenue, Bird stage revenue, Feed costs, Vaccination costs, General expenses |
| FIN-02 | Revenue total shall be the sum of egg/bird sales AND bird stage sales (no double-counting) |
| FIN-03 | Expense total shall include: manually-entered expenses + feed record costs + vaccination costs |
| FIN-04 | System shall support period filters: This month, Last month, This year |
| FIN-05 | System shall display a 6-month revenue vs. expenses bar chart |
| FIN-06 | System shall support budget limits per expense category (feed, vaccines, medications, labour, utilities, chicks, miscellaneous) |
| FIN-07 | Budget tracker shall show percentage spent for the current month |
| FIN-08 | System shall display an expense breakdown pie chart |
| FIN-09 | Owner shall be able to add, edit, and delete expense records |

### 2.10 Flock Valuation (VAL)

| ID | Requirement |
|---|---|
| VAL-01 | Valuation tab shall show total cost to date (purchase + feed + vaccination + other expenses) |
| VAL-02 | System shall calculate cost per bird (total cost ÷ current count) |
| VAL-03 | System shall calculate break-even price per bird at each stage |
| VAL-04 | System shall display margin at each stage (configured price − break-even) |
| VAL-05 | System shall display total surviving birds, total deaths, and mortality rate |

### 2.11 Inventory Management (INV)

| ID | Requirement |
|---|---|
| INV-01 | Inventory page shall display current stock level (kg) per feed type |
| INV-02 | Stock status shall be: OK (above reorder), LOW (at reorder), CRITICAL (below reorder × 0.5) |
| INV-03 | Owner/employee shall be able to add stock (via feed purchase form) |
| INV-04 | Egg stock summary shall show: total collected, total sold, available |
| INV-05 | Owner shall be able to export all farm data as a JSON file |

### 2.12 Configurable Flock Stages (STAGE)

| ID | Requirement |
|---|---|
| STAGE-01 | Owner shall be able to define, rename, reorder, and delete flock lifecycle stages |
| STAGE-02 | Each stage shall have: id (slug), display name, display order, role (growth / sold / disposed), and price per bird |
| STAGE-03 | Stages with role `null` are growth stages; a stage with role `sold` terminates the flock as sold; a stage with role `disposed` terminates it as disposed |
| STAGE-04 | Price per bird configured on a stage shall be used as the default valuation price in the Flock Valuation tab |
| STAGE-05 | System shall ship with default stages: Brooder (0), Grower (1), Layer (2), Disposal (disposed, 3), Sold (sold, 4) |
| STAGE-06 | Stage configuration shall be managed from the Settings page under "Flock Stages" |
| STAGE-07 | Stages shall be stored in the `flock_stages` table; the `flocks.stage` and `bird_stage_sales.stage` columns store stage id as text |

### 2.13 Customer Management (CUST)

| ID | Requirement |
|---|---|
| CUST-01 | Owner shall be able to create customer profiles: name, phone, email, address, type (retail/restaurant/bakery/wholesale) |
| CUST-02 | System shall display per-customer order history and total revenue |
| CUST-03 | Customer search shall support lookup by name, phone, and email |
| CUST-04 | Owner shall be able to update or delete customer records |

### 2.14 Order Management (ORD)

| ID | Requirement |
|---|---|
| ORD-01 | Customer portal users shall be able to place orders for eggs, trays, or chicks |
| ORD-02 | Orders shall follow a status lifecycle: Pending → Confirmed → Delivered → Paid (or Cancelled) |
| ORD-03 | Owner/employee shall be able to confirm, dispatch, and mark orders as paid |
| ORD-04 | System shall send an SMS notification to the customer on each status change |
| ORD-05 | Owner shall be able to cancel an order at any status |
| ORD-06 | Dashboard shall display count of pending, confirmed, and unpaid orders |

### 2.15 Employee Management (EMP)

| ID | Requirement |
|---|---|
| EMP-01 | Owner shall be able to add employees with name and PIN |
| EMP-02 | Owner shall be able to update employee name and PIN |
| EMP-03 | Owner shall be able to remove employee access |
| EMP-04 | Owner shall be able to configure monthly salary and pay day for each employee |
| EMP-05 | Salary expense entries shall be auto-generated on the configured pay day |

### 2.16 Dashboard (DASH)

| ID | Requirement |
|---|---|
| DASH-01 | Dashboard shall display: active bird count (excluding sold flocks), period revenue, period costs, mortality rate |
| DASH-02 | Dashboard shall show a 7-day daily egg production chart |
| DASH-03 | Dashboard shall show a 7-day daily revenue bar chart |
| DASH-04 | Period filter shall support: Last 7 days, Last 30 days, This month, This year |
| DASH-05 | Dashboard shall show unread alert count with navigation |
| DASH-06 | Dashboard shall show the 4 most recently active flocks |

### 2.17 Analytics (ANA)

| ID | Requirement |
|---|---|
| ANA-01 | Analytics page shall display egg production trends over 7/30/90 day windows |
| ANA-02 | System shall provide a 7-day egg demand forecast using linear regression |
| ANA-03 | System shall show per-customer demand over time |
| ANA-04 | System shall show price trend over the selected period |

### 2.18 Alerts (ALERT)

| ID | Requirement |
|---|---|
| ALERT-01 | System shall generate alerts for: vaccination overdue, high mortality (>5%), low feed stock, budget overspend, cage capacity exceeded |
| ALERT-02 | Alerts shall be dismissable (mark as read) individually or all at once |
| ALERT-03 | Unread alert count shall be visible in the navigation sidebar |
| ALERT-04 | Alerts shall include a navigation link to the relevant page/section |

### 2.19 Multi-Enterprise & Configuration (ENT)

See the [Multi-Enterprise Roadmap](multi-enterprise.md) for the full phased plan.

| ID | Requirement |
|---|---|
| ENT-01 | Each farm shall have an enterprise type: `poultry`, `pigs`, `fish`, `crops`, or `mixed`, set in Settings and stored in `settings.enterprise_type` (default `poultry`) |
| ENT-02 | Enterprise type shall drive vocabulary and which modules are shown (delivered progressively per the roadmap) |
| ENT-03 | Owner shall be able to define, rename, reorder, and delete **location types** (cage / pen / pond / tank / field …) |
| ENT-04 | Location types shall be stored in the `location_types` table; `cages.type` stores a location-type id as text |
| ENT-05 | Defaults shall preserve existing poultry behaviour so current farms are unaffected after upgrade |
| ENT-06 | Hardcoded poultry enums shall be migrated to configurable lookup tables over the roadmap phases (stages ✓, location types ✓; input/product/cost-category types planned) |

---

## 3. Non-Functional Requirements

### 3.1 Performance

| ID | Requirement |
|---|---|
| PERF-01 | Initial page load shall complete within 3 seconds on a standard broadband connection |
| PERF-02 | API responses shall return within 500ms under normal load |
| PERF-03 | Store initialization (loading all farm data) shall complete within 2 seconds |
| PERF-04 | UI shall remain responsive during API sync (optimistic updates) |

### 3.2 Security

| ID | Requirement |
|---|---|
| SEC-01 | All PINs shall be stored as SHA-256 hashes; plaintext PINs shall never be persisted |
| SEC-02 | Session cookies shall be HTTP-only to prevent JavaScript access |
| SEC-03 | All API routes (except login/session-check) shall require a valid active session |
| SEC-04 | Employee-level API calls shall not expose owner-restricted data |
| SEC-05 | Session shall be server-side stored (database-backed, not JWT) |
| SEC-06 | `SESSION_SECRET` shall be at minimum 32 characters |
| SEC-07 | Database credentials shall not appear in application code; use environment variables |

### 3.3 Reliability & Data Integrity

| ID | Requirement |
|---|---|
| REL-01 | UI shall use optimistic updates; API errors shall surface via toast notifications |
| REL-02 | Any operation that modifies related records (e.g., sale reduces flock count) shall be atomic at the database level |
| REL-03 | Feed inventory decrements (dispense, purchase) shall use SQL `GREATEST(0, current − delta)` to prevent negative stock |
| REL-04 | Flock current count shall never go below zero |
| REL-05 | On database connection failure, the application shall fail with a clear error, not silently corrupt data |
| REL-06 | All cascade deletes shall be configured at the database FK constraint level |

### 3.4 Usability

| ID | Requirement |
|---|---|
| USE-01 | Employee portal shall present only the 3 core entry forms (eggs, feed, mortality) without owner-level complexity |
| USE-02 | All monetary values shall display in Kenyan Shillings (Ksh) |
| USE-03 | All date inputs shall default to today and prevent future dates for operational logs |
| USE-04 | Form validation errors shall be surfaced inline; submit blocked until resolved |
| USE-05 | Application shall be fully usable on mobile devices (responsive layout) |

### 3.5 Deployability

| ID | Requirement |
|---|---|
| DEP-01 | The entire stack (database, migrations, seed, application) shall start with a single `docker compose up --build -d` command |
| DEP-02 | All environment configuration shall be through a `.env` file |
| DEP-03 | Database migrations shall run automatically on container start before the app server |
| DEP-04 | Application shall expose a `/api/health` endpoint for container health checks |

---

## 4. Data Requirements

### 4.1 Retention
- All sales records shall be retained indefinitely (audit trail)
- Deletion-requested sales shall retain flags, reason, requestor, and timestamp even after approval
- Mortality and feed records shall be retained indefinitely for FCR and trend analysis

### 4.2 Consistency
- `Flock.currentCount` shall always equal `initialCount − sum(mortality.count) − sum(birdSales.quantity) − sum(birdStageSales.quantity)`
- `FeedInventory.currentStockKg` shall reflect all purchases (added) and all dispense events (subtracted)
- `EggCollection.sellable` shall always equal `count − broken`

### 4.3 Currencies and Units
- All monetary values: Kenyan Shillings (Ksh), numeric precision 2 decimal places
- Feed quantities: kilograms (kg)
- Bird counts: integers
- Egg counts: integers
