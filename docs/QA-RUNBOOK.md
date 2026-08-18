# IFMS — Mobile UI Build & QA Runbook

Base branch: `mobile-ui-upgrade` · App URL: `http://localhost:13001`
Everything below was verified live on the :13001 Docker deployment — the figures
are what the app actually shows, not what it "should eventually" show.

---

## 1. What you're running

- **App**: Next.js mobile-first farm management UI (single page, role-based screens).
- **DB**: PostgreSQL 16, schema managed by drizzle. The app reads/writes real rows.
- **Ports**: app `13001` (container uses host networking, no port mapping needed), postgres `55433`.

| Component | Where |
|---|---|
| App container | `ifms-latest-app` (image `ifms-latest-app:latest`) |
| Postgres container | `ifms-itest-pg` (postgres:16, port 55433) |
| DB name / user | `ifms` / `postgres` / password `ifms` |

---

## 2. Build & run (Docker)

### 2.1 One-time DB setup

Start Postgres and create the schema:

```bash
# Start postgres if not running
docker run -d --name ifms-itest-pg -p 55433:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=ifms -e POSTGRES_DB=ifms \
  --restart unless-stopped postgres:16

# From the repo root, apply migrations + seed accounts
DATABASE_URL=postgres://postgres:ifms@localhost:55433/ifms pnpm db:migrate
DATABASE_URL=postgres://postgres:ifms@localhost:55433/ifms pnpm db:seed
```

`pnpm db:seed` creates the 2 tenants, 7 accounts, and 2 farms. The rest of the
demo data (batches, employees, inventory, permissions, settings) is **not** in
`db:seed` — restore it with the SQL block in **§2.3** so the scenarios below match.

### 2.2 Build & run the app image

