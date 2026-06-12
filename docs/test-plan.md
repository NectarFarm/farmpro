# Test Plan — FarmPro Poultry Farm Management System

**Version**: 1.0  
**Date**: 2026-06-12  
**Status**: Approved

---

## 1. Overview

### 1.1 Purpose
This document defines the complete testing strategy for FarmPro before production deployment. It covers unit, integration, API, end-to-end, security, and performance tests for both the frontend and backend.

### 1.2 Scope
All features described in the Requirements Document (v1.0) are in scope. Third-party services (SMS gateway) are excluded from automated tests and covered by manual smoke tests.

### 1.3 Test Environment

| Environment | Purpose | Database |
|---|---|---|
| **Local (dev)** | Developer testing during feature work | Local PostgreSQL / Docker |
| **CI (automated)** | Runs on every pull request via GitHub Actions | Docker Compose test stack |
| **Staging** | Pre-deployment full system test | Isolated PostgreSQL instance with seed data |

### 1.4 Test Tools

| Layer | Tool |
|---|---|
| Unit tests | **Vitest** (fast, ESM-native) |
| API / integration tests | **Supertest** + Vitest |
| End-to-end tests | **Playwright** |
| Database fixtures | Custom seed script (`lib/seedData.ts`) |
| Test DB | Docker Compose `test` profile with fresh PostgreSQL |

### 1.5 Pass Criteria
All tests in CI must pass before a deployment is permitted. Test coverage targets:
- Utility functions: 100%
- Store actions with side effects: 100% (mocked API)
- API routes: 100% route coverage (happy path + key error paths)
- E2E: all critical user journeys

---

## 2. Unit Tests

### 2.1 Utility Functions (`lib/utils.ts`)

| Test ID | Function | Input | Expected Output |
|---|---|---|---|
| UT-001 | `formatCurrency` | `1500` | `"Ksh 1,500.00"` |
| UT-002 | `formatCurrency` | `0` | `"Ksh 0.00"` |
| UT-003 | `formatCurrency` | `1234567.89` | `"Ksh 1,234,567.89"` |
| UT-004 | `formatDate` | `"2025-06-12"` | `"Jun 12, 2025"` |
| UT-005 | `formatDateShort` | `"2025-06-12"` | `"Jun 12"` |
| UT-006 | `isOverdue` | date 3 days ago | `true` |
| UT-007 | `isOverdue` | today | `false` |
| UT-008 | `isOverdue` | date tomorrow | `false` |
| UT-009 | `calcMortalityRate` | `(100, 5)` | `5.00` |
| UT-010 | `calcMortalityRate` | `(0, 0)` | `0` (no division by zero) |
| UT-011 | `generateId` | — | Matches regex `/^[a-z0-9]+-[a-z0-9]+$/` |
| UT-012 | `generateId` | Two calls | Returns different IDs |
| UT-013 | `stripMeta` | `{ id: "x", createdAt: "...", name: "Y" }` | `{ id: "x", name: "Y" }` |
| UT-014 | `linearRegression` | 7 ascending values | Returns slope > 0 |
| UT-015 | `linearRegression` | 7 equal values | Returns slope = 0 |

### 2.2 PIN Hashing (`lib/auth.ts`)

| Test ID | Scenario | Expected |
|---|---|---|
| UT-016 | `hashPin("1234")` called twice | Returns same value (deterministic) |
| UT-017 | `hashPin("1234") !== hashPin("1235")` | Different hashes for different PINs |
| UT-018 | Hash is 64 hex characters | Valid SHA-256 output |
| UT-019 | `hashPin("")` | Does not throw; returns non-empty string |

### 2.3 Store Action Side Effects (`lib/store.ts`) — Mocked API

These tests mount the Zustand store with `jest.fn()` / `vi.fn()` API mocks.

