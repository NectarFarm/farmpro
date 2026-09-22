# IFMS End-to-End Test Plan

## 1. Setup

**Environment:**
```bash
make up                              # Starts app + postgres
# Access at http://localhost:13001
# Database: postgres://postgres:ifms@localhost:55433/ifms
```

**Account Setup Order (load-bearing dependency chain):**
A fresh farm MUST be configured in this exact order because downstream flows deadend without earlier steps:

1. **Farm** (auto-created on approval, via onboarding)
2. **Units** (houses/pens/paddocks/fields — batch placement dependency)
3. **Batch** (group of animals/crop — record attachment point)
4. **Products** (what you sell; attach to units so batches inherit)
5. **Stock** (feed/supplies; record a purchase to enable feeding records)
6. **Employees** (add person, then set phone+PIN for login)
7. **Routines** (worker sees no tasks until one is created)
8. **Approvals** (set role permissions and approval requirements)

---

## 2. Per-Role, Per-Screen Test Cases

### OWNER — Farm Management & Financial Control

#### OWN-DASH-01: Dashboard loads with KPIs
- **Screen:** Dashboard
- **Preconditions:** Owner logged in; at least one batch exists
- **Steps:**
  1. Navigate to Home tab
  2. Observe greeting header with farm name and date
  3. Check alert chips: overdue tasks, pending approvals, low stock
  4. Verify setup-progress card shows next step (e.g. "Add stock")
  5. Verify revenue hero card shows month/quarter/year toggles with revenue figure
  6. Check stat tiles: batches count, tasks count, approvals count
  7. Scroll to work-queue list; verify overdue/today/upcoming separation
- **Expected:** All KPIs render; revenue hero fetches from GET /api/dashboard/kpis; chart updates on period change
- **Verify:** DB check batches count matches; test with farm filter active
- **Priority:** P1

#### OWN-DASH-02: Setup progress card navigates to next step
- **Screen:** Dashboard
- **Preconditions:** Farm created but units not yet added
- **Steps:**
  1. Tap setup-progress card "Add your houses and fields"
  2. Observe navigate to Units tab on Crops screen
- **Expected:** Navigate to crops?tab=units; setup card gone once units added
- **Verify:** GET /api/setup-state confirms step status; test full sequence
- **Priority:** P1

#### OWN-NOTIF-01: Notifications screen marks read
- **Screen:** Notifications
- **Preconditions:** At least one unread notification exists
- **Steps:**
  1. Tap bell icon in sidebar (or tab in "More" sheet on mobile)
  2. View notification list; observe unread badge count in sidebar
  3. Tap a notification to view
  4. Tap "Mark as read"
  5. Observe badge count decreases
- **Expected:** Notification row becomes grey/inactive; badge count updates real-time
- **Verify:** GET /api/notifications?read=false count decreases; re-check sidebar badge
- **Priority:** P2

#### OWN-NOTIF-02: Notification settings toggle channels
- **Screen:** Notification Settings
- **Preconditions:** Owner logged in
- **Steps:**
  1. Navigate to Settings > Notification Settings
  2. Toggle email notifications on/off for each category (approvals, tasks, etc.)
  3. Save changes
  4. Create a notification-triggering event (e.g. assign a task)
  5. Verify owner does/doesn't receive email
- **Expected:** Toggles persist; POST /api/settings updates user preferences
- **Verify:** Check users table notification_preferences column; test email delivery
- **Priority:** P2

#### OWN-UNITS-01: Add a unit (house/pen/paddock/field)
- **Screen:** Crops → Houses & fields tab
- **Preconditions:** Farm exists; owner on Crops screen
- **Steps:**
  1. Tap "Add house" button
  2. Enter name (e.g. "Dairy Paddock")
  3. Tap field for type (Paddock / Pen / House / Field)
  4. Enter area (hectares/acres with unit toggle)
  5. Save
- **Expected:** Unit appears in list; GET /api/units returns new record
- **Verify:** Units count in setup-state increments; batches can reference it
- **Priority:** P1

#### OWN-UNITS-02: Edit unit details
- **Screen:** Crops → Houses & fields tab
- **Preconditions:** One unit exists
- **Steps:**
  1. Tap unit name in list
  2. Observe detail pane (desktop) or Inspector sheet (mobile)
  3. Tap "Edit" button
  4. Change name and save
- **Expected:** PATCH /api/units/[id] succeeds; list updates immediately
- **Verify:** DB units table reflects change; batch allocation still intact
- **Priority:** P2

#### OWN-BATCH-01: Create a batch (livestock/crops)
- **Screen:** Crops → Livestock tab
- **Preconditions:** At least one unit exists
- **Steps:**
  1. Tap "New batch" button
  2. Enter name and code
  3. Select type (cattle/poultry/pigs/fish/crops)
  4. Select unit where batch lives
  5. Enter opening headcount/area
  6. Select products that attach to this batch
  7. Finish setup wizard
- **Expected:** Batch created via POST /api/batches and appears in list
- **Verify:** batch.currentQty set to opening count; products inherited from unit; setup-state progresses
- **Priority:** P1

#### OWN-BATCH-02: Record mortality and see approval flow
- **Screen:** Crops → Livestock tab → Batch detail
- **Preconditions:** Batch exists with headcount > 3; worker can record mortality
- **Steps:**
  1. Open batch detail card
  2. **From worker role:** Post a mortality record (2 animals) via worker-record screen
  3. **Back to owner:** Observe pending approval badge on Approvals screen
  4. Tap approval, review mortality record
  5. Choose Approve or Reject
  6. **Verify:** If approved, batch headcount decreases by 2; if rejected, unchanged
- **Expected:** mortality record created with pendingApproval=true until decision; headcount moves only on approval
- **Verify:** GET /api/approvals?status=pending; check batch.currentQty before/after; audit trail in movements
- **Priority:** P1

#### OWN-BATCH-03: View batch cost breakdown
- **Screen:** Crops → Batch detail → Cost tab
- **Preconditions:** Batch has costs (from feeding records, mortality, purchases)
- **Steps:**
  1. Open batch detail, tap "Cost" tab (if available)
  2. Observe breakdown by category (feed, mortality, labour)
  3. Scroll to revenue section if any sales
  4. Verify margin calculation
- **Expected:** GET /api/batches/[id]/cost-breakdown returns structured costs; labour shows "not tracked" if no payroll integration
- **Verify:** Cost totals match finance module; test with zero costs (empty state)
- **Priority:** P2

#### OWN-PROD-01: Add a product and attach to unit
- **Screen:** Crops → Products tab
- **Preconditions:** Farm exists
- **Steps:**
  1. Tap "Add product"
  2. Enter name (e.g. "Whole milk")
  3. Select stock effect (reduces headcount / reduces collected / no effect)
  4. Set unit (liters / kg / individual)
  5. Save
  6. Open a unit detail, "Products" card
  7. Tap "Attach products"
  8. Select newly created product
- **Expected:** Product created via POST /api/products; unit-product attachment via PUT /api/units/[id]/products
- **Verify:** New batches in that unit inherit the product; sale records can reference it
- **Priority:** P1

#### OWN-INVEN-01: Add stock item and record purchase
- **Screen:** Inventory → Stock tab
- **Preconditions:** Farm exists
- **Steps:**
  1. Tap "Add stock item"
  2. Enter name (e.g. "Layer mash"), unit (bags/kg)
  3. Set safe-stock level
  4. Save
  5. Tap "Record purchase"
  6. Select item, qty (e.g. 50 bags), unit cost
  7. Enter supplier and date
  8. Save
