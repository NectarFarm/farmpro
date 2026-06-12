# System Design Document — FarmPro Poultry Farm Management System

**Version**: 1.0  
**Date**: 2026-06-12  
**Status**: Approved

---

## 1. Architecture Overview

FarmPro is a monolithic web application built on the **Next.js App Router** framework. The frontend and backend live in the same codebase. The backend is implemented as Next.js API Route Handlers (thin HTTP adapters that delegate to the database via Drizzle ORM). The frontend is React with a Zustand store that handles all client state, communicating with the API via fetch.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Docker Host                              │
│                                                                  │
│  ┌─────────────┐     ┌──────────────────────────────────────┐   │
│  │  PostgreSQL  │◄───│              Next.js App              │   │
│  │  Port 5432   │    │  ┌──────────────┐  ┌──────────────┐  │   │
│  │  (internal)  │    │  │  API Routes  │  │  React UI    │  │   │
│  └─────────────┘     │  │  /app/api/   │  │  /components │  │   │
│                       │  └──────────────┘  └──────────────┘  │   │
│                       │        Port 13000 (exposed)            │   │
│                       └──────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 App Router | SSR-capable, API routes colocated, no separate server process |
| Database | PostgreSQL 16 | ACID transactions, relational integrity, JSON support |
| ORM | Drizzle ORM | Type-safe, zero runtime overhead, SQL-close abstractions |
| State | Zustand | Minimal boilerplate, no Provider wrappers, SSR-safe |
| Auth | PIN + HTTP-only session cookies | Simple UX for farm workers; avoids JWT complexity |
| CSS | Tailwind CSS v4 | Utility-first, no CSS file maintenance |
| Charts | Recharts | React-native charting, responsive, composable |
| Containerization | Docker + Compose | Single-command deployment, reproducible environment |

---

## 2. Technology Stack

### 2.1 Frontend
| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.x |
| UI Library | React | 18.x |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | v4 |
| Component Library | shadcn/ui (Radix primitives) | Latest |
| State Management | Zustand | 4.x |
| Charts | Recharts | 2.x |
| Notifications | Sonner (toast) | 1.x |
| Icons | Lucide React | Latest |

### 2.2 Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| API | Next.js Route Handlers (app/api/) |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 |
| Migrations | drizzle-kit |
| Session Store | PostgreSQL (sessions table) |
| PIN Hashing | Web Crypto API (SHA-256) |

### 2.3 Infrastructure
| Component | Technology |
|---|---|
| Containerization | Docker |
| Orchestration | Docker Compose |
| Database Container | postgres:16-alpine |
| Package Manager | pnpm |
| Build Process | Next.js build (standalone output) |

---

## 3. Application Layers

### 3.1 Presentation Layer (`components/`)

**App Shells** — Role-based navigation wrappers:
- `AppShell.tsx` — Owner dashboard with full sidebar navigation (9 pages)
- `EmployeeShell.tsx` — Employee data-entry portal (1 page)
- `CustomerPortalPage.tsx` — Customer order portal

**Page Components** (`components/pages/`):

| Component | Route (conceptual) | Role |
|---|---|---|
| `DashboardPage.tsx` | / | Owner |
| `FlocksPage.tsx` | /flocks | Owner |
| `SalesPage.tsx` | /sales | Owner |
| `FinancePage.tsx` | /finance | Owner |
| `InventoryPage.tsx` | /inventory | Owner |
| `CustomersPage.tsx` | /customers | Owner |
| `OrderManagementPage.tsx` | /orders | Owner |
| `AnalyticsPage.tsx` | /analytics | Owner |
| `SettingsPage.tsx` | /settings | Owner |
| `EmployeePage.tsx` | /employee | Employee |
| `CustomerPortalPage.tsx` | /portal | Customer |

**Routing Logic** (`app/page.tsx`):
```
Session Check
   ├── No session → LoginPage
   ├── type=customer → CustomerPortalPage
   ├── type=employee → EmployeeShell (→ EmployeePage)
   └── type=owner → AppShell (→ DashboardPage by default)
```

### 3.2 State Layer (`lib/store.ts`)

A single Zustand store (`useFarmStore`) acts as the client-side data cache. It follows an **optimistic update** pattern:

1. **User action** triggers a store method
2. **Store** immediately updates in-memory state (UI reflects instantly)
3. **Store** fires an async API call via `withApi()` helper
4. **On API error**: toast notification shown; state is NOT rolled back (acceptable for low-conflict single-user app)
5. **On page load**: `initialize()` fetches all data from API and populates store

### 3.3 API Layer (`app/api/`)

Thin Next.js Route Handlers. Each route:
1. Calls `requireSession()` or `requireOwner()` for auth
2. Parses the request body
3. Executes one or more Drizzle queries
4. Returns JSON