| Test ID | Action | Precondition | Expected State After |
|---|---|---|---|
| UT-020 | `addMortalityRecord({count: 10, flockId: "f1"})` | flock f1.currentCount = 100 | f1.currentCount = 90 |
| UT-021 | `addMortalityRecord({count: 200, flockId: "f1"})` | flock f1.currentCount = 50 | f1.currentCount = 0 (floor) |
| UT-022 | `addSale({product: "birds", flockId: "f1", quantity: 20})` | flock f1.currentCount = 100 | f1.currentCount = 80 |
| UT-023 | `addSale({product: "eggs", quantity: 500})` | — | flock counts unchanged |
| UT-024 | `deleteSale(id)` for bird sale qty=20 | flock.currentCount = 80 | flock.currentCount = 100 |
| UT-025 | `deleteSale(id)` for egg sale | flock.currentCount = 80 | flock.currentCount = 80 (unchanged) |
| UT-026 | `approveSaleDeletion(id)` for bird sale qty=15 | flock.currentCount = 50 | flock.currentCount = 65 |
| UT-027 | `addBirdStageSale({quantity: 30, flockId: "f1"})` | flock f1.currentCount = 100 | f1.currentCount = 70 |
| UT-028 | `deleteBirdStageSale(id)` qty=30 | flock.currentCount = 70 | flock.currentCount = 100 |
| UT-029 | `addFeedDispenseRecord({feedType: "layer", quantityKg: 50})` | feedInventory layer = 400kg | feedInventory layer = 350kg |
| UT-030 | `addFeedDispenseRecord({feedType: "layer", quantityKg: 500})` | feedInventory layer = 100kg | feedInventory layer = 0 (floor) |
| UT-031 | `requestSaleDeletion(id, reason, name)` | sale.deletionRequested = false | sale.deletionRequested = true, reason set |
| UT-032 | `rejectSaleDeletion(id)` | sale.deletionRequested = true | sale.deletionRequested = false, reason cleared |
| UT-033 | `addFlock(f)` | flocks = [] | flocks = [f] |
| UT-034 | `deleteFlock(id)` | flocks = [f1, f2] | flocks = [f2] |
| UT-035 | `updateFlock(id, {stage: "layer"})` | flock.stage = "grower" | flock.stage = "layer" |
| UT-036 | `exportData()` | store has all data | JSON includes flocks, sales, birdStageSales, feedDispenseRecords |

---

## 3. API Integration Tests

### 3.1 Test Setup

Each test suite:
1. Starts a fresh PostgreSQL instance (Docker)
2. Runs `db:migrate` and `db:seed`
3. Creates a session cookie via `POST /api/auth/login { pin: "1234", type: "owner" }`
4. Tears down the database after the suite

### 3.2 Authentication Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-001 | POST | `/api/auth/login` | Valid owner PIN `"1234"` | 200, session cookie set |
| API-002 | POST | `/api/auth/login` | Wrong PIN | 401 `{ error: "..." }` |
| API-003 | POST | `/api/auth/login` | Valid employee PIN with entityId | 200, session cookie set |
| API-004 | POST | `/api/auth/login` | Employee PIN wrong | 401 |
| API-005 | POST | `/api/auth/login` | Missing `type` field | 400 |
| API-006 | GET | `/api/auth/session` | With valid cookie | 200, session object |
| API-007 | GET | `/api/auth/session` | No cookie | 200, `null` |
| API-008 | POST | `/api/auth/logout` | With valid cookie | 200, cookie cleared |
| API-009 | GET | `/api/flocks` | No session cookie | 401 |

### 3.3 Flock Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-010 | GET | `/api/flocks` | Owner session | 200, array of flocks |
| API-011 | POST | `/api/flocks` | Valid flock payload | 201, flock created |
| API-012 | POST | `/api/flocks` | Missing required fields | 400 |
| API-013 | PUT | `/api/flocks/:id` | Update stage | 200, updated flock |
| API-014 | DELETE | `/api/flocks/:id` | Valid flock ID | 200, cascades delete mortality/feed/eggs |
| API-015 | DELETE | `/api/flocks/:id` | Non-existent ID | 404 |