- **Expected:** Stock item via POST /api/inventory/items; purchase via POST /api/purchases
- **Verify:** Inventory list shows new item; purchase appears in purchases tab; days-of-cover calculated (need at least one feeding record to move stock)
- **Priority:** P1

#### OWN-INVEN-02: Feed a batch and watch stock deduct
- **Screen:** Inventory / Worker Record
- **Preconditions:** Stock exists; batch assigned to worker
- **Steps:**
  1. **From worker:** Record a feeding (5 bags of layer mash)
  2. **From owner:** Open stock item in inventory
  3. Observe "On hand" decreases by 5 bags
  4. Check purchases tab to see the record
- **Expected:** Feeding POST /api/records deducts from inventory automatically; purchase-price applied to batch cost
- **Verify:** GET /api/inventory/items returns updated qty; batch cost-breakdown increments; variance tab shows movement
- **Priority:** P2

#### OWN-PEOPLE-01: Add an employee and issue login (PIN+phone)
- **Screen:** People
- **Preconditions:** Farm exists
- **Steps:**
  1. Tap "Add person"
  2. Enter name, phone, role (worker/manager/vet)
  3. Select assigned batches
  4. Save
  5. Open person detail, tap "Sign-in" card
  6. Enter 4-digit PIN twice
  7. Save
- **Expected:** Employee via POST /api/employees; PIN issued (not stored plaintext, salted hash only)
- **Verify:** Worker can now login with phone+PIN; GET /api/employees/[id] has phone+PIN hash set
- **Priority:** P1

#### OWN-PEOPLE-02: Edit employee role or assignments
- **Screen:** People → Person detail
- **Preconditions:** Employee exists
- **Steps:**
  1. Open person, observe role and batch assignment card
  2. Tap "Edit"
  3. Change role to manager
  4. Add/remove batch assignments
  5. Save
- **Expected:** PATCH /api/employees/[id] updates role and assignedBatchIds
- **Verify:** Worker/manager login now shows new permissions in next session; can/cannot access screens per role
- **Priority:** P2

#### OWN-TASK-01: Create a task and assign to person
- **Screen:** Tasks
- **Preconditions:** Employee and batch exist
- **Steps:**
  1. Tap "New task"
  2. Enter title (e.g. "Vaccinate dairy herd")
  3. Select type (routine/health check/repair/other)
  4. Assign to specific person
  5. Set due date/time
  6. Save
- **Expected:** Task created via POST /api/tasks; appears in Tasks list and assigned person's next-jobs queue
- **Verify:** GET /api/tasks shows isAssigned=true; worker sees it on Worker Home screen
- **Priority:** P2

#### OWN-TASK-02: Worker marks task done; owner sees in Approvals if needed
- **Screen:** Tasks / Worker Home
- **Preconditions:** Task assigned to worker; farm has approval requirement for "tasks" module (if configured)
- **Steps:**
  1. **From worker:** Open Worker Home, tap "Next job"
  2. Tap the task to open detail
  3. Fill in completion notes/photo
  4. Tap "Mark done"
  5. **From owner:** Check Approvals if workflow requires it
  6. Approve or reject
- **Expected:** Task status moves to DONE or PENDING_APPROVAL; ownership shows completion time
- **Verify:** GET /api/tasks?status=done shows the record; if approval-required, approval badge appears
- **Priority:** P2

#### OWN-ROUTINE-01: Create a daily routine
- **Screen:** Routines → Configure tab
- **Preconditions:** Farm exists
- **Steps:**
  1. Tap "New routine"
  2. Enter name (e.g. "Morning Round")
  3. Set time (6:00 AM)
  4. Add steps: "Feed layer mash" → "Collect eggs" → "Check water"
  5. Assign to batches (or leave empty for all)
  6. Save
- **Expected:** Routine created via POST /api/routines; steps stored in jsonb
- **Verify:** Routine appears in owner's Configure tab and worker's Routines list (Today tab)
- **Priority:** P2

#### OWN-ROUTINE-02: Worker completes routine today; owner sees progress
- **Screen:** Routines → Today tab / Worker Home
- **Preconditions:** Routine exists; worker assigned
- **Steps:**
  1. **From worker:** Open Routines, tap "Start Morning Round" on the live clock
  2. Tap each step, mark done
  3. **From owner:** Check Routines → Today tab
  4. Observe step completion progress (1/3, 2/3, 3/3)
- **Expected:** Routine runs tracked via GET /api/routine-runs; completion slots fetch live from /api/routines/[id]/runs?date=today
- **Verify:** Clock updates in real-time; test with multiple workers doing same routine
- **Priority:** P2

#### OWN-WEATHER-01: View weather teaser and detailed forecast
- **Screen:** Dashboard (teaser) / Weather
- **Preconditions:** Farm location set (farm.location field populated)
- **Steps:**
  1. From dashboard, observe one-line weather teaser if visible
  2. Tap to navigate to Weather screen
  3. View 7-day forecast
  4. Tap a day to see detail
- **Expected:** GET /api/weather?farmId=... returns forecast array; teaser shows today's high/low + condition
- **Verify:** Forecast updates daily; location matches farm setup
- **Priority:** P2

#### OWN-GOV-01: Configure role permissions matrix
- **Screen:** Governance
- **Preconditions:** Manager and worker roles exist in farm
- **Steps:**
  1. Tap "Edit permissions"
  2. View grid: roles (rows) × modules (columns)
  3. For manager, toggle "Payroll" from 'edit' to 'view'
  4. For worker, ensure "Physical count approval" is ON
  5. Save
- **Expected:** PUT /api/role-permissions writes one row per (role, module) pair; grid reads from DEFAULT_MATRIX if no row
- **Verify:** Manager next logs in, Finance shows view-only; worker's physical-count records queue for approval
- **Priority:** P2

#### OWN-FIN-01: View P&L and GL posting
- **Screen:** Finance
- **Preconditions:** Sales/purchases and feeding records exist; GL account structure configured
- **Steps:**
  1. Navigate to Finance
  2. Observe Sales tab with revenue by product
  3. Check Expenses tab with feed cost, etc.
  4. Tap "GL" tab (if available)
  5. Verify postings align with cost entries
- **Expected:** GET /api/dashboard/kpis?type=finance returns revenue/COGS/gross margin; GL screen reads from /api/gl-postings (if implemented)
- **Verify:** Test that feed cost maps to correct GL account per farm configuration
- **Priority:** P2

#### OWN-DIM-01: Set up GL dimensions and account requirements
- **Screen:** Settings → GL Dimensions (or Farm Config)
- **Preconditions:** Finance enabled
- **Steps:**
  1. View segments (farm, house, product) with codes
  2. Add a new segment (e.g. project code)
  3. Set account requirement: "Expense accounts MUST include a house code"
  4. Save
- **Expected:** PUT /api/dimensions updates segment config; GL posting enforces requirement on next entry
- **Verify:** Finance user cannot save posting without house code once rule is active
- **Priority:** P2

#### OWN-SETTINGS-01: Customize appearance (theme/units/language)
- **Screen:** Settings (main tab)
- **Preconditions:** Owner logged in
- **Steps:**
  1. Tap "Appearance"
  2. Toggle dark/light/auto mode
  3. Set units (metric/imperial) — affects area display
  4. Set decimal places for money
  5. Save
- **Expected:** Settings apply immediately; stored in users_settings or user_preferences table
- **Verify:** Navigate away and back; verify theme persists; area shown in correct unit
- **Priority:** P2

#### OWN-SETTINGS-02: Security & access (password, 2FA, sessions)
- **Screen:** Security Settings
- **Preconditions:** Owner logged in with password
- **Steps:**
  1. Tap "Security & access"
  2. Change password (old → new × 2)
  3. View active sessions list
  4. Tap "End session" on an old device
  5. Log out and verify old session can't login
