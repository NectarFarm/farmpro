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

- Login works → **Role Notice** screen. This is correct: vet/auditor have no
  mobile screens on this branch (explicit deny, documented in navigation.tsx).

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

### 5.5 Reports + Auditor link (Section 10)

1. Reports → generate **P&L Summary, Batch P&L, Mortality, Feed Consumption** → all return real data. **CSV** and **PDF** export on at least one → real downloadable file matching the screen.
2. Vaccination/Treatment, Labour & Task Cost, FCR & Efficiency → honest "not available yet" card naming the missing data source.
3. **Generate Auditor Link** → copy URL, open in an incognito/logged-out window → read-only reports for this tenant only, no write controls. **Revoke Link** → the same URL is refused.

---

## 6. Known limits (documented, not bugs)

- Role-permissions matrix and module toggles **persist but are not enforced** by navigation/other screens yet.
- Feed-mix recipes, payroll/payslips, farm backup download, vaccination/labour/FCR reports: honest **"not available yet"** states — no backend exists on this branch.

---

## 7. Running the test suite

```bash
pnpm test          # vitest — 195 tests, 25 files (unit-level, no DB needed for most)
pnpm exec tsc --noEmit   # typecheck
```

The unit suite is green on this branch (195/195). The scenarios above are E2E and
are exercised against the running Docker deployment.