### 3.4 Mortality Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-016 | POST | `/api/mortality` | count=10, flockId exists | 201, flock.currentCount decremented by 10 |
| API-017 | POST | `/api/mortality` | count=9999 (exceeds birds) | 201, flock.currentCount = 0 (GREATEST floor) |
| API-018 | POST | `/api/mortality` | flockId does not exist | 201 (orphaned record; no flock update) |
| API-019 | GET | `/api/mortality` | Owner session | 200, all records |

### 3.5 Feed Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-020 | POST | `/api/feed-records` | feedType=layer, quantityKg=50 | 201, feedInventory.layer decremented |
| API-021 | POST | `/api/feed-records` | quantityKg=9999 (exceeds stock) | 201, feedInventory.layer = 0 (GREATEST) |
| API-022 | POST | `/api/feed-dispense` | feedType=layer, quantityKg=20 | 201, feedInventory.layer decremented by 20 |
| API-023 | POST | `/api/feed-dispense` | quantityKg exceeds stock | 201, feedInventory.layer = 0 (floor) |
| API-024 | GET | `/api/feed-inventory` | Owner session | 200, 4 feed types with currentStockKg |
| API-025 | PUT | `/api/feed-inventory` | feedType=layer, currentStockKg=500 | 200, inventory updated to 500 |
| API-026 | PUT | `/api/feed-inventory` | missing feedType | 400 |

### 3.6 Sales Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-027 | POST | `/api/sales` | product=eggs, quantity=100 | 201, sale created, flock count unchanged |
| API-028 | POST | `/api/sales` | product=birds, flockId, quantity=50 | 201, flock.currentCount decremented by 50 |
| API-029 | POST | `/api/sales` | product=birds, no flockId | 201, no flock update |
| API-030 | DELETE | `/api/sales/:id` | Bird sale qty=50 | 200, flock.currentCount restored +50 |
| API-031 | DELETE | `/api/sales/:id` | Egg sale | 200, flock count unchanged |
| API-032 | DELETE | `/api/sales/:id` | Non-existent ID | 200 (idempotent delete) |
| API-033 | PUT | `/api/sales/:id` | `{ deletionRequested: true }` | 200, sale updated |

### 3.7 Bird Stage Sales Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-034 | POST | `/api/bird-stage-sales` | quantity=30, flockId | 201, flock.currentCount decremented by 30 |
| API-035 | DELETE | `/api/bird-stage-sales/:id` | Valid sale | 200, flock.currentCount restored +30 |
| API-036 | GET | `/api/bird-stage-sales` | Owner session | 200, array |

### 3.8 Egg Collection Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-037 | POST | `/api/egg-collections` | count=100, broken=5 | 201, sellable=95 stored |
| API-038 | GET | `/api/egg-collections` | Owner session | 200, array |

### 3.9 Finance Routes

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-039 | POST | `/api/expenses` | Valid expense | 201, expense created |
| API-040 | DELETE | `/api/expenses/:id` | Valid ID | 200, deleted |
| API-041 | POST | `/api/budgets` | category=feed, period=monthly | 201 |
| API-042 | PUT | `/api/budgets/:id` | Update amount | 200 |

### 3.10 Settings Route

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-043 | GET | `/api/settings` | Owner session | 200, pricing config |
| API-044 | PUT | `/api/settings` | `{ pricePerEgg: 20 }` | 200, updated |
| API-045 | GET | `/api/settings` | No session | 401 |

### 3.11 Alerts Route

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-046 | POST | `/api/alerts` | Valid alert | 201 |
| API-047 | PUT | `/api/alerts/:id` | Mark read | 200, read=true |
| API-048 | DELETE | `/api/alerts` | Clear all | 200 |

### 3.12 Health Check

| Test ID | Method | Route | Scenario | Expected |
|---|---|---|---|---|
| API-049 | GET | `/api/health` | No session | 200, `{ status: "ok" }` |

---

## 4. End-to-End Tests (Playwright)

### 4.1 Test Setup
- Start Docker Compose stack (`docker compose --profile test up`)
- Fresh database with seed data
- All tests run against `http://localhost:13000`
- Separate test runs for each user role (owner/employee/customer)