- **Expected:** POST /api/auth/password-change; DELETE /api/sessions/[id]
- **Verify:** New password works; old session 401 on next request; 2FA toggle (if available) changes setting
- **Priority:** P2

#### OWN-REPORT-01: Generate and export activity report
- **Screen:** Reports
- **Preconditions:** Farm has 2+ weeks of records (feeding, mortality, tasks)
- **Steps:**
  1. Select date range (start/end)
  2. Select report type (Activity / Labour / Production)
  3. Tap "Generate"
  4. Observe report preview
  5. Tap "Download as CSV"
- **Expected:** GET /api/reports generates JSON; CSV export triggered via blob download
- **Verify:** CSV opens in Excel; headers match report spec; all rows included
- **Priority:** P2

#### OWN-REPORT-02: Share report with auditor
- **Screen:** Reports
- **Preconditions:** Auditor role exists in farm
- **Steps:**
  1. Generate a report (any type)
  2. Tap "Share with role" → Auditor
  3. Verify auditor receives notification
  4. **From auditor:** Open Auditor Reports screen
  5. Observe shared report in list
  6. View (read-only)
- **Expected:** Report marked shared:true in DB; auditor GET /api/auditor-reports returns it
- **Verify:** Auditor cannot edit or delete; owner can revoke share
- **Priority:** P2

#### OWN-ABOUT-01: View app version and EULA
- **Screen:** Settings → About
- **Preconditions:** Any role logged in
- **Steps:**
  1. Navigate to About
  2. Verify app version displayed
  3. Tap "Terms of use"
  4. Observe modal/link opens to T&Cs
- **Expected:** Version read from package.json or process.env.VERSION; T&Cs link external or embedded
- **Verify:** Version matches deployed build; link works
- **Priority:** P3

---

### MANAGER — Operational Control (No Finance)

#### MGR-DASH-01: Dashboard shows same KPIs as owner (manager-filtered finance)
- **Screen:** Dashboard
- **Preconditions:** Manager logged in; same farm as owner
- **Steps:**
  1. Open Home tab
  2. Check greeting, setup, KPIs (batches/tasks/approvals)
  3. Scroll to revenue hero card
  4. Verify card shows "View only" or similar (not editable)
- **Expected:** Revenue card present but click-through to Finance shows view-only state
- **Verify:** Manager cannot create transactions; owner's Finance tab shows 4th tab, manager's shows Inventory instead
- **Priority:** P1

#### MGR-TASKS-01: Manager creates and assigns task to worker
- **Screen:** Tasks
- **Preconditions:** Manager and worker roles exist
- **Steps:**
  1. Tap "New task"
  2. Enter title, type, assign to worker
  3. Set due date
  4. Save
- **Expected:** POST /api/tasks succeeds; worker sees task in queue
- **Verify:** GET /api/tasks with manager session returns created task
- **Priority:** P2

#### MGR-INVEN-01: Manager records feeding and purchase
- **Screen:** Inventory
- **Preconditions:** Stock exists; manager has inventory edit
- **Steps:**
  1. Tap "Record purchase"
  2. Enter qty and date
  3. Save
  4. Observe item on-hand updates
- **Expected:** POST /api/purchases succeeds; inventory item qty decreases if linked to a batch feeding
- **Verify:** manager's role_permissions.inventory = 'edit' in DB; owner's Finance sees the cost entry
- **Priority:** P2

#### MGR-PEOPLE-01: Manager edits employee details but not sensitive fields
- **Screen:** People
- **Preconditions:** Employees exist; manager role does NOT have user-management
- **Steps:**
  1. Open person detail
  2. Attempt to change name, role, batch assignment
  3. Attempt to see or reset PIN
  4. Verify some fields locked
- **Expected:** Name/batch-assignment editable; PIN field hidden or greyed; role edit allowed (PATCH /api/employees) per role_permissions.people or similar
- **Verify:** Actual PATCH response shows which fields were updated; PIN never returned
- **Priority:** P2

#### MGR-GOV-01: Manager approves production records submitted by workers
- **Screen:** Governance (Approvals tab)
- **Preconditions:** Worker submitted mortality record needing approval; manager has governance edit
- **Steps:**
  1. Open Approvals screen
  2. Observe pending-approval card (mortality: 2 animals)
  3. Tap to view
  4. Tap "Approve"
  5. Observe batch headcount decreases in Livestock list
- **Expected:** PATCH /api/approvals/[id]/approve stamps approvedBy:manager; batch qty updates
- **Verify:** GET /api/batches shows updated currentQty; movement appears in batch ledger
- **Priority:** P2

#### MGR-DENIED-01: Manager cannot access Finance, Payroll, or Settings
- **Screen:** Various
- **Preconditions:** Manager logged in; owner has configured role-based access
- **Steps:**
  1. From More sheet, attempt to tap Finance (if visible)
  2. Attempt deep-link navigation to /finance
  3. Attempt to tap Settings
  4. Observe refusal or redirect
- **Expected:** Finance hidden from navigation (NAV.finance only in OWNER_TABS); Settings accessible but Payroll tab within it hidden or 403
- **Verify:** Navigation.tsx getTabsForRole(manager) returns no Finance; test deep-link behavior in role-notice or 403 response
- **Priority:** P2

---

### WORKER — Field Recording (Phone-first)

#### WORKER-LOGIN-01: Phone + PIN login flow
- **Screen:** Login
- **Preconditions:** Employee has PIN set (owner issued it)
- **Steps:**
  1. From login screen, select "Worker" tab (alternate to "Email and password" tab)
  2. Enter phone number (e.g. 07XXXXXXXX or +2547XXXXXXXX)
  3. Tap numeric keypad to enter 4-digit PIN (clears field after ~600ms on error, phone retained)
  4. Tap "Sign in"
  5. Test lockout: intentionally fail 5+ times; observe "Too many failed attempts. Try again in {m:ss}" banner; button locked until timer expires
- **Expected:** POST /api/auth/login {phone, pin} returns session token; app navigates to worker-home; lockout throttle by phone (not PIN value), global cap 20 attempts tenant-wide per lib/auth.ts
- **Verify:** Session cookie set; GET /api/auth/session confirms role:worker; test PIN mismatch (generic "Invalid phone number or PIN", no enumeration)
- **Priority:** P1

#### WORKER-HOME-01: Home screen shows next task and quick-record buttons
- **Screen:** Worker Home
- **Preconditions:** Worker has one task assigned due today; batch assigned
- **Steps:**
  1. Open home
  2. Observe greeting (by hour + worker name + date) + online pill (decorative, no real logic)
  3. Observe "Your next job" hero card: task title, "Due <time>" or red "Overdue since <time>", buttons "Done" and "Record it →"
  4. Observe "Quick record" tile row: Feeding, Mortality, Physical Count, Collect, Health, Weight, Closing Stock
  5. Observe "Recent activity" section with last 5 records from GET /api/records?employeeId=, each with badge (Waiting/Rejected/Saved)
  6. Observe "N done today" section and remaining tasks list
  7. Tap a quick-record button
- **Expected:** GET /api/tasks?due=today returns first open task (client-filtered by parsing "Assigned: <worker-name>" from task notes); GET /api/records?employeeId= returns recent records with approval status; GET /api/employees/me returns batches list
- **Verify:** Task title matches; "Record it →" button guesses record type from task title (mortal/death→mortality, feed→feeding, egg/collect→production, health/vaccin/treat→health, weigh→weight, count/census→physical_count, stock/closing→stock_count); quick-record tiles show check/fill if already recorded today
- **Notes:** "Next job" uses heuristic title parsing, not a specific task.assigneeId field, so task notes must include "Assigned: {worker.name}". Task assignment shown via notes because legacy schema.
- **Priority:** P1