For multi-step operations (e.g., creating a sale AND decrementing flock count), both updates run in the same handler to ensure consistency.

### 3.4 Data Layer (`db/`)

| File | Purpose |
|---|---|
| `db/index.ts` | Drizzle client (pool connection to PostgreSQL) |
| `db/schema.ts` | Table definitions (all 21 tables) |
| `db/migrations/` | Auto-generated SQL migration files |

---

## 4. Database Design

### 4.1 Entity Relationship Overview

The schema has one central entity (`flocks`) that most operational records reference. The `settings` table is a singleton. `sessions` supports auth.

**Core relationships:**
- `flocks` ← `mortalityRecords` (1:N, cascade delete)
- `flocks` ← `feedRecords` (1:N, cascade delete)
- `flocks` ← `feedDispenseRecords` (1:N)
- `flocks` ← `vaccinationRecords` (1:N)
- `flocks` ← `eggCollections` (1:N)
- `flocks` ← `sales` (optional FK via flockId)
- `flocks` ← `birdStageSales` (1:N, cascade delete)
- `flocks` ← `expenses` (optional FK via flockId)
- `customers` ← `sales` (1:N)
- `customers` ← `orderRequests` (1:N)
- `customers` ← `customerPortalUsers` (1:1, cascade delete)
- `employees` ← `employeeSalaries` (1:1, cascade delete)
- `cages` ← `flocks` (optional FK via cageId)
- `feedInventory` — singleton-per-type (4 rows, unique feedType)

### 4.2 Table Reference

| Table | PK | Key Fields | Side Effects on Write |
|---|---|---|---|
| `settings` | `id='default'` | ownerPinHash, prices, stagePricing | — |
| `sessions` | `id` | userType, userId, expiresAt | — |
| `employees` | `id` | name, pinHash | — |
| `cages` | `id` | name, type, capacity | — |
| `flocks` | `id` | stage, currentCount, initialCount | Updated by mortality/sale writes |
| `mortalityRecords` | `id` | flockId, count | Decrements flock.currentCount |
| `feedRecords` | `id` | flockId, feedType, quantityKg, costPerKg | Tracked for cost; decrements feedInventory |
| `feedDispenseRecords` | `id` | flockId, feedType, quantityKg | Decrements feedInventory.currentStockKg |
| `vaccinationRecords` | `id` | flockId, scheduledDate, completedDate | — |
| `eggCollections` | `id` | flockId, count, broken, sellable | — |
| `customers` | `id` | name, phone, type | — |
| `customerPortalUsers` | `id` | customerId, pinHash | — |
| `sales` | `id` | product, quantity, flockId | Decrements flock.currentCount if product=birds |
| `birdStageSales` | `id` | flockId, quantity, pricePerBird | Decrements flock.currentCount |
| `expenses` | `id` | category, amount, date | — |
| `budgets` | `id` | category, period, amount, month | — |
| `feedInventory` | `id` | feedType (unique), currentStockKg | Decremented by feedDispenseRecords |
| `alerts` | `id` | type, read, route | — |
| `employeeSalaries` | `id` | employeeId, amount, payDayOfMonth | Auto-creates expense on pay day |
| `orderRequests` | `id` | status, product, customerId | SMS sent on status change |

### 4.3 flock.currentCount Invariant

The field `flocks.currentCount` is the authoritative live bird count. It is modified by:

| Event | Direction | Source |
|---|---|---|
| Mortality logged | − count | `POST /api/mortality` |
| Bird sale (SalesPage) | − quantity | `POST /api/sales` (when product='birds') |
| Bird stage sale | − quantity | `POST /api/bird-stage-sales` |
| Sale deleted (bird) | + quantity | `DELETE /api/sales/[id]` |
| Stage sale deleted | + quantity | `DELETE /api/bird-stage-sales/[id]` |

### 4.4 feedInventory.currentStockKg Invariant

| Event | Direction | Source |
|---|---|---|
| Feed purchase logged | − quantityKg | `POST /api/feed-records` (treated as usage) |
| Feed dispensed (employee) | − quantityKg | `POST /api/feed-dispense` |
| Manual stock add | + delta | `PUT /api/feed-inventory` |

---

## 5. Authentication Design

### 5.1 Session Flow

```
Client                         Server
  │                               │
  ├─── POST /api/auth/login ──────►│
  │    { pin, type, entityId }     │
  │                               │── hashPin(pin)
  │                               │── compare vs DB
  │                               │── INSERT sessions row
  │◄── Set-Cookie: farm_session ──┤
  │    (HTTPOnly, 7-day expiry)    │
  │                               │
  ├─── Any API request ──────────►│
  │    Cookie: farm_session        │
  │                               │── getSession() → validate
  │◄── Response ──────────────────┤
```