### 4.2 Owner User Journey

| Test ID | Journey | Steps | Expected Result |
|---|---|---|---|
| E2E-001 | **Owner login** | Open app → Enter PIN 1234 → Click owner login | Dashboard visible, sidebar with 9 items |
| E2E-002 | **Wrong PIN** | Enter PIN 9999 → Click owner login | Error toast, stay on login |
| E2E-003 | **Dashboard KPIs load** | Login → View dashboard | Active bird count, revenue, costs, mortality shown |
| E2E-004 | **Create flock** | Flocks → Add Flock → Fill form → Submit | New flock card appears |
| E2E-005 | **Log mortality** | Flocks → Select flock → Mortality tab → Log 5 deaths | Flock count decreases by 5 |
| E2E-006 | **Advance flock stage** | Flocks → Select flock → Advance → Confirm | Stage badge updates |
| E2E-007 | **Log egg collection** | Flocks → Layer flock → Eggs tab → Log 100 eggs, 3 broken | Record shows 97 sellable |
| E2E-008 | **Add feed record** | Flocks → Select flock → Feed tab → Add 50kg layer feed | Feed record appears in list |
| E2E-009 | **Schedule vaccination** | Flocks → Vaccinations tab → Add vaccination | Vaccination in list, scheduled date shown |
| E2E-010 | **Mark vaccination complete** | Flocks → Vaccination with past date → Mark Complete | Completed date set |
| E2E-011 | **Record egg sale** | Sales → Add Sale → Eggs → 500 units → Submit | Sale appears in table |
| E2E-012 | **Record bird sale** | Sales → Add Sale → Birds → Select flock → 50 birds | Sale recorded, flock count decremented by 50 |
| E2E-013 | **Over-sell warning** | Sales → Add Sale → quantity > available | Submit disabled, warning shown in red |
| E2E-014 | **Delete sale directly** | Sales → Select sale → Delete → Enter reason | Sale removed from table |
| E2E-015 | **Approve employee deletion** | Owner sees pending deletion banner → Approve | Sale removed |
| E2E-016 | **Reject deletion** | Owner sees pending deletion → Reject | Sale un-flagged, no amber highlight |
| E2E-017 | **Finance P&L** | Finance → This month | Revenue, expenses, net P&L displayed |
| E2E-018 | **Add expense** | Finance → Add Expense → Feed category, Ksh 5000 | Expense in list, totals updated |
| E2E-019 | **Budget tracker** | Finance → Set budget for feed → Ksh 10000 | Budget bar shows % spent |
| E2E-020 | **Inventory stock level** | Inventory → View feed types | All 4 feed types shown with stock status |
| E2E-021 | **Add stock** | Inventory → Add stock → Layer feed 100kg | Current stock increases |
| E2E-022 | **Export JSON** | Inventory → Export | File download triggered |
| E2E-023 | **Add customer** | Customers → Add Customer → Fill form | Customer card appears |
| E2E-024 | **View customer history** | Customers → Select customer | Order history and total revenue shown |
| E2E-025 | **Analytics charts render** | Analytics → Select 30d | All 4 charts render without error |
| E2E-026 | **Bird stage valuation** | Flocks → Layer flock → Valuation → Record sale | Sale appears, flock count decremented |
| E2E-027 | **Dashboard period filter** | Dashboard → This Year filter | KPIs recalculate for current year |
| E2E-028 | **Logout** | Settings → Logout (or header) | Redirected to login page |

### 4.3 Employee User Journey