#### WORKER-RECORD-01: Record a feeding (with automatic stock deduction) — 3-step flow
- **Screen:** Worker Record → Feeding (3 steps: Batches → Feed → Confirm)
- **Preconditions:** Stock item exists; worker assigned to batch with active inventory; GET /api/inventory/available?batchId=... returns items
- **Steps:**
  1. From home, tap "Feeding" quick-button (in "Quick record" row) or from Record tab → Feeding
  2. Step 1 Batches: select one or more batches; "Add another feed" to add more
  3. Step 2 Feed: per batch, select feed item (shows "name — qty unit left", disabled at 0); enter qty per batch; live warning "X unit will be left after this" or "That is X unit more than the farm has" (over-issue); Step 3 disabled when no filled line or any over-issue present
  4. Step 3 Confirm: review all lines; disclaimer "Saving this takes the feed out of the store — the oldest stock is used first."; "Save Record"
  5. Toast "Feeding saved for N batch(es) — stock updated."
- **Expected:** POST /api/records {type:'feeding', batchIds, data:{feedItems}} succeeds; inventory items deducted; cost added to each batch
- **Verify:** GET /api/records shows type:feeding; GET /api/inventory/items shows qty decreased; batch cost-breakdown (GET /api/batches/[id]/cost-breakdown) increments feed line
- **Priority:** P1

#### WORKER-RECORD-02: Record mortality with photo threshold
- **Screen:** Worker Record → Mortality (4 steps: Batch → Count & Cause → Photo → Confirm)
- **Preconditions:** Batch exists; worker's mortalityPhotoThreshold is 3 (from GET /api/employees/me); or set to 1 to test photo requirement
- **Steps:**
  1. From Record screen, tap "Mortality" quick-button
  2. Select batch; tap "Next"
  3. Step 2 Count & Cause: +/− stepper to 2 animals; select cause from MORTALITY_CAUSES grid or tap "Other…" for free text
  4. Tap "Next"; observe photo step skipped (count < 3)
  5. Confirm and "Save Record"
  6. Toast "Mortality record saved." (or "Sent for approval" if approval-required)
  7. Retry with 3+ animals and verify Step 3 Photo forced: "Take Photo"/"Retake Photo" buttons; submission disabled until photoUrl attached
- **Expected:** POST /api/records succeeds with 2 animals, no photo; with 3+ photo is mandatory. Approval depends on role_permissions (worker mortality needs approval by default per DEFAULT_APPROVAL)
- **Verify:** Test with threshold=1, verify photo required for all; check batch headcount unchanged until approval (pendingApproval flag in data)
- **Priority:** P1

#### WORKER-RECORD-03: Record production (eggs/milk/grain) — collect products
- **Screen:** Worker Record → Collect (production type)
- **Preconditions:** Product (e.g. eggs) attached to batch; batch has non-empty assignedProductIds
- **Steps:**
  1. From Record tab, tap "Collect" quick-button (under "Daily work" grouping)
  2. Select batch from dropdown
  3. Step 2: per-product qty inputs appear (from GET /api/batches/[id]/products); empty → "This batch has no products set up. Ask your manager to add what it produces…"
  4. Enter quantities (e.g. 24 for eggs)
  5. Tap "Save Record"
  6. Toast "Collection recorded."
  7. **From owner:** Check batch detail → Products card; verify stock effect applied (if product.stockEffect = 'reduce-collected')
- **Expected:** POST /api/records {type:'production', batchId, data:{products:[...]}} succeeds; inventory item deducted if stockEffect set; batch revenue line increments if a sale is later recorded
- **Verify:** GET /api/records shows type:production; batch cost-breakdown shows revenue line; test with batch having no products (empty state); test with products having different stockEffects
- **Priority:** P2

#### WORKER-RECORD-04: View previously recorded records and see approval status
- **Screen:** Worker Record (list)
- **Preconditions:** Worker recorded 2+ records; one pending approval, one already approved
- **Steps:**
  1. From Record screen, view records list (by date descending)
  2. Tap a pending record
  3. Observe "Waiting for approval" badge
  4. Tap approved record
  5. Observe "Saved" or "Approved" badge
- **Expected:** GET /api/records returns list with approval status derived from data.pendingApproval/data.approvalDecision
- **Verify:** Rejected records also show badge; test filtering by status
- **Priority:** P2

#### WORKER-TASK-01: Mark assigned task as done
- **Screen:** Worker Home / Tasks
- **Preconditions:** Task assigned to worker
- **Steps:**
  1. Open home, tap "Next job"
  2. Review task details
  3. Tap "Mark as done"
  4. Enter completion notes or time
  5. Save
- **Expected:** PATCH /api/tasks/[id] sets status=DONE (or PENDING_APPROVAL if approval required); worker sees updated task in history
- **Verify:** GET /api/tasks?status=done shows the record; owner sees it in Tasks screen; task drops from next-jobs queue
- **Priority:** P2

#### WORKER-PROFILE-01: View own profile and contact info
- **Screen:** Worker Profile
- **Preconditions:** Worker logged in
- **Steps:**
  1. Tap Profile tab (4th in bottom bar)
  2. Observe name, phone, assigned batches
  3. Check "Sign out" button
- **Expected:** GET /api/employees/me returns worker's own row; no edit permission (profile is read-only)
- **Verify:** Phone matches sign-in phone; logout clears session and returns to login screen
- **Priority:** P2

#### WORKER-PAY-01: View payslips
- **Screen:** Worker Pay
- **Preconditions:** Payroll run completed and payslips generated
- **Steps:**
  1. Tap Pay tab (3rd in bottom bar)
  2. Observe list of payslips by period
  3. Tap a payslip to view detail
  4. Check amount, period, date issued
- **Expected:** GET /api/payroll/me returns array of payslips; payslip.amount visible
- **Verify:** Amount matches payroll run calculation; test with no payslips (empty state)
- **Priority:** P2

#### WORKER-NOTIFICATIONS-01: Worker receives notification of task assignment
- **Screen:** Home / Notifications
- **Preconditions:** Worker logged in; owner creates task and assigns to this worker
- **Steps:**
  1. **From owner:** Create task, assign to worker
  2. **From worker:** Observe "Your next job" card updates; no badge on bottom-nav tabs (known limitation)
  3. Tap "Your next job" card to see new task detail
- **Expected:** POST /api/tasks triggers notification; worker's home screen "Your next job" card updates; app renders no badges on worker tabs (Home, Record, Pay, Profile) even with pending tasks/approvals
- **Verify:** Home card refreshes; test that tabBadge() returns 0 for all worker-tab screens per navigation.tsx
- **Notes:** Worker tabs intentionally show no badges — counts are displayed in-screen (e.g. "Your next job", "Waiting" badge on recent records). This differs from owner/manager tab bars which show pending-approval badges.
- **Priority:** P2

---

### PLATFORM ADMIN (super_admin) — Tenant & User Management

#### ADMIN-OVERVIEW-01: Admin Dashboard shows tenant metrics
- **Screen:** Admin Overview
- **Preconditions:** Super_admin logged in
- **Steps:**
  1. Open admin-dashboard (first tab)
  2. View metric tiles: active tenants, users, revenue (if tracking)
  3. Observe pending onboarding requests count
- **Expected:** GET /api/admin/stats returns counts; admin dashboard queries across all tenants (no tenant filter in session)
- **Verify:** Counts match actual tenant/user rows; test with zero requests
- **Priority:** P2