```bash
# From the repo root
docker build -t ifms-latest-app:latest .

# Run (host network so the app reaches postgres on localhost:55433)
docker run -d --name ifms-latest-app --network host --restart unless-stopped \
  -e DATABASE_URL=postgres://postgres:ifms@localhost:55433/ifms \
  -e NEXT_PUBLIC_TENANT_ID=t1 \
  -e NODE_ENV=production \
  -e CI=true \
  ifms-latest-app:latest
```

Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:13001/api/health   # → 200
```

Re-deploy after a code change: `docker stop ifms-latest-app && docker rm ifms-latest-app` then re-run the `docker run` line above.

### 2.3 Demo-data restore (run once per fresh DB)

These are the exact seeded rows the scenarios expect. Idempotent-safe to re-run.

```sql
-- Units (u1/u2 are what batches reference; HSE-NAKURU-001 is the create-batch wizard's house)
INSERT INTO production_units (id, tenant_id, farm_id, type, name, code) VALUES
  ('u1','t1','f1','poultry-broiler','Broiler House A01','UNIT-BRO-A01'),
  ('u2','t1','f1','poultry-layer','Layer House B01','UNIT-LAY-B01'),
  ('5510ff6c-22cb-4628-9a27-11a6256c576d','t1','f1','house','Broiler House A01','HSE-NAKURU-001')
ON CONFLICT (id) DO NOTHING;

-- Batches
INSERT INTO batches (id, tenant_id, unit_id, code, name, species, enterprise, stage, status, initial_qty, current_qty, acquisition_cost_cents, start_date) VALUES
  ('b1','t1','u1','BRO-24','Broilers Oct Run','Cobb 500','broiler','grower','ACTIVE',900,872,8100000,'2026-08-15 10:43:48'),
  ('b2','t1','u2','LAY-08','Layers Batch 8','ISA Brown','layer','laying','ACTIVE',500,494,15000000,'2026-08-15 10:43:48')
ON CONFLICT (id) DO NOTHING;

-- Employees
INSERT INTO employees (id, tenant_id, user_id, name, phone, role, assigned_batch_ids, mortality_photo_threshold, status) VALUES
  ('e1','t1','948a2263-9fe5-4628-94ac-4af89a6fd633','John Kamau','0712345001','worker','{b1}',3,'ACTIVE'),
  ('e2','t1',NULL,'Sarah Mwangi','0712345002','worker','{b2}',3,'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- Inventory items (0 stock on purpose — recording the first purchase is part of the test)
INSERT INTO inventory_items (id, tenant_id, name, category, unit, low_stock_threshold) VALUES
  ('i1','t1','Broiler Starter Mash','Feed','kg',200),
  ('i2','t1','Newcastle Vaccine','Vet','dose',50)
ON CONFLICT (id) DO NOTHING;

-- Chart of accounts (self-ensured by lib/finance.ts too, but seed for determinism)
INSERT INTO accounts (id, code, name, class, normal_balance) VALUES
  ('c124f8b7-5b59-468c-9555-8dc435e60816','1001','Cash and Bank','ASSET','DEBIT'),
  ('8ae57a83-e264-484a-8a74-56d127f246d4','1002','Accounts Receivable','ASSET','DEBIT'),
  ('a619c741-76c2-4948-9a90-877e588107c2','2001','Accounts Payable','LIABILITY','CREDIT'),
  ('6803e996-55fc-4f5e-b78d-a64b67e83f21','3001','Owner''s Equity','EQUITY','CREDIT'),
  ('5fd24e32-b48d-438e-bdd6-857c71ee7cc0','4001','Sales Revenue','REVENUE','CREDIT'),
  ('2bb53743-6c69-4c95-b6c1-e3b25066aedf','5001','Purchases Expense','EXPENSE','DEBIT')
ON CONFLICT (code) DO NOTHING;

-- Tenant settings (defaults)
INSERT INTO tenant_settings (tenant_id) VALUES ('t1') ON CONFLICT (tenant_id) DO NOTHING;
```

Role permissions are written by the Role Builder on first save, but to match the
binder exactly, either save once in the UI (Governance → Role Builder → Save) or
restore the 21-row matrix from the `role_permissions` seed rows shown in §5.3.

---

## 3. Logins (all verified)

| Who | Email | Password / PIN | Role | Tenant |
|---|---|---|---|---|
| James Kamau | james@nakurufarm.com | farm2026 | owner | t1 Nakuru Farm Co. |
| Peter Njoroge | peter@nakurufarm.com | mgr123 | manager | t1 |
| John Kamau | john@nakurufarm.com | worker123 · PIN `1234` | worker | t1 (assigned BRO-24) |
| Dr. Grace Wanjiru | vet@nakurufarm.com | vet123 | vet | t1 |
| Alice Auditor | auditor@ifms.co | aud123 | auditor | t1 |
| Susan Mwangi | susan@nakurufarm.com | susp123 · PIN `5678` | worker | t2 (suspended) |
| IFMS Admin | admin@ifms.co | admin2026 | super_admin | none (platform-wide) |

> **vet / auditor**: login succeeds, then the shell shows the **Role Notice** screen
> ("no screens for this role yet") — that is the correct, deliberate behavior.

---

## 4. Test scenarios — per user

### 4.1 James (owner) — full walkthrough

**A. Dashboard.** Log in as James. Expect a KPI grid with **Active Batches 2**,
**Pending Approvals 0**, **Livestock Units 1,366** (872 + 494), **Crop Batches 0**,
and a Revenue card with a working Month/Quarter/YTD toggle. Greeting shows
**"James Kamau"**.

**B. Bell (top right)** → opens the real **Notifications** screen (not a redirect).
Its "Settings" link → real **Notification Settings** screen. Both were previously
dead redirects; they are fixed on this branch.

**C. Crops** → two batches: **BRO-24 "Broilers Oct Run" (872 of 900)**, **LAY-08
"Layers Batch 8" (494 of 500)**.

**D. BRO-24 → Cost Breakdown tab.** Expect **Total Tracked Cost = KSh 81,000**
(the real acquisition figure). Feed/Health/Labour/Overhead read **"not tracked
yet"** (no data source — honest, not zeros). Economics grid has four tiles:
Total Tracked Cost, Revenue (**KSh 0** until a sale is recorded), Break-even,
Gross Margin (**—** with a "no sales recorded yet" caption).

**E. BRO-24 stat row** → third tile reads **FCR —** (livestock batch), and
**"Cobb 500"** shows next to Stage. (For a crop batch the same tile reads **Area —**.)

**F. BRO-24 → Crop Schedule → any process row → "Configure"** → opens the real
**Process Config** screen (batch code, enterprise, dates). Tap back → lands back
on **BRO-24** detail (not "Batch not found").

**G. Create a batch:** FAB **+** → enterprise selector → **🐔 Broilers** →
name `Broilers Nov Run`, species `Cobb 500`, initial qty `750`, house `Broiler
House A01`. Expect a generated code (e.g. `BRO-NAKURU-001`) and the batch
persists after reload.

**H. Settings → Change Password**: current `farm2026`, new `farm2026NEW` →
succeeds; log out and back in with `farm2026NEW`. (Restore `farm2026` afterward.)

**I. UI Customise**: accent `#a855f7` (purple), greeting `Karibu, James!`,
currency `USD` → save. Dashboard then shows **"Karibu, James!"** + purple accent
tile. Log in as Peter → he sees the same (tenant-wide). Toggle a module (e.g.
Reports) off → persists after reload (nav still shows it — known limit).

### 4.2 Peter (manager)

- Same dashboard as James (greeting shows **"Peter Njoroge"** — the name is the
  real session user, not hardcoded).
- Governance → Role Builder opens; changes persist tenant-wide (e.g. set
  Manager → Finance → **View only**, save, re-login as Peter → still View only).
- Known limit: the matrix persists but is **not enforced** by other screens yet.

### 4.3 John (worker)

- PIN login `1234` (or worker123) → Worker Home with **"My Tasks Today"** list and
  **Quick Record** (Feeding / Mortality).
- Profile shows **mortality photo threshold 3** (real seeded value).
- Submit mortality **count 2** → no photo required, saves. Submit **count 4** →
  blocked until a photo is attached (**"Photo required for 3+ deaths"**).
- Both records appear in his history. **Pay** screen → honest "not available yet".
- Profile → **Sign Out** → actually logs out (previously a dead button).

### 4.4 Dr. Grace Wanjiru / Alice Auditor

- Login works → **Role Notice** screen ("Role not yet supported" + Sign Out
  only). This is correct: vet/auditor have no mobile screens on this branch
  (explicit deny, documented in navigation.tsx) — verified: no bottom nav
  renders for these roles.
- Auditor link (see §5.6) is the real read-only path for auditors.

### 4.5 Susan (suspended tenant, t2)

- Login with `susan@nakurufarm.com` / `susp123` → **refused** with a
  **"This account is suspended — contact support"** message (not a generic
  wrong-password error). PIN `5678` same result.

### 4.6 IFMS Admin (super_admin)

- Admin → **Onboarding queue**: pending requests appear (created via public
  Register). **Approve** → status flips to Approved, one-time modal shows the new
  owner's real **email + temporary password** (copy button, shown once).
- Log out, log in as that new owner with the temp password → dashboard of the
  new farm. (The whole onboarding → provisioning → login loop is real.)
- Admin → **Farms/Tenants**: one more active tenant. **Dashboard/Stats**: real
  counts. **Settings** tab → honest "not available yet".

---

## 5. Transaction scenarios (James) — exact data & expected results

### 5.1 Inventory purchase (Section 4 of binder)

1. Inventory → Stock: **Broiler Starter Mash 0 kg** and **Newcastle Vaccine 0 doses**, both flagged **Low/Expiring** (thresholds 200 kg / 50 doses).
2. Purchases → **Record Purchase**: item `Broiler Starter Mash`, supplier `Unga Ltd`, quantity `500 kg`, unit cost `KSh 55`, method `Mpesa`, paid in full.
   - Expect **Total = KSh 27,500**.
   - Stock now **500 kg**, low-stock flag gone.
3. Lot detail → **Adjust Qty**: `-50 kg`, reason blank → **rejected**; reason `Physical recount` → **saves**, lot now **450 kg**.
4. Governance → Activity Log: the adjustment appears, attributed to James, with **"Physical recount"** visible.
5. Feed Mix tab → honest "not available yet" (no backend).

### 5.2 Tasks — full lifecycle (verified end-to-end)

**Owner side (James):**

1. **Create** → Tasks → FAB → title `Morning feed round — House A01`, due **today**, priority **High**, assignee **John Kamau**. Saves; the card shows the assignee, the **High** chip, and no Approval chip; the Tasks nav badge counts it.
2. **Dashboard**: due-today strip shows the task; Active Tasks KPI counts it.
3. **Bell** → Notifications screen lists **"Task due today: …"**. **Mark all read** clears the unread badge. Tapping the notification row navigates back to **Tasks** (handleNotifTap).
4. **Mark Done** (open the card → detail sheet → Mark Done): without the approval toggle it flips straight to **DONE**.
5. **Approval path**: create a second task with **Requires Owner Approval** ON (the toggle sits to the right of that label in the new-task sheet). Mark it done → it parks at **PENDING APPROVAL**, the Governance **Pending** tile counts it, and **Approve** in the approval queue flips it to approved while writing an `approval.approved` row to the **Activity Log** (attributed to James, with the role-filter chips working).
6. **Persistence**: reload → all three tasks keep their real statuses (DONE / DONE / OVERDUE-or-PENDING).

**Worker side (John, PIN 1234):**

7. Worker Home shows **"My Tasks Today"** with the real tasks and statuses; overdue tasks read **OVERDUE** (08:00 due time — expected once the time passes).
8. Tap the check button on a pending task → **✓ Done**.
9. Profile shows the real employee record (**John Kamau / Worker**, Today's Records, Settings).

### 5.3 Role Builder (Section 5.3)

1. Governance → Role Builder → edit **manager** → **Finance** → cycle to **View only** → Save. Expect the **CRUD Rules** summary tile to show a real count.
2. Log out, log in as Peter → Role Builder still shows **View only** for Manager/Finance (persisted in DB).

### 5.4 Sale + GL (Section 9)

1. Finance → Sales → **Record Sale**: item `Tray eggs (30) × 120`, batch `LAY-08`, amount `KSh 36,000`, method `Mpesa`, paid. Appears in the list immediately.
2. Finance → Overview → **Batch P&L**: BRO-24 and LAY-08 both listed, each with real acquisition cost; LAY-08 revenue = **KSh 36,000** (matches Crops detail screen).
3. Budget Overview **Month / Quarter / YTD** toggle actually changes the Revenue/Expenses/Net figures to that period's real sales/purchases (was previously hardcoded).
4. Finance → GL Accounts → **Trial Balance**: Sales Revenue **KSh 36,000** and Purchases Expense **KSh 27,500** — same order of magnitude (the old ~100× unit-mismatch bug is fixed; both post as whole KSh).
5. Payroll tab → honest "not available yet".

### 5.10 Sale → GL trial balance, end-to-end (verified, 20/20)

1. Finance (owner tab) → Overview: Batch P&L lists the real batch (code + revenue/cost/margin), Budget Overview shows real Revenue/Expenses/Net; **Month/Quarter/YTD** toggle re-renders with the period's figures.
2. **Record a PAID sale** (item `Tray eggs (30) × 120`, batch = the real batch, amount `36000`, method `Mpesa`): appears in the Sales list with **PAID** chip.
3. **GL Accounts** → trial balance now shows: **Sales Revenue 36,000** (credit) and **Cash and Bank 36,000** (debit) — the paid sale posts **Dr Cash / Cr Revenue**, and the trial balance reports **Balanced** with equal totals.
4. **Record a PENDING sale** (item `Manure sacks`, no batch, amount `5000`, status PENDING): shows **PENDING** chip in the list.
5. GL after the pending sale: **Accounts Receivable 5,000** (debit) and Sales Revenue now **41,000** — a pending sale posts **Dr Accounts Receivable / Cr Revenue** (not Cash). Still **Balanced**.
6. **DB-level integrity** (worth spot-checking): every journal entry balances by construction (`SUM(debit) = SUM(credit)` per entry), each sale row has exactly one journal entry with the right memo (`Cash sale recorded` vs `Sale recorded on account`), and the trial balance totals always match. Verify via the SQL in the test notes.
7. Payroll tab → honest "not available yet".

Note: sales post as whole KSh and purchases post as whole KSh (from `*Cents`, divided by 100 in lib/finance.ts) — both sides of the ledger are the same order of magnitude (issue #290 fix).

### 5.5 Mortality flow (worker, verified end-to-end)

1. John (PIN `1234`) needs an **employee row linked to his user id** and an
   **assigned batch** (both come from People — the seed does not create
   employees). With `mortalityPhotoThreshold = 3` and `assignedBatchIds` set:
2. Record → **Mortality** → pick the assigned batch → count step shows the
   batch's real **System count**.
3. Set **count = 2** → NO "Photo required" warning (below threshold). Next
   jumps straight to Confirm → **Save Record** saves without a photo. Verified
   in the DB: `data.count = 2`, `photoUrl = null`.
4. Submit again with **count = 4** → warning **"Photo required for 3+ deaths"**
   appears, Next forces the **Photo Evidence** step, and **Continue with Photo
   stays disabled until a photo is attached**. Attach a photo → Confirm → Save.
   Verified in the DB: `data.count = 4`, `photoUrl` set.
5. Both records appear in the worker's Recent Activity.
6. The photo gate is now enforced **server-side too**: `POST /api/records`
   reads the employee's real `mortalityPhotoThreshold` and rejects any
   mortality record whose `data.count` is at/above it without a `photoUrl`
   (400: "A photo is required for N+ deaths") — so a direct API call can't
   bypass the client check. Feeding/physical_count records are unaffected.
   Verified live: count 2 → 201, count 3 (no photo) → 400, count 4 (no
   photo) → 400, count 4 (with photo) → 201.

### 5.6 People — employee CRUD (verified end-to-end)

1. People → list shows the seeded employee (Akai Elim) with real summary
   counts (Active / Inactive / Total).
2. **Add Employee** (3-step wizard: Identity → Threshold → Batches):
   name `QA Test Worker`, phone, role worker → appears in the list
   immediately; the API row is real (phone, `mortalityPhotoThreshold = 3`,
   `status = ACTIVE`). Step 2 shows the honest note that login
   credentials (PIN / password) are provisioned separately, not by this
   form.
3. Detail screen: real profile (initials avatar, role chip, **ROLE
   ASSIGNMENT**, employee id, phone, **Login: No login account**, photo
   threshold, assigned batches).
4. **Change Role** → worker → **Manager** → "Role updated successfully";
   survives reload.
5. **Deactivate/Reactivate** toggle flips `status` ACTIVE ↔ INACTIVE via
   PATCH (there is no DELETE — employees are deactivated, not removed).
6. **Payroll tab** (per-employee and anywhere else it appears) → honest
   "Not available yet — no payslip data exists" state; no fabricated
   payslips.
7. Search narrows the list; reload keeps everything (session + employee +
   role).

### 5.7 Inventory — purchase, stock levels, adjustment (verified end-to-end)

Navigation: owners reach Inventory via **More → Inventory** (managers have a
**Stock** bottom tab).

1. **Stock tab** lists real items + on-hand totals (e.g. Broilers Mash 50 kg),
   with search and category chips.
2. **Purchases tab** lists real purchase rows with payment status and
   `KSh total` (e.g. the existing Unga Ltd purchase: 50 @ KSh 50 = KSh 2,500,
   PARTIAL).
3. **Record Purchase** (sheet): supplier `QA Feeds Ltd`, item `QA Test Mash`
   (new item — auto-created), unit `kg`, qty `500`, cost/unit `KSh 55`,
   method `M-Pesa`, amount paid `KSh 27,500`. Saves → appears in the list as
   **PAID · KSh 27,500**; Stock shows **500 on hand**; the API row is real
   (`quantity 500`, `totalCostCents 2,750,000`, 1 lot).
4. Item detail → **Lots** → **Adjust**: the qty field + a **Reason***
   (required). Save is **disabled without a reason** (client) and the
   endpoint also **400s without one** (server, `reason is required`).
   With qty `450` + reason `QA physical recount` → saves; the lot shows
   450, and **Governance → Activity Log** lists an `inventory.adjust` row
   attributed to James with `Reason: QA physical recount`.
5. **Variance tab**: staleness-based (no physical-counts table on this
   branch — documented in the tab).
6. **Feed Mix tab** → honest "Feed Mix not available yet — no feed-mix
   backend on this branch".

### 5.8 Reports + Auditor link (Section 10)

1. Reports → generate **P&L Summary, Batch P&L, Mortality, Feed Consumption** → all return real data. **CSV** and **PDF** export on at least one → real downloadable file matching the screen.
2. Vaccination/Treatment, Labour & Task Cost, FCR & Efficiency → honest "not available yet" card naming the missing data source.

### 5.9 Reports — CSV/PDF export data integrity (verified end-to-end, 47/47)

Precondition: the tenant needs at least one sale, one mortality record (count 2 + count 4, the latter with a photo), and one feeding record with `feedItems` — seed via SQL or via the normal flows (Finance → Sales, Worker mortality form, Worker feeding form). Then:

1. **P&L Summary** → on-screen rows show the real sale (e.g. `Tray eggs (30) x 120`, `36000`) and purchases (`Unga Ltd`). **Export CSV** → file `pl-2026-08-01_to_2026-08-31.csv` downloads; header is exactly `Date,Type,Description,Batch,Amount,Status`; rows carry the same real figures as the screen. **Export PDF** → valid `%PDF-` file (>1 KB) whose text contains the report title and the real rows.
2. **Mortality Report** → rows show deaths 2 (Injury) and 4 (Disease) from the real `records` table; CSV header `Date,Batch,Deaths,Cause`; same data in CSV + PDF.
3. **Feed Consumption** → one feeding submission with two `feedItems` flattens to **two rows** (one per feed item); CSV header `Date,Batch,Feed Item,Qty (kg)`; the item names and kgs match the DB.
4. **Batch P&L** → row for the real batch (e.g. `BRO-NAKURU-001`, revenue `36000`, cost, margin `%`); CSV header `Batch,Name,Status,Revenue,Cost,Margin,Margin %`; figures match the Cost Breakdown tab.
5. For every export: the **CSV header must equal the on-screen column headers**, and every on-screen row must appear in the exported file (preview truncates at 8 rows — the export carries the full set).
6. **Not-available types** (Production, Vaccination, Labour, FCR) → card names the missing data source and **no Export buttons render** — never a fake/empty file.
7. **Recent Exports** list shows each real download (name + timestamp + `CSV`/`PDF`) for the session.

Verified: all 4 real reports export correct CSV + valid PDFs containing the same figures shown on screen; exports are built client-side from the single `{title, columns, rows, meta}` shape (lib/report-export.ts) — no per-type export code to drift.
3. **Generate Auditor Link** → the URL is `{origin}/auditor/{token}`. Open it in an **incognito/logged-out window** → read-only reports for this tenant only, no login wall, no write controls (no Record Sale / Add Task / Approve / Sign Out anywhere). **Revoke Link** → the same URL is refused (404/expired). Verified end-to-end.

---

## 6. Farmer onboarding journey — brand-new farm, end to end

Verified in full against the :13001 deployment (26/26 checks). This is the
"is everything set up?" path a real applicant walks: register → admin approves
→ new owner logs in → sets up the farm. Exact data + what to expect at each step:

### 6.1 Register (logged out, any browser)

Login screen → **Request Access** → 3-step form:

| Field | Type |
|---|---|
| Full Name | any real name, e.g. `Test Farmer` |
| Email | **must be unused**, e.g. `newfarmer@example.com` |
| Phone | any, e.g. `+254700000000` |
| Farm Name | any, e.g. `Test Poultry Farm` |
| Area / Region | any, e.g. `Nakuru` |
| Enterprises | tap **Broiler** (any 1+ works) |

Expect: **Request Submitted!** confirmation. No login yet — the request is
queued for the admin (visible in the Admin → Requests queue as Pending).

### 6.2 Admin approves (admin@ifms.co / admin2026)

Admin → **Requests** tab → tap the request card → **Approve & Onboard**.

Expect:
- A one-time modal: **Tenant Approved** with the owner's email and a
  **temporary password** + Copy button. Write it down — shown exactly once.
- Queue status flips to **APPROVED**; Admin → Farms lists one more active tenant.
- Approving really creates the tenant, its first farm, and the owner account.

### 6.3 New owner logs in (logged out)

Email from step 1 + the temp password.

Expect:
- Dashboard loads with the farm's real name and **the owner's real name** in
  the greeting (e.g. "Good morning! Test Farmer 🌾") — not another user's name.
- **More** hub profile card shows the same owner name + the real farm name
  (initials derived from the name).

### 6.4 Change password (More → Change Password)

Current = temp password · New + Confirm = e.g. `farm2026NEW`.

Expect: toast "Password changed." Log out and back in with the NEW password — it works.

### 6.5 Branding (More → UI Customise → Branding)

Greeting = `Karibu, farmer!` · Currency = `USD` (or any) · Save Customisation.

Expect: back on the Dashboard the greeting now reads **Karibu, farmer!**
(reload-safe — stored per tenant).

### 6.6 Add an employee (More → People → + button)

Full Name `Doe Farmhand` · Phone `0711223344` · Next → Next → **Add Employee**.

Expect: appears in the People list immediately and after reload. (Batches step
says "No batches exist yet" on a fresh farm — correct, not a bug.)

### 6.7 Role Builder (More → Governance → Roles)

Expect: honest empty state **"No roles configured yet."** → **Create New Role**,
name `supervisor`, tap through any feature toggles (all default Hidden), save.

Expect: the role appears in the list, the Roles tile counts it, and it survives
logout/login.

### 6.8 Create a batch (Farm tab → + button → Broiler)

The wizard auto-creates its production unit — a fresh tenant needs nothing
pre-seeded:

| Step | Field | Type |
|---|---|---|
| 1 | Batch Name | `Test Flock A` |
| 1 | Initial Count | `300` |
| 2 | House Name | `Test House 1` (auto unit created on save) |
| 3 | Initial Input Cost (KSh) | `50000` |
| 4 | → **Create Broilers Batch** | |

Expect: batch detail opens showing the batch; reload — it persists. The unit
shows up under Farm → Units.

### 6.9 Record a purchase (More → Inventory → Purchases → + button)

Items are **not** pre-seeded — the purchase auto-creates the item by name:

| Field | Type |
|---|---|
| Supplier | `Test Feeds Ltd` |
| Item | `Test Broiler Mash` |
| Unit | `kg` |
| Quantity | `100` |
| Cost/unit | `50` |
| Payment / Amount paid | `M-Pesa` / `5000` |

Expect: **Record Purchase** saves; the item appears in Stock (100 kg on hand)
and the purchase in Purchases.

### 6.10 Record a sale (Finance tab → Sales → + button)

| Field | Type |
|---|---|
| Item | `Test eggs (tray)` |
| Amount (KSh) | `15000` |
| Method | `Mpesa` |
| Batch | leave `No batch (general sale)` |

Expect: appears in the Sales list; Finance → Overview revenue reflects it.

### 6.11 Wrap-up checks

- Reload the app: still logged in, greeting/branding intact.
- Sign out → sign in with the NEW password: everything (employee, role, batch,
  purchase, sale) is still there.

---

### 5.11 CSV import / export — data integrity (verified end-to-end, 29/29)

1. **Inventory export** (Stock tab → export icon) → `inventory.csv` downloads with header `id,name,category,unit,qtyOnHand,lowStockThreshold,avgCostCents,status` and real rows (on-hand = sum of lots, avg cost, status).
2. **Re-importing that exported file** → the import modal flags **column issues** (missing `qty`/`reorder`/`costPerUnit`) and shows **0 importable rows** — the round-trip is broken (see Known limits below). This is a real gap, not user error.
3. **Inventory import** with the template's columns (`id,name,category,unit,qty,reorder,costPerUnit,lotNumber,expiryDate`) → 2/2 rows importable, imports cleanly. Verified in DB: each row created an item + a lot with `qty_on_hand`, `unit_cost_cents = costPerUnit × 100`, `low_stock_threshold = reorder`, `lot_no`, `expiry_date`, under supplier "CSV Import".
4. **Employee import** (People → import icon) with `code,name,role,phone,salary,payday,startDate,endDate,batches,active` → 2/2 rows importable, both appear in the list. Verified in DB: `name`, `role`, `phone`, `status` (from `active`), `assigned_batch_ids` (resolved from `batches` codes) — salary/payday/startDate/code have no backend column and are intentionally dropped.
5. **Tasks export** → `tasks_export.csv` with header `title,assignee,status,priority,dueAt,requiresApproval,notes` containing the real tasks.
6. **GL export** (Finance → GL Accounts → Export GL to CSV) → `gl-trial-balance.csv` with header `code,account,type,normalBalance,debit,credit,balance` and real balances — and imported purchases correctly flow into the GL (expense side grew by the imported totals).
7. **Template download** (import modal → Download blank template) → file header exactly matches the import's expected columns, with one example row.

---

### 5.12 Batch/unit code previews — wizard matches what's saved (verified end-to-end, FIXED)

1. **As James** → Farm tab → `+` FAB → **Broilers**. The wizard header shows `Auto-code: BRO-NAKURU-002` (the real next sequence for this farm) and step 2's unit field shows `HSE-NAKURU-002`.
2. Fill the steps and create the batch. The saved batch's real code in the DB and on the detail screen is exactly the previewed `BRO-NAKURU-002` (and the unit `HSE-NAKURU-002`).

**Fixed (was broken):** the preview used to hardcode `genCode(prefix, "KMU", 24/7)` — it showed `BRO-XXX-024` / `HSE-KMU-007` regardless of the farm, while the server created `BRO-NAKURU-002`. The wizard now fetches the real batches/units and computes the preview exactly like the server (`<prefix>-<farm-segment>-<seq>`, seq = existing count + 1).

---

### 5.13 Mock-data purge — remaining hardcoded data removed (verified end-to-end, FIXED)

An audit of every screen + the shared `data.ts` for mock/hardcoded data found three live leaks and a pile of dead mock constants. All fixed and verified in the browser:

1. **CSV import validation used mock universes.** The import modal validated roles against the mock `OWNER_ROLES` (which offered `harvest_lead` — a role that has never existed in the backend — and omitted `owner`), and "already exists"/"batch not found" hints against mock `BATCHES_DATA` codes (e.g. `BRO-KMU-022`) that don't exist for real tenants. Now: roles validate against the real backend set (`owner | manager | worker | vet | auditor`), batch existence is checked against **real fetched** `GET /api/batches` codes, and the employee-code existence check is gone (the backend has no employee-code column). Verified live: importing an employee with `role=owner` + `batches=BRO-NAKURU-001` now reviews as **0 errors / 0 warnings / 1 clean** — previously both would have been flagged.
2. **Nav farm switcher fell back to mock farms.** `FARMS_DATA` (Nakuru Main Farm / Eldoret Satellite Farm) was the initial state and was kept on any empty API response — a tenant with zero farms would see two farms that don't exist. Now the list starts empty and only ever reflects `GET /api/farms`; the mock fallback is deleted.
3. **People's role picker offered `harvest_lead`** when no role matrix is saved (the default). Fallback now uses the real roles: `owner | manager | worker | vet | auditor`. Verified live: the Add-Employee role dropdown lists exactly those five.
4. **Dead mock constants deleted from `data.ts`:** `BATCHES_DATA`, `EMPLOYEES_DATA`, `PRODUCTS_DATA`, `TASKS_DATA`, `APPROVALS_DATA`, `NOTIFICATIONS_DATA`, `FARMS_DATA`, `OWNER_ROLES`, `GL_CHART`, `ONBOARD_REQUESTS`, `getCurrentPrice` — all had zero real consumers, and several had previously leaked into real flows precisely because they were importable. Types (`Task`, `Employee`, `OnboardRequest`, …) and static UI config (`ENTERPRISE_REGISTRY`, `CSV_TEMPLATES`/`downloadCSV`) remain.

**Honest "not available yet" states are intentional, not mock data** — Weather, Feed Mix, Payroll (×3), Farm Backup, and the Vaccination/Labour/FCR reports render real empty states naming the missing backend, with zero fabricated figures.

---

### 5.14 Mobile scrolling — long screens were clipped, now scroll (verified end-to-end, FIXED)

**Bug:** on phones (and desktop!) every screen taller than the viewport was clipped with no way to scroll down. Cause: the shell's screen wrapper (`app/page.tsx`) was a `display: block` div with `overflow: hidden`, so each screen's root `.screen-content` (`flex: 1; overflow-y: auto`) had no bounded height — its `flex: 1` was inert, it grew to full content height (e.g. 2265px inside a 732px wrapper), and `overflow-y: auto` never engaged. The login/register branches already used the correct pattern (flex column parent + `overflowY: auto` child); the main shell didn't.

**Fix:** the wrapper is now `display: flex; flex-direction: column` so `.screen-content` is height-bounded and scrolls internally. Also added `100vh` fallbacks before `100dvh` in `global.css` for browsers without dynamic-viewport support.

**Verified (browser, mobile viewport 390×844, real touch gestures):** Settings shows `clientH 732 / scrollH 2265`; a finger swipe scrolls to `scrollTop 1533 = maxScroll` (the Sign Out button at the very bottom is reachable). Desktop (1280×800) also scrolls to the bottom of long screens. Short screens correctly show no scroll.

### 5.15 Settings screen audit (verified, FIXED)

1. **Five dead click targets removed** — rows that rendered a chevron and did nothing on tap: *Sync Now*, *Active Sessions*, *Help & Support*, *Privacy Policy*, and *About IFMS*. They now follow the app's own honest convention (inert row + "Not available yet" badge naming the missing backend; About stays as a plain info row).
2. **Fake "PRO PLAN" chip removed** — the profile card showed "PRO PLAN" for every user, but no plan concept exists in the backend (no `plan` column in any table). Removed rather than fabricated.
3. **Verified working:** Change Password (real `POST /api/auth/change-password`, client validation: 8-char min, match, different), theme + font-size pickers (optimistic, persisted per-tenant via `PATCH /api/settings`, survive reload), notification/offline toggles (optimistic with rollback + toast on a 403), profile card (real session user + real farm name), Worker PIN Management / Download Farm Backup honest not-available states.

---

### 5.16 Session cookie over plain HTTP — 401 "Unauthorized" on every save (verified, FIXED)

**Bug:** on a phone hitting the app over plain HTTP on the LAN (`http://192.168.x.x:13001`), every settings save (theme, font size, toggles, password) failed with `{ success: false, error: "Unauthorized" }`. Root cause: the session cookie was set with `Secure` whenever `NODE_ENV === 'production'` (which the Docker build always is), but a **Secure cookie is never sent back over plain HTTP** — the browser stored it after login and then withheld it from every API request, so `getSessionUser()` returned null → 401. It worked on `http://localhost` only because Chrome treats localhost as a secure context exception (so the bug hid in local testing).

**Fix:** the cookie's Secure flag is now decided by the request's **real protocol** (`lib/auth.ts` `sessionCookieSecure`): https (direct or via `x-forwarded-proto` from a TLS-terminating proxy) → Secure; plain http → not. `COOKIE_SECURE=true/false` forces it for deployments that need a fixed value.

**Verified over the LAN IP (the exact broken scenario):** `curl http://<lan-ip>:13001/api/auth/login` now returns `Set-Cookie: ifms_session=...; HttpOnly; SameSite=lax` (no Secure), and the full login → `PATCH /api/settings` → session bootstrap round-trip succeeds over plain HTTP.

**Note for testers:** a phone that logged in *before* this fix still holds the old Secure-marked cookie — sign out (or just log in again, which overwrites it) before retesting.

---

### 5.17 Settings persistence + farm switching (verified, FIXED)

**Settings persistence — verified working, no change needed:** theme, font size, notification/sound/offline toggles all round-trip through `PATCH /api/settings` (per-tenant row, not per-device). Tested live: change theme → reload → still applied (API returns the saved values). Toggles are optimistic with rollback + toast on a 403.

**Farm switching — now actually scopes data:**
1. **The active farm persists across reloads** — previously the farm switcher forgot your choice on every refresh (localStorage `ifms_active_farm`). Now: switch to Eldoret → reload → still on Eldoret, crops still filtered.
2. **People is now farm-aware** — an employee's farm is derived from real data (employee → assigned batches → batch.unit_id → production_units.farm_id → farm code). On Eldoret you see only Eldoret staff (subtitle "Staff on Eldoret Satellite", summary counts + role chips farm-scoped); on Nakuru only Nakuru staff; "All Farms" shows everyone. Previously People showed every tenant employee regardless of the selected farm.
3. **Crops was already farm-aware** (batch → unit → farm), now demonstrable: switching to Eldoret shows `BRO-ELDORET-001` and hides `BRO-NAKURU-001`, and vice versa.
4. **Seed now includes per-farm demo data** (`db/seed.mjs`): Nakuru (House 001 / BRO-NAKURU-001 / Akai Elim) and Eldoret (House E01 / BRO-ELDORET-001 / Lydia Chebet), idempotent (ON CONFLICT DO NOTHING), so a fresh `pnpm db:seed` shows the farm switch working.

**Schema-level limits (honest, not fixable in the UI):** only `production_units` has a `farm_id` column. Batches and employees are farm-scoped *indirectly* (via their unit / assigned batches) — which is what Crops and People now use. **Tasks, Inventory, Finance, Governance, Reports have no farm column at all** (tasks even lacks a batch reference), so they are genuinely tenant-wide and cannot change when switching farms without a schema migration.

---

### 5.18 UI Customise save button + tenant currency flows (verified end-to-end, FIXED)

**Save button floated mid-screen (FIXED):** the Save Customisation button used `position: sticky; bottom: 80` inside the `.screen-content` scroll container. Measured before the fix: the button pinned **112px above the bottom nav** (180px above the viewport bottom — ~78% down a 844px viewport, effectively mid-screen on phones), because sticky offsets are relative to the scrollport's *content box* (which sits 20px above its border box thanks to `padding-bottom: 20px`), and sticky-in-scroll-container is exactly the pattern iOS Safari mis-renders. Replaced with a `position: fixed` save bar (`.save-bar`): pinned 20px above the nav on mobile, tracks the content column on desktop (≥1024px sidebar offset via viewport math), and the tab content got `padding-bottom: 170px` so nothing hides behind it. Verified live: bar bottom sits at a constant 20px above the nav at both scrollTop 0 and full scroll.

**Tenant currency symbol now flows to every money screen (FIXED):** `currencySymbol` was saved to `tenant_settings` but **never applied anywhere** — `KSh` was hardcoded in ~50 places across Finance, Dashboard, Inventory, Crops, and the CSV-import salary warning. Now:
1. `NavContext` exposes `currencySymbol` (fetched once from GET /api/settings, default `KSh`) plus a `refreshBranding()` callback.
2. Finance (Budget Overview, Batch P&L, Sales, GL accounts, purchase/sale sheet labels), Dashboard (Revenue card, prices strip, chart tooltip), Inventory (stock table, purchases, item detail, history), Crops (summary cards, cost breakdown, break-even, wizard labels) all render with the tenant's symbol.
3. ui-customise calls `refreshBranding()` after a successful save, so the symbol propagates to every screen instantly (previously screens reading context only updated after a full reload — verified: the DB had `USD` but Finance still showed `KSh` until this fix).

**Verified live:** set currency to USD in UI Customise → save → Finance shows `USD 15K / USD 15,180` and Dashboard shows `USD` immediately, no reload; reset back to `KSh` afterward. 198/198 tests pass.

---

## 7. Known limits (documented, not bugs)

- Role-permissions matrix and module toggles **persist but are not enforced** by navigation/other screens yet.
- Feed-mix recipes, payroll/payslips, farm backup download, vaccination/labour/FCR reports: honest **"not available yet"** states — no backend exists on this branch.
- **Inventory CSV round-trip mismatch (real gap):** the Stock tab's *export* writes `qtyOnHand`/`lowStockThreshold`/`avgCostCents`/`status`, but the *import* template expects `qty`/`reorder`/`costPerUnit`/`lotNumber`/`expiryDate` — and the import modal claims "the best import file is one you previously exported from this app — it already has the correct column names". Re-importing an export is blocked (0 importable rows). Fix: align the export headers with the import columns (or teach the import to accept the export's names).

---

## 8. Running the test suite

```bash
pnpm test          # vitest — 195 tests, 25 files (unit-level, no DB needed for most)
pnpm exec tsc --noEmit   # typecheck
```

The unit suite is green on this branch (195/195). The scenarios above are E2E and
are exercised against the running Docker deployment.