| Test ID | Journey | Steps | Expected Result |
|---|---|---|---|
| E2E-029 | **Employee login** | Select employee from dropdown → Enter PIN | Employee portal visible (no sidebar, 3 forms) |
| E2E-030 | **Owner pages not accessible** | Employee tries to navigate to /finance | Redirected or not shown |
| E2E-031 | **Log egg collection** | Employee → Eggs form → Select layer flock → 200 eggs, 4 broken | Today's activity: 200 eggs, 196 sellable |
| E2E-032 | **Log feed dispensed** | Employee → Feed form → Select flock → Layer feed → 80kg | Inventory shows −80kg; today's activity updated |
| E2E-033 | **Feed stock warning** | Employee → Feed form → Enter qty > available stock | Red warning, submit disabled |
| E2E-034 | **Log mortality** | Employee → Mortality form → 3 deaths, cause "disease" | Today's mortality: 3 |
| E2E-035 | **Request sale deletion** | Employee sees sale → Request deletion → Enter reason | Sale amber-highlighted, reason saved |
| E2E-036 | **FCR recommendation shown** | Employee → Feed form → Select flock → Select date | Recommendation text shows kg/day |

### 4.4 Customer Portal Journey

| Test ID | Journey | Steps | Expected Result |
|---|---|---|---|
| E2E-037 | **Customer portal login** | Select customer → Enter PIN | Customer portal visible |
| E2E-038 | **Place order** | Portal → Order form → Eggs → 30 trays → Location → Submit | Order in history as Pending |
| E2E-039 | **View order history** | Portal → Orders section | Past orders listed with status |
| E2E-040 | **Egg availability visible** | Portal → View egg availability | Available count, price per egg shown |

### 4.5 Data Integrity E2E Tests

| Test ID | Scenario | Steps | Expected Result |
|---|---|---|---|
| E2E-041 | **Reload preserves data** | Record egg collection → Refresh browser | Egg record still visible |
| E2E-042 | **Flock count correct after sale + delete** | Sell 50 birds → Delete that sale | Flock count returns to original |
| E2E-043 | **Inventory correct after dispense + reload** | Dispense 30kg layer → Refresh browser | Inventory shows original − 30kg |
| E2E-044 | **Multiple mortality events accumulate** | Log 5 deaths → Log 3 more → Refresh | Flock count = initial − 8 |

---

## 5. Security Tests

| Test ID | Scenario | Method | Expected |
|---|---|---|---|
| SEC-001 | Access `/api/flocks` with no session cookie | `curl /api/flocks` | 401 |
| SEC-002 | Access `/api/settings` with employee session | Login as employee, call GET /api/settings | 401 (owner only) |
| SEC-003 | Session cookie is HTTPOnly | Browser DevTools → Application → Cookies | `HttpOnly` flag set |
| SEC-004 | Session cookie not accessible via JS | `document.cookie` in browser console | Does not include `farm_session` |
| SEC-005 | Replay expired session | Use a session token after 7 days | 401 |
| SEC-006 | SQL injection in login PIN | PIN = `"'; DROP TABLE employees; --"` | 401, no SQL error, table intact |
| SEC-007 | XSS in flock name | Create flock with name `<script>alert(1)</script>` | Text displayed escaped, no script runs |
| SEC-008 | XSS in expense description | Add expense with `<img src=x onerror=alert(1)>` | Escaped in UI |
| SEC-009 | CSRF — cross-origin POST to `/api/sales` | Simulate request from different origin | Request fails (SameSite=Lax cookie) |
| SEC-010 | Owner PIN stored as hash | Inspect `settings` table in DB | Only SHA-256 hash stored, never plaintext |
| SEC-011 | Employee PIN stored as hash | Inspect `employees` table | Only hash, no plaintext |
| SEC-012 | Default PIN documented and warning shown | First login with 1234 | Settings page prompts to change PIN |

---

## 6. Performance Tests

| Test ID | Scenario | Tool | Acceptance Criteria |
|---|---|---|---|
| PERF-001 | App initial load time | Playwright / Lighthouse | LCP < 3 seconds on broadband |
| PERF-002 | `initialize()` API load time | Browser DevTools / network tab | All 19 API calls complete within 2s |
| PERF-003 | Dashboard render with 12 months data | Manual timing | Dashboard renders within 500ms after data loaded |
| PERF-004 | Sales table with 500 records | Playwright | Table renders without pagination in < 1s |
| PERF-005 | Finance page P&L calculation | Browser profiler | Re-compute on period change < 100ms (React useMemo) |
| PERF-006 | Analytics linear regression (90d data) | Browser profiler | Chart renders within 300ms |
| PERF-007 | Concurrent API calls in initialize() | Network tab | All 19 calls fire in parallel (Promise.allSettled) |
| PERF-008 | Docker cold start to first response | `time docker compose up --build` | App health endpoint responds within 90s |