#### ADMIN-TENANTS-01: View tenant list with status and plan
- **Screen:** Admin Farms (Tenants)
- **Preconditions:** 3+ tenants exist
- **Steps:**
  1. Open Tenants tab
  2. View list: name, plan (if plan module active), status (active/past-due/suspended)
  3. Tap a tenant row
  4. Observe detail: farm count, user count, total cost to date
  5. Tap "Suspend" button
- **Expected:** GET /api/admin/tenants returns list; PATCH /api/tenants/[id]?status=suspended updates status
- **Verify:** Suspended tenant's users see plan-gate on next login; test "Reactivate" button
- **Priority:** P2

#### ADMIN-TENANTS-02: Change tenant plan and apply discount
- **Screen:** Admin Farms detail / Admin Billing (if split)
- **Preconditions:** Tenant currently on basic plan
- **Steps:**
  1. Open tenant detail
  2. Tap "Change plan"
  3. Select new plan (e.g. professional)
  4. Review price change
  5. Apply discount code (e.g. "PROMO25" for 25% off)
  6. Confirm change
  7. Verify tenant's next invoice reflects new plan + discount
- **Expected:** POST /api/billing/subscriptions updates plan; discount applied via PUT /api/discounts/apply or similar
- **Verify:** GET /api/billing/subscription (from tenant view) shows new plan; test multiple discount stacking (if allowed)
- **Priority:** P2

#### ADMIN-USERS-01: List all users across tenants and search by email
- **Screen:** Admin Users
- **Preconditions:** 10+ users exist across multiple tenants
- **Steps:**
  1. Open Users tab
  2. Observe list: email, role, tenant, status
  3. Tap search field
  4. Enter email substring (e.g. "john")
  5. Verify filtered list
- **Expected:** GET /api/admin/users?search=john returns matching users; capability:users.manage required
- **Verify:** Search is case-insensitive; results include email and tenant name; test with no matches
- **Priority:** P2

#### ADMIN-USERS-02: Reset user password and see one-time link
- **Screen:** Admin Users detail
- **Preconditions:** User exists
- **Steps:**
  1. Open user detail
  2. Tap "Send password reset"
  3. Observe modal with reset link (or "link sent" message)
  4. Copy link and test in incognito window
  5. Set new password
  6. Verify user can login with new password
- **Expected:** POST /api/admin/users/[id]/reset-password generates token; email sent (or link displayed); token expires after first use or 24h
- **Verify:** Old password no longer works; test link expiry
- **Priority:** P2

#### ADMIN-IMPERSONATE-01: Impersonate a tenant user to debug
- **Screen:** Admin Users detail
- **Preconditions:** User exists; admin has impersonate capability
- **Steps:**
  1. Open user detail
  2. Tap "Impersonate"
  3. Observe banner at top saying "Impersonating [user name]" with "Exit" button
  4. Navigate app as that user
  5. Tap "Exit" in banner
  6. Verify back to admin view
- **Expected:** POST /api/admin/users/[id]/impersonate sets session.impersonatedBy; ImpersonationBanner (app/page.tsx) renders at top
- **Verify:** Impersonated session cannot access admin routes; audit log tracks impersonation start/end
- **Priority:** P2

#### ADMIN-TICKETS-01: View support tickets from customers
- **Screen:** Admin Tickets
- **Preconditions:** Customer opened support ticket
- **Steps:**
  1. Open Tickets tab
  2. View list: customer name, subject, status (open/in-progress/resolved), date created
  3. Tap a ticket
  4. Review messages and internal notes
  5. Tap "Add note" to add internal staff-only note
  6. Tap "Reply" to send customer message
  7. Change status to "Resolved"
- **Expected:** GET /api/support/tickets?staff=true returns customer + internal notes; POST /api/support/tickets/[id]/messages creates reply; PATCH /api/support/tickets/[id] updates status
- **Verify:** Customer sees only own messages, not internal notes; notifications sent on status change
- **Priority:** P2

#### ADMIN-TICKETS-02: Assign ticket to staff member
- **Screen:** Admin Tickets detail
- **Preconditions:** Ticket open; multiple staff members exist
- **Steps:**
  1. Open ticket
  2. Tap "Assign to" dropdown
  3. Select staff member
  4. Save
  5. Verify staff member sees ticket in their queue
- **Expected:** PATCH /api/support/tickets/[id] updates assignedStaffId; notification sent to staff
- **Verify:** GET /api/admin/tickets?assignedTo=me returns only assigned tickets for staff
- **Priority:** P2

#### ADMIN-STAFF-01: View platform staff with capabilities
- **Screen:** Admin Settings → Staff
- **Preconditions:** 3+ staff members onboarded (including founder)
- **Steps:**
  1. Open Settings tab
  2. Tap "Staff" (or navigate to admin-settings)
  3. View list: name, email, capabilities (support.handle, tenants.manage, etc.)
  4. Tap a staff member
  5. Observe capability checkboxes
- **Expected:** GET /api/admin/staff requires capability:staff.manage; returns list with implicit full-capabilities founder account
- **Verify:** Founder (no platform_staff row) shows hasRow:false, capabilities:["all"]; new staff shows explicit subset
- **Priority:** P2

#### ADMIN-STAFF-02: Create new staff member and set capabilities
- **Screen:** Admin Settings → Staff
- **Preconditions:** Admin has staff.manage capability
- **Steps:**
  1. Tap "Add staff member"
  2. Enter name, email, title
  3. Select capabilities: support.handle, tenants.manage, staff.manage
  4. Save
  5. Observe modal shows temp password (one-time reveal)
  6. Copy password and test login
- **Expected:** POST /api/admin/staff creates super_admin user + platform_staff row; returns tempPassword (shown once, never logged)
- **Verify:** New user can login with email + temp password; must change on first login; test capability enforcement (can/cannot access routes based on capabilities)
- **Priority:** P2

#### ADMIN-STAFF-03: Remove staff member or revoke capabilities
- **Screen:** Admin Settings → Staff detail
- **Preconditions:** Staff member exists; not the last full-capability admin
- **Steps:**
  1. Open staff detail
  2. Uncheck "support.handle" capability
  3. Save
  4. Verify staff member can no longer access support routes
  5. Tap "Remove" to fully deactivate
  6. Verify user cannot login (status=SUSPENDED)
- **Expected:** PATCH updates platform_staff row; DELETE sets active:false and users.status=SUSPENDED; session deleted immediately
- **Verify:** Test self-removal protection (403); test last-full-admin protection (403)
- **Priority:** P2

#### ADMIN-ONBOARDING-01: Review pending onboarding requests
- **Screen:** Admin Onboarding Requests
- **Preconditions:** Pending tenant approval request exists
- **Steps:**
  1. Open Onboarding tab
  2. View request: farm name, contact, area, intended use
  3. Tap to review detail
  4. Tap "Approve"
  5. Verify farm is created and user can login
- **Expected:** GET /api/onboard-requests returns list; POST approve creates tenant + initial user + sends set-password email
- **Verify:** New tenant appears in Tenants list; user receives onboarding guide email
- **Priority:** P2

#### ADMIN-ONBOARDING-02: Reject request with reason
- **Screen:** Admin Onboarding Requests detail
- **Preconditions:** Pending request exists
- **Steps:**
  1. Open request
  2. Tap "Reject"
  3. Enter reason (e.g. "Insufficient farm details")
  4. Save
- **Expected:** PATCH /api/onboard-requests/[id] sets status=rejected; email sent to requester
- **Verify:** Request disappears from pending inbox
- **Priority:** P2