### 5.2 PIN Hashing
PINs are hashed using **SHA-256** via the Web Crypto API:
```
hash = SHA256(pin_string).hex()
```
No salt is used (4-digit PIN space is small; salting would not meaningfully improve security given the PIN's inherent entropy).

### 5.3 Access Control Matrix

| Resource | Owner | Employee | Customer |
|---|---|---|---|
| Dashboard, Finance, Analytics | ✓ | ✗ | ✗ |
| Flock management | ✓ | Read-only | ✗ |
| Egg/feed/mortality logging | ✓ | ✓ | ✗ |
| Sales record | ✓ | ✓ | ✗ |
| Sale deletion (direct) | ✓ | ✗ | ✗ |
| Sale deletion (request) | ✓ | ✓ | ✗ |
| Sale deletion (approve) | ✓ | ✗ | ✗ |
| Customer management | ✓ | ✗ | ✗ |
| Settings (PIN, pricing) | ✓ | ✗ | ✗ |
| Customer portal | ✗ | ✗ | ✓ |
| Order management | ✓ | ✓ | ✗ |

---

## 6. State Management Design

### 6.1 Store Structure

The Zustand store is divided into logical slices corresponding to domain entities. Each slice has:
- **State**: the data array or primitive
- **Actions**: methods that mutate state and fire API calls

### 6.2 Data Loading Pattern

```
App mount → app/page.tsx
  └── GET /api/auth/session
       ├── No session → render LoginPage
       └── Session exists → useFarmStore.initialize()
              ├── Promise.allSettled([19 API calls])
              ├── Update store with all results
              └── Render appropriate shell
```

`Promise.allSettled` ensures that a failure of one endpoint (e.g., no alerts yet) does not prevent the entire app from loading. Each failed result falls back to the current store state or an empty array.

### 6.3 Optimistic Update Pattern

```typescript
// Pattern used throughout store actions:
addRecord: (r) => {
  set((s) => ({ records: [...s.records, r] }));  // 1. Update UI immediately
  withApi('POST', '/api/records', r);             // 2. Persist async (fire-and-forget)
}
```

`withApi` catches errors and shows a toast; no rollback is performed. This is appropriate for a single-user, low-concurrent-write system.

### 6.4 Cross-Entity Side Effects in Store

Certain store actions update multiple collections atomically:

| Action | State changes |
|---|---|
| `addMortalityRecord` | mortalityRecords +1, flocks.currentCount − count |
| `addSale` (birds) | sales +1, flocks.currentCount − quantity |
| `deleteSale` (birds) | sales −1, flocks.currentCount + quantity |
| `approveSaleDeletion` (birds) | sales −1, flocks.currentCount + quantity |
| `addBirdStageSale` | birdStageSales +1, flocks.currentCount − quantity |
| `deleteBirdStageSale` | birdStageSales −1, flocks.currentCount + quantity |
| `addFeedDispenseRecord` | feedDispenseRecords +1, feedInventory.currentStockKg − quantityKg |

---

## 7. API Design

### 7.1 Conventions

- All routes require `requireSession()` unless public
- Request body stripped of meta fields (`createdAt`, `updatedAt`) before DB insert via `stripMeta()`
- Errors use standardized `AppError` subclasses → `handleApiError()` maps to HTTP status codes
- All list endpoints return arrays; single-resource endpoints return the object or 404

### 7.2 Route Map

```
/api/
├── auth/
│   ├── login          POST
│   ├── session        GET
│   └── logout         POST
├── flocks             GET, POST
├── flocks/[id]        GET, PUT, DELETE
├── mortality          GET, POST  (POST → decrements flock count)
├── feed-records       GET, POST  (POST → decrements feedInventory)
├── feed-dispense      GET, POST  (POST → decrements feedInventory)
├── feed-inventory     GET, PUT   (PUT → sets absolute stock level)
├── vaccinations       GET, POST
├── vaccinations/[id]  GET, PUT
├── egg-collections    GET, POST
├── customers          GET, POST
├── customers/[id]     GET, PUT, DELETE
├── customer-portal-users  GET, POST
├── customer-portal-users/[id] PUT, DELETE
├── sales              GET, POST  (POST → decrements flock count if birds)
├── sales/[id]         PUT, DELETE (DELETE → restores flock count if birds)
├── bird-stage-sales   GET, POST  (POST → decrements flock count)
├── bird-stage-sales/[id] DELETE  (DELETE → restores flock count)
├── expenses           GET, POST
├── expenses/[id]      DELETE
├── budgets            GET, POST
├── budgets/[id]       PUT, DELETE
├── employees          GET, POST
├── employees/[id]     PUT, DELETE
├── employee-salaries  GET, POST
├── employee-salaries/[id] PUT, DELETE
├── order-requests     GET, POST
├── order-requests/[id] PUT, DELETE
├── alerts             GET, POST, DELETE (DELETE = clear all)
├── alerts/[id]        PUT (mark read)
├── settings           GET, PUT
├── cages              GET, POST
├── cages/[id]         PUT, DELETE
└── health             GET (no auth)
```

### 7.3 Error Response Format

```json
{
  "error": "Human-readable error message"
}
```

HTTP status codes:
- `400` — ValidationError (missing/invalid fields)
- `401` — UnauthorizedError (no session or wrong role)
- `404` — NotFoundError
- `500` — Unexpected server error (logged server-side)

---

## 8. Deployment Architecture

### 8.1 Docker Compose Services

```
┌────────────────────────────────────────────────────┐
│                   Docker Compose                    │
│                                                    │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐  │
│  │    db     │  │   migrate    │  │  farmpro  │  │
│  │ postgres  │  │  (one-shot)  │  │  Next.js  │  │
│  │ :5432     │  │  db:migrate  │  │  :13000   │  │
│  │           │  │  db:seed     │  │           │  │
│  └─────┬─────┘  └──────┬───────┘  └─────┬─────┘  │
│        │               │                │         │
│        └──── depends ──┘                │         │
│              (healthcheck)              │         │
│        └───────────── depends ──────────┘         │
│                       (completed)                  │
└────────────────────────────────────────────────────┘
```

**Startup sequence (enforced by depends_on)**:
1. `db` starts; healthcheck with `pg_isready` passes
2. `migrate` runs `pnpm db:migrate && pnpm db:seed`, then exits 0
3. `farmpro` starts only after migrate exits successfully

### 8.2 Docker Build (Multi-stage)

| Stage | Base | Purpose |
|---|---|---|
| `base` | node:22-alpine | Install pnpm |
| `deps` | base | Install node_modules |
| `builder` | deps | Generate migrations + `next build` |
| `app` | base (fresh) | Copy only `.next/standalone` + static assets |

The production image contains only the built output, not the source code or dev dependencies.

### 8.3 Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | — | Min 32 chars; signs session cookies |
| `PORT` | No | `13000` | App listen port |
| `NODE_ENV` | No | `production` | Affects cookie security flags |

### 8.4 Data Persistence

The `postgres_data` Docker volume persists database state across container restarts. The migration service checks drizzle's `__drizzle_migrations` table to skip already-applied migrations (idempotent).

**Important**: If the database volume exists from a previous run, `db:migrate` will skip already-applied migrations. Do **not** delete the volume unless you intend to reset all data.

---

## 9. Key Design Patterns

### 9.1 ID Generation
All IDs are client-generated before the API call:
```typescript
`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
```
This allows the optimistic update to reference the ID immediately. No auto-increment or UUID-v4 — the timestamp prefix gives rough chronological ordering.

### 9.2 Date Storage
Dates are stored as ISO 8601 strings (`YYYY-MM-DD`) in text columns, not timestamp columns. This avoids timezone complexity for a single-timezone farm operation. `createdAt` uses full ISO timestamp.

### 9.3 Soft vs Hard Deletes
- **Sales**: Soft delete workflow for employees (mark `deletionRequested=true`); hard delete on owner approval
- **All other records**: Hard delete
- **No global soft-delete pattern** — only sales require the audit trail workflow

### 9.4 Currency Precision
All amounts stored as PostgreSQL `numeric` (exact decimal). Display formatted as `Ksh X,XXX.XX` via `formatCurrency()`. No floating-point arithmetic on monetary values.

### 9.5 Feed Inventory Updates
Feed inventory is updated as a side effect of other operations rather than a standalone write, to keep inventory in sync:

| Write operation | Inventory side effect |
|---|---|
| POST /api/feed-records | GREATEST(0, currentStockKg − quantityKg) |
| POST /api/feed-dispense | GREATEST(0, currentStockKg − quantityKg) |
| PUT /api/feed-inventory | SET currentStockKg = absolute value |

---

## 10. Known Limitations and Future Considerations

| Area | Current State | Future Improvement |
|---|---|---|
| Multi-farm | Single farm per deployment | Tenant model with farm_id FK on all tables |
| Role granularity | 3 fixed roles | Configurable permissions per employee |
| Offline support | No PWA/offline | Service worker + IndexedDB sync |
| Audit log | Partial (sales only) | Full audit table on all mutations |
| FCR suggestions | Manual reference | Auto-calculated reorder suggestions based on FCR × flock size |
| Payroll | Pay-day expense trigger | Full payroll module with payslips |
| PDF reports | Not implemented | PDF export for P&L, inventory, sales reports |
| SMS | Order notifications only | Low-feed alerts, mortality alerts |
| API versioning | None (v1 implicit) | `/api/v1/` prefix when breaking changes needed |
