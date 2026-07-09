# Admin Dashboard — Audit & Improvement Plan

| Field | Value |
|---|---|
| **Audit date** | July 2026 |
| **Auditor** | Codebuff AI |
| **Scope** | Admin dashboard (`/admin/dashboard`), admin layout, all admin components & API routes |

---

## 1. Current State

The admin dashboard currently provides:

| Section | What It Does |
|---|---|
| **Branding** | Edit app name, tagline, logo (saved to platform settings) |
| **Packages** | Define subscription plans with feature toggles |
| **Acceptance Testing** | Enable/disable testing per farm, view reports + screenshots |
| **Audit Log** | Filterable system audit trail (who did what to which farm) |
| **Farm Management** | List all farms with plan/features/status, manage owner, suspend/delete |

---

## 2. Critical Gaps

### A. No Platform-Level KPIs/Stats
The dashboard loads with **zero summary metrics**. An admin logs in and sees a blank page of farm names with no sense of the platform's health.

**Missing:**
- Total farms (active vs suspended)
- Total users, workers, batches across all farms
- Revenue summary (if applicable)
- Recent sign-ups / new farms this month
- Alert counts across all farms

### B. No Search or Filter on Farm List
With 50+ farms, the admin must scroll through an unsorted list. There's no search, no sort by name/date/status, and no filter by plan.

### C. No Pagination
All farms load at once. With hundreds of tenants, this will become unusable.

### D. No Sidebar Navigation
The admin layout has a minimal top bar with no sidebar. As admin features grow, navigating between sections (Dashboard, Farms, Users, Audit, Settings) becomes confusing.

### E. Farm Management is Cluttered
The farm cards expand inline to show feature toggles, owner management, and lifecycle actions — all inside a single card per farm. This becomes very long with many farms.

### F. No "Recent Activity" at a Glance
The audit log is hidden behind a toggle. An admin should see recent platform activity on the dashboard without opening a separate panel.

### G. No User Management Beyond Owners
An admin can only manage the owner login. No way to see or manage workers, managers, or vets across farms.

### H. No Dark Mode or Theming
The admin area uses plain gray/white with no theme support.

### I. No Mobile Optimization
The admin dashboard is not responsive — farm cards, feature grids, and forms are cramped on mobile.

### J. No Bulk Actions
Admin can only manage farms one at a time. No bulk suspend, bulk plan change, or bulk feature toggle.

---

## 3. Recommended Improvements (Priority Order)

### P0 — Must Have (Ship This Week)

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 1 | **Stats cards at the top** — total farms, active, suspended, total users, total workers, total batches | Small | High |
| 2 | **Search/filter on farm list** — search by name, filter by plan/status | Small | High |
| 3 | **Sidebar navigation** — Dashboard, Farms, Audit, Settings as separate pages | Medium | High |
| 4 | **Recent activity feed** — last 10 platform events visible on dashboard without toggling audit panel | Small | Medium |

### P1 — Should Have (This Month)

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 5 | **Pagination on farm list** | Small | Medium |
| 6 | **Farm detail page** — separate `/admin/farms/[id]` for full management, freeing up the list | Medium | High |
| 7 | **Worker/manager list per farm** — see who's working on each farm | Medium | Medium |
| 8 | **Quick filters** — "Active only", "Suspended", "Free plan", "Pro plan" | Small | Medium |
| 9 | **Bulk actions** — select farms → bulk suspend, bulk plan change | Medium | High |

### P2 — Nice to Have (This Quarter)

| # | Improvement | Effort | Impact |
|---|---|---|---|
| 10 | **System health monitoring** — API latency, DB connection, error rates | Large | High |
| 11 | **Platform-wide export** — CSV export of all farms with stats | Medium | Medium |
| 12 | **Admin notifications** — alert when a farm is deleted or suspended | Medium | Medium |
| 13 | **Dark mode** | Small | Low |
| 14 | **Dashboard widgets** — customizable layout | Large | Low |

---

## 4. Implementation Plan

### Phase 1: Stats Cards + Search + Sidebar (Implemented Now)

**Stats cards at top of dashboard:**
```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
  <StatCard label="Total Farms" value={stats.totalFarms} />
  <StatCard label="Active" value={stats.activeFarms} />
  <StatCard label="Suspended" value={stats.suspendedFarms} />
  <StatCard label="Users" value={stats.totalUsers} />
  ...
</div>
```

**Search bar for farm list:**
```tsx
<input type="search" placeholder="Search farms..." value={search} onChange={...} />
```

**Sidebar navigation** — split admin into separate pages:
- `/admin/dashboard` — overview stats + recent activity
- `/admin/farms` — farm list with search/filter/pagination (currently on dashboard)
- `/admin/audit` — audit log (move AdminAudit component here)
- `/admin/settings` — branding + packages (move AdminPackages here)

### Phase 2: Farm Detail Page + Pagination

- Move farm management (owner details, suspend, delete) to `/admin/farms/[id]`
- Add pagination to the farm list API
- Add farm-level user list

### Phase 3: Bulk Actions + Monitoring

- Checkbox selection on farm table
- Bulk action toolbar (suspend, change plan, delete)
- System health dashboard

---

## 5. Architecture Notes

- All admin API routes already validate `super_admin` role
- The `GET /api/admin/tenants` endpoint already returns user/batch counts — add summary stats
- Add a `GET /api/admin/stats` endpoint for aggregated platform metrics
- Farm management can be extracted into its own page without breaking existing functionality

---

## 6. UI Component Recommendations

| Component | Use |
|---|---|
| `<StatCard>` | KPI display for platform metrics |
| `<SearchInput>` | Search/filter on farm list |
| `<Sidebar>` | Persistent navigation |
| `<FarmTable>` | Paginated, sortable farm list |
| `<Pagination>` | Page controls |
| `<ConfirmDialog>` | Confirm destructive actions |