#### ADMIN-BILLING-01: View payment review queue
- **Screen:** Admin Billing
- **Preconditions:** Tenants submitted payment confirmations
- **Steps:**
  1. Open Billing tab
  2. View "Pending payments" list: tenant, amount, method (M-Pesa/manual), date submitted
  3. Tap a payment
  4. Review payment details and reference number
  5. Tap "Confirm payment" (after verifying in bank/mobile-money system)
  6. Verify tenant's subscription status updates to active
- **Expected:** GET /api/billing/payments?status=pending; PATCH /api/billing/payments/[id]?status=confirmed updates subscription status
- **Verify:** Test with rejected payment (status=rejected); tenant stays past-due
- **Priority:** P2

#### ADMIN-BILLING-02: View all subscription history and filter by plan
- **Screen:** Admin Billing
- **Preconditions:** Subscriptions exist with different plans
- **Steps:**
  1. Open Subscriptions tab
  2. Filter by plan (e.g. "Professional")
  3. Observe list: tenant, plan, status, period, cost
  4. Sort by status or date
- **Expected:** GET /api/billing/subscriptions with optional filters; returns all isCurrent=true rows
- **Verify:** Historical subscriptions (isCurrent=false) not shown; test with no filters (shows all)
- **Priority:** P2

---

## 3. Cross-Role Workflows

### WORKFLOW-1: Worker Records → Owner Approval → Finance Impact

| Step | Role | Action | Expected State |
|------|------|--------|-----------------|
| 1 | Worker | Record 3 mortality on dairy batch (threshold requires approval) | Record created, status pending; batch.currentQty unchanged |
| 2 | Worker | Submit record (POST /api/records) | mortality record in DB with pendingApproval:true |
| 3 | Owner | Open Approvals screen | New pending card appears; badge count +1 |
| 4 | Owner | Tap approval, review death record | Detail pane shows: 3 dead, cause, time, worker name |
| 5 | Owner | Tap "Approve" | PATCH /api/approvals/[id]/approve; batch.currentQty -= 3; approval moves to approved list |
| 6 | Owner | Navigate to Livestock list | Batch headcount reflects -3 |
| 7 | Owner | Open batch detail → Cost tab | Mortality cost row shows 3 × unit-replacement-cost (if configured) |
| 8 | Finance | Check GL posting (if GL integrated) | Loss-on-mortality account debited, livestock asset credited |

### WORKFLOW-2: Owner Creates Task → Worker Sees & Completes → Approval/Finance

| Step | Role | Action | Expected State |
|------|------|--------|-----------------|
| 1 | Owner | Create task: "Treat dairy herd for lice", assign to worker, due today 2 PM | POST /api/tasks; notification sent |
| 2 | Worker | Log in next time | Task appears on Home screen "Next job" card |
| 3 | Worker | Tap "Next job", fill notes "Treated 20 head with dip", mark done | PATCH /api/tasks/[id]; status=DONE (or PENDING_APPROVAL if configured) |
| 4 | Owner (if approval required) | Open Approvals | Task approval shows; tap to review notes |
| 5 | Owner | Approve | Task status confirmed; batch cost increments (if task has cost attached) |
| 6 | Owner | Navigate to Tasks | Task moves to "Completed today" or archive |

### WORKFLOW-3: New Tenant Signup → Plan Selection → Payment → Admin Confirms

| Step | Role | Action | Expected State |
|------|------|--------|-----------------|
| 1 | Prospect | Fill onboarding form (farm name, email, area, use case) | POST /api/onboard-requests; status=pending |
| 2 | Admin | Review request in Admin Onboarding | Request appears in inbox |
| 3 | Admin | Tap "Approve" | POST /api/tenants; user created; set-password email sent with onboarding guide |
| 4 | Owner (new tenant) | Click email link, set password | User logged in; app shows plan-gate (needsPlan:true) |
| 5 | Owner | Tap plan card on plan-select screen | SELECT plan (e.g. Professional: KSh 5,000/month) |
| 6 | Owner | Review plan features, tap "Start free trial" | POST /api/billing/subscriptions; subscription.status=trialing; trial ends in 14 days |
| 7 | Owner | Fills farm setup: units → batch → products → stock → employees | Setup progresses; trial dashboard visible |
| 8 | Owner (pre-trial-end) | Open Plan & billing screen | Subscription shows trial end date; "Confirm payment" button visible |
| 9 | Owner | Tap "Confirm payment", enters M-Pesa/manual payment details | POST /api/billing/payments; payment.status=pending |
| 10 | Admin | Review Billing → Pending payments | Payment appears with reference |
| 11 | Admin | Verify payment in M-Pesa/bank, tap "Confirm" | PATCH /api/billing/payments to confirmed; subscription.status=active; next period set |
| 12 | Owner | Next app load | Plan-gate cleared; app fully functional; invoice emailed |

### WORKFLOW-4: Support Ticket: Customer Reports Issue → Admin Triages → Resolution

| Step | Role | Action | Expected State |
|------|------|--------|-----------------|
| 1 | Owner | From Help & Support, tap "Send message" | Chat interface opens (if chatbot enabled, or list of open tickets) |
| 2 | Owner | Type "My batches are not showing up", tap send | POST /api/support/tickets or appends to /api/support/messages |
| 3 | Owner | Notification badge appears | Ticket ID generated; owner sees "Ticket #1234" |
| 4 | Admin | Open Admin Tickets | New ticket "My batches are not showing up" in open queue |
| 5 | Admin | Tap ticket, add internal note: "Check batches table join" | POST /api/support/tickets/[id]/internal-note (staff-only) |
| 6 | Admin | Assign to support staff | PATCH /api/support/tickets/[id]; assignedStaffId set; staff receives notification |
| 7 | Support | Investigate; reply "Can you confirm your farm count?" | POST /api/support/tickets/[id]/messages; customer sees reply immediately |
| 8 | Owner | See notification, tap reply | Opens chat with support message |
| 9 | Owner | Reply "I have 3 farms, only 1 shows" | POST /api/support/messages |
| 10 | Admin | Review conversation, identify issue: tenant_id mismatch in filters | Adds internal note with fix |
| 11 | Admin | Mark ticket "Resolved" | PATCH /api/support/tickets/[id]; status=resolved; survey sent to owner (optional) |
| 12 | Owner | Next login | Ticket appears in Support screen as "Resolved"; can reopen if needed |

### WORKFLOW-5: Admin Suspends Tenant → Users See Plan-Gate

| Step | Role | Action | Expected State |
|------|------|--------|-----------------|
| 1 | Admin | Open Tenants, find tenant "Acme Farms" | List shows status:active |
| 2 | Admin | Tap tenant detail, tap "Suspend" (reason: late payment) | PATCH /api/tenants/[id]; status=suspended |
| 3 | Any user in Acme (Owner/Manager/Worker) | Next app load or refresh | GET /api/auth/session returns subscription.needsPlan=true OR status=suspended |
| 4 | Any user | App renders plan-gate screen (owner sees PlanSelect; others see "Ask owner" message) | Navigation fully blocked until owner resolves |
| 5 | Owner | Navigate to Plan & billing | Observes "Account suspended" message; billing history visible but cannot modify |
| 6 | Owner | Contacts support (via Help & Support) | Ticket created for admin review |
| 7 | Admin | Receives payment/resolves issue; taps "Reactivate" | PATCH /api/tenants; status=active; needsPlan=false |
| 8 | Owner | Next refresh | Plan-gate cleared; app fully accessible |

### WORKFLOW-6: Manager Edits Employee + Worker Logs in With New Permissions