---

## 7. Pre-Deployment Checklist

### 7.1 Environment

- [ ] `DATABASE_URL` is set and points to production PostgreSQL
- [ ] `SESSION_SECRET` is at least 32 characters and unique to this deployment
- [ ] `NODE_ENV=production` in docker-compose or environment
- [ ] Default owner PIN `1234` has been changed in Settings
- [ ] SSL/TLS is terminating in front of the app (nginx/cloudflare/load balancer)

### 7.2 Database

- [ ] Run `docker compose up --build -d` on a clean database (verify no migration errors)
- [ ] Verify seed data is correct (flocks, pricing, feed inventory levels)
- [ ] Confirm `postgres_data` volume is backed up before first production run
- [ ] Test backup restore procedure: dump → drop → restore → app still loads

### 7.3 Automated Test Suite

- [ ] All unit tests pass: `pnpm test:unit`
- [ ] All API integration tests pass: `pnpm test:api`
- [ ] All E2E tests pass against staging: `pnpm test:e2e`
- [ ] No TypeScript errors: `pnpm tsc --noEmit` exits 0
- [ ] No ESLint errors: `pnpm lint` exits 0

### 7.4 Manual Smoke Tests (Staging)

Run these manually in a browser on the staging environment:

- [ ] Owner login with production PIN succeeds
- [ ] Dashboard loads with all KPI cards
- [ ] Create a flock → advance stage → delete flock
- [ ] Log egg collection → verify sellable count
- [ ] Log feed dispense → verify inventory decrements
- [ ] Record a bird sale → verify flock count decrements
- [ ] Delete that sale → verify flock count restores
- [ ] Finance P&L shows revenue from both sales and bird stage sales
- [ ] Employee login → log eggs, feed, mortality via Employee portal
- [ ] Customer portal login → place order → verify it appears in Order Management
- [ ] Owner approves order in Order Management (SMS sent to test number)
- [ ] Export JSON from Inventory → verify file contains all collections
- [ ] Logout → confirm redirected to login

### 7.5 Rollback Plan

If a deployment fails:
1. Stop the application: `docker compose down farmpro`
2. Restore the previous image: `docker compose up -d --no-build` (if previous image still cached)
3. If database was migrated: restore from pre-deployment backup
4. Verify application is responding: `curl http://localhost:13000/api/health`

---

## 8. Test Data

### 8.1 Seed Data Coverage

The `db:seed` script (`lib/seedData.ts`) creates:

| Entity | Count | Notes |
|---|---|---|
| Flocks | 4 | One at each stage: brooder, grower, layer, disposal |
| Mortality records | 12 | Spread across past 30 days |
| Feed records | 16 | All 4 feed types represented |
| Feed dispense records | 8 | Linked to multiple flocks |
| Vaccination records | 6 | Mix of completed and upcoming |
| Egg collections | 30 | Daily for past 30 days, including broken eggs |
| Customers | 4 | One of each type: retail, restaurant, bakery, wholesale |
| Sales | 20 | Mix of egg and bird sales, various customers |
| Bird stage sales | 4 | One per stage |
| Expenses | 12 | All expense categories represented |
| Budgets | 4 | Monthly budgets per category |
| Feed inventory | 4 | All 4 feed types with realistic stock levels |
| Employees | 2 | With known test PINs |
| Order requests | 5 | Mix of statuses |

### 8.2 Test Accounts (Staging Only)

| Role | Identifier | PIN |
|---|---|---|
| Owner | (no selection needed) | `1234` |
| Employee 1 | John Kamau | `2222` |
| Employee 2 | Mary Wanjiku | `3333` |
| Customer | Nairobi Fresh Market | `4444` |

**These PINs must be changed before production go-live.**