| Step | Role | Action | Expected State |
|------|------|--------|-----------------|
| 1 | Manager | Open People, tap worker "Jane" | Detail pane opens |
| 2 | Manager | Tap "Edit", change role from worker → manager | PATCH /api/employees/[id]; role=manager |
| 3 | Manager | Save | Permission change applied in DB |
| 4 | Worker (Jane, currently logged in) | Continues using app | Still sees worker tabs (change takes effect on re-login) |
| 5 | Worker (Jane) | Tap "Sign out" | Session cleared |
| 6 | Worker (Jane) | Log in again with phone+PIN | GET /api/auth/session confirms role:manager; app navigates to manager dashboard |
| 7 | New Manager (Jane) | Observe bottom tabs | Now sees Home · Tasks · Units · Inventory · More (manager bar) instead of worker's bar |
| 8 | New Manager | Navigate to Inventory | Can now edit inventory (record purchases), whereas worker could only view |

---

## 4. Negative & Permission Tests

### ROLE-DENY-01: Worker cannot access Finance module
- **Action:** Worker attempts deep-link to `/finance` or taps Finance if visible
- **Expected:** Navigation to `role-notice` screen (explicit deny message); worker-role-tab-set excludes Finance
- **Verify:** GET /api/finance/* returns 403 (manager/worker cannot edit; worker cannot view)
- **Priority:** P1

### ROLE-DENY-02: Worker cannot see or edit another worker's records
- **Action:** Worker A guesses/inspects Worker B's record ID in URL; tries to PATCH it
- **Expected:** PATCH /api/records/[id] returns 403 (ownership check in lib/records.ts or similar)
- **Verify:** Only submitter or owner can read/edit a record; test cross-tenant isolation (403 if wrong tenantId)
- **Priority:** P1

### ROLE-DENY-03: Manager cannot access Payroll or user-sensitive fields
- **Action:** Manager attempts to view/edit someone's payroll or open Security Settings
- **Expected:** Payroll screen hidden from navigation; Security Settings present but payroll tab/password sections greyed/404
- **Verify:** GET /api/payroll returns 403 for manager; POST /api/auth/password-change checks role (only owner/self can change)
- **Priority:** P1

### ROLE-DENY-04: Auditor cannot create or edit any record
- **Action:** Auditor attempts to POST /api/records (any type); PATCH /api/batches; POST /api/tasks
- **Expected:** 403 Forbidden on all POST/PATCH; auditor-read-only confirmed
- **Verify:** Auditor-reports screen is read-only; detail screens have no edit button; test auditor role on every write endpoint
- **Priority:** P1

### ROLE-DENY-05: Worker cannot change own PIN or see payroll
- **Action:** Worker taps Profile, attempts to change PIN; taps Pay tab
- **Expected:** PIN field locked; Pay tab exists (view-only payslips); worker cannot PATCH /api/employees/me to change PIN
- **Verify:** PIN is owner-managed; worker sees payslips but cannot edit
- **Priority:** P2

### ROLE-DENY-06: Cross-tenant isolation: User A cannot access Tenant B's data
- **Action:** User logged into Tenant A; attempts GET /api/batches?tenantId=B or guesses batch-id from Tenant B
- **Expected:** 401 (no cross-tenant tenantId parameter for non-super_admin) OR 403 if parameter ignored; GET /api/batches/[batch-from-B] returns 404 (batch not found in user's tenant)
- **Verify:** Every endpoint checks session.tenantId; super_admin requires explicit explicitTenantId opt-in for cross-tenant reads
- **Priority:** P1

### ROLE-DENY-07: Super_admin cross-tenant access requires explicit opt-in
- **Action:** Super_admin loads `/api/batches` without tenantId query param or body field
- **Expected:** 400 tenantId required (super_admin session.tenantId is null, so explicitTenantId mandatory)
- **Verify:** Routes using requireTenantSession() enforce this; test with super_admin trying to GET /api/farms (which has tenantId handling)
- **Priority:** P2

### ROLE-DENY-08: Staff-only internal notes hidden from customers
- **Action:** Customer opens support ticket; attempts to read internal-note field via API
- **Expected:** Internal notes absent from GET /api/support/tickets/[id] for non-staff; staff sees them
- **Verify:** Response schema differs by role; test with both customer and staff sessions
- **Priority:** P2

### ROLE-DENY-09: Impersonation logs audit trail and has time limit
- **Action:** Admin impersonates a user for 2 hours; impersonated user tries to access admin routes; session expires
- **Expected:** Impersonated session cannot POST /api/admin/*; session times out after configurable TTL (default 2h)
- **Verify:** GET /api/admin/impersonation-log shows audit trail with timestamp; test session auto-logout
- **Priority:** P2

### ROLE-DENY-10: Manager cannot override approval requirement
- **Action:** Manager has governance edit (can approve); attempts to POST a record with bypassApproval=true
- **Expected:** 403 (only owner can bypass; manager approval decision is final, not an override)
- **Verify:** POST /api/records ignores bypassApproval for non-owner; manager can approve but not skip
- **Priority:** P2

### ROLE-DENY-11: Worker cannot record health/weight/closing-stock (permission mismatch)
- **Action:** Worker fills and submits Health & Vaccine, Weight Sample, or Closing Stock record
- **Expected (current):** Form submits but POST /api/records returns 403 "Your role does not have edit access to health" (or batches/inventory for the others)
- **Expected (after fix):** UI blocks form submission upfront with a message (fix in progress per separate agent)
- **Verify:** Test all three record types; confirm error occurs server-side for now; note fix in test report
- **Notes:** Root cause: worker.tsx has no canEdit checks; server enforces. health→health (hidden), weight→batches (view), stock_count→inventory (view) per DEFAULT_MATRIX.worker. This is a real permission, not a bug — the form should prevent submission before hitting 403.
- **Priority:** P2 (fix in progress)

### PERMISSION-01: First manager/worker assignment is permission-gated
- **Action:** Manager is created; role_permissions table has no row for (tenant, manager, batches)
- **Expected:** Manager can edit batches (default matrix grants this); if owner changes default to 'view', manager gets 403 on PATCH /api/batches/[id]
- **Verify:** getRoleAccess returns DEFAULT_MATRIX['manager']['batches'] = 'edit' if no row; PATCH uses canEdit() guard
- **Priority:** P2

---

## 5. Mobile (390px viewport) Checks

### MOBILE-NAV-01: Bottom bar shows correct tabs for role
- **Screen:** All screens (bottom bar persistent)
- **Steps:**
  1. Open app at 390px width
  2. Observe 5-item bottom bar: Home, Tasks, Units, [Finance/Inventory], More
  3. For owner: Finance shows; for manager: Inventory instead
  4. For worker: Home, Record, Pay, Profile (4 tabs, no 5th)
  5. Tap "More" → opens bottom sheet (not navigate)
  6. Verify sheet contains Advisor, Approvals, Routines, Weather, GL Dimensions, Reports, Settings (role-filtered)
- **Expected:** Bottom bar responsive; More sheet full-height; no horizontal scroll
- **Verify:** Touch targets 44px minimum; test on actual device or DevTools emulation
- **Priority:** P2

### MOBILE-SHEET-01: Units tab opens bottom sheet instead of sidebar
- **Screen:** Crops (Units) at 390px
- **Steps:**
  1. Tap Units tab (or "More" → Farm → Units)
  2. Observe bottom sheet: title "Farm", items list (Houses, Livestock, Crops, Products, Sites, Stages, Inventory, People)
  3. Tap "Houses & fields" → navigate to Crops?tab=units
  4. Sheet closes on navigation
- **Expected:** Sheet responsive; full-height; items touch-friendly (44px+)
- **Verify:** Test with text scaling (120%); ensure readable without zoom
- **Priority:** P2

### MOBILE-RECORD-01: Worker record flow works with thumb-one-handed
- **Screen:** Worker Record at 390px
- **Steps:**
  1. Tap Record tab
  2. Tap Feeding quick-button (lower button row)
  3. Select batch (dropdown, thumb-reachable)
  4. Tap feed item selector (full-width button)
  5. Enter quantity (44px input)
  6. Scroll and tap Save (bottom button, large target)
- **Expected:** All controls 44px+ tall; no pinch-zoom required; Save button thumb-reachable at bottom
- **Verify:** Test on 390px emulator; actual iPhone SE (375px) acceptable if no scroll
- **Priority:** P2

### MOBILE-DETAIL-01: Batch detail is bottom sheet, not full-screen navigation
- **Screen:** Crops → Livestock tab at 390px
- **Steps:**
  1. Tap a batch in list
  2. Observe Inspector sheet slides up from bottom (not full-screen push)
  3. Sheet shows batch detail content (headcount, cost, products)
  4. Scroll within sheet to see all tabs (if present)
  5. Tap close (X) or swipe down to dismiss
- **Expected:** Sheet height ~80% viewport; dismissible; iOS safe-area padding respected
- **Verify:** Safe-area CSS applied (padding: env(safe-area-inset-*)); test on notched device
- **Priority:** P2

### MOBILE-SAFE-AREA-01: Top & bottom bars respect safe-area
- **Screen:** Any screen at 390px on notched device
- **Steps:**
  1. Test on iPhone 14 Pro or emulator with notch
  2. Verify top nav/header inset below notch (padding-top: env(safe-area-inset-top))
  3. Verify bottom bar above home indicator (padding-bottom: env(safe-area-inset-bottom))
  4. No content hidden by notch or home gesture area
- **Expected:** All text/buttons readable; no overlap with system UI
- **Verify:** Test on actual device if available; CSS includes safe-area declarations
- **Priority:** P2

### MOBILE-SCROLL-01: No horizontal scroll on any screen
- **Screen:** All screens at 390px
- **Steps:**
  1. Load each screen (dashboard, crops, people, etc.)
  2. Attempt horizontal swipe
  3. Verify content fits viewport width
- **Expected:** No scrollbar-x visible; content reflows, not truncated
- **Verify:** Browser DevTools; test tables (should stack or scroll v-only)
- **Priority:** P2

### MOBILE-INPUT-01: Number inputs and date pickers work touch-friendly
- **Screen:** Worker Record, People add screen
- **Steps:**
  1. Tap number input (e.g. headcount)
  2. Observe mobile number keyboard (iOS: numeric; Android: numeric)
  3. Tap date field
  4. Observe date picker (native or custom, touch-friendly)
  5. Enter value
- **Expected:** Correct input type attributes (number, date); touch keyboard matches field
- **Verify:** Test on actual mobile; no tiny spinners or hard-to-tap controls
- **Priority:** P2

---

## 6. Known Gaps (Not Bugs, Won't Fix Pre-Release)

These are confirmed limitations; real bugs should NOT be filed against them:

### GAP-1: API-level plan enforcement not implemented
- Plan limits (maxFarms, maxUsers, maxUnits) are tracked in the plans table but not enforced at POST time.
- **Workaround:** Admin manually suspends tenant or grants exception.
- **Status:** Deferred to post-launch hardening phase.

### GAP-2: Manual payment confirmation only
- No real payment gateway integration (M-Pesa/card/MTN MoMo); payments are "submit claim, admin reviews and confirms manually".
- **Workaround:** Admin confirms in Billing screen after verifying bank/mobile-money.
- **Status:** Real provider slots in after launch; payments schema ready.

### GAP-3: Feed-mix backend absent
- Inventory screen mentions "Mixes" tab in old code comment, but no backend to store mix recipes.
- **Workaround:** None yet; owner must track mix composition outside the app.
- **Status:** Deferred; tab intentionally not rendered (honest empty state).

### GAP-4: Labour cost not trackable
- Reports show "Labour: not tracked" honestly instead of faking hours.
- No payroll-to-task linkage today.
- **Workaround:** Manual timesheet review outside app.
- **Status:** Deferred; payroll/hours integration planned.

### GAP-5: Old styling on some Finance screens
- Finance tab body (Sales/Expenses/GL/Payroll detail tabs) still uses old ui styling, not new ui-kit.
- Register wizard steps 2–3, Getting Started page, Units add/edit sheets, Crop schedule wizard: old styling remains.
- **Workaround:** Functionality works; cosmetics lag.
- **Status:** Foundation package owns Finance restyling; not in scope for mobile/reference port.

### GAP-6: Vet and Auditor screens out of scope for reference port
- Vet Herd detail, Auditor Reports detail: design-fresh, not ported from reference (reference has no equivalent).
- **Status:** Cosmetic pass only; functionality complete.

### GAP-7: Subscription gate does not preview features
- Plan Select shows features text but no trial/downgrade flow yet.
- **Status:** MVP; feature-preview UI deferred.

### GAP-8: Physical count approval banner always shown, ignores role_permissions
- Physical Count form shows hardcoded banner "This count does not change the system count. Your owner will review and approve any adjustments." regardless of whether approval is actually required (i.e. even if role_permissions.physical-count.approvalRequired=false).
- **Workaround:** Banner is informational; ignore it if role has approval off.
- **Status:** Messaging bug in worker.tsx; low severity (approval enforced correctly server-side).

---

## 7. Reporting Template

Use this format when filing a test result:

```
### TEST-RESULT: [ID] [ROLE] [SCREEN]

**Preconditions met:** (yes/no) [describe state]

**Steps taken:** (numbered, exact)
1. ...
2. ...

**Expected:** (from test case)
...

**Actual:** (what happened)
...

**Match:** (yes/no)

**Severity:** (blocker / major / minor / cosmetic)

**Screenshot/Video:** [filename or link]

**Notes:** (regression? only on mobile? timing-dependent?)

**Next steps:** (retest after fix? known gap?)
```

---

## 8. Test Execution Summary

**Roles to test:**
- Owner (4 accounts: different farms, different setups)
- Manager (1 account: same farm as owner)
- Worker (2 accounts: assigned to different batches)
- Vet (1 account: read health, edit mortality)
- Auditor (1 account: read-only reports)
- Super_admin (1 account: test tenant management)

**Minimum coverage order:**
1. **Setup sequence (P1):** Create farm → units → batch → products → stock → employees → routines → approvals
2. **Per-role screens (P1):** All owner screens, manager tasks+inventory, worker home+record+pay, admin dashboard+tenants+tickets
3. **Cross-role workflows (P1–P2):** Approval flow, plan selection, support ticket
4. **Mobile (P2):** Bottom bar, sheet navigation, safe-area, no horizontal scroll
5. **Negative tests (P1):** Worker cannot edit finance, cross-tenant isolation, manager cannot approve own records
6. **Plan enforcement (P2–P3):** Suspension, payment flow, role change & re-login

**Time estimate:** 8–12 hours for comprehensive coverage (2–3 per day on non-concurrent roles)

---

## 9. Known Issues to Avoid Reporting

- Old styling on Finance tab bodies (intentional, out of scope)
- Feed-mix UI missing (intentional, no backend)
- Labour cost shows "not tracked" (intentional, accurate)
- Vet/Auditor read-only cosmetics (acceptable, fresh design; no reference)
- Subscription gate does not preview features (MVP limitation)

Test with the understanding that **real data wins over fake UI**. If a number is unknown, the app shows empty state or "not tracked" rather than inventing a value. This is intentional and good.
