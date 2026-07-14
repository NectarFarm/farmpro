// Guided front-end acceptance test (UAT) — pure state machine, no DB/IO, so the
// rules (a failure needs an explanation, you can only submit once every step is
// answered, restart resets cleanly) are unit-testable to the boundary.
//
// The farmer works ONE step at a time. Each step is checked off as "Works" or
// "Failed". A failed step must carry a note before moving on. When every step is
// answered the run can be submitted, producing a report for the admin.

export type StepStatus = 'pending' | 'pass' | 'fail';

// `checks` are the SPECIFIC sub-features to tick off for this main feature — so a
// tester covers everything, not just the headline. The step can only be marked "works"
// once every check is ticked.
export interface TestStepDef { id: string; area: string; title: string; instruction: string; checks?: string[] }
export interface TestStep extends TestStepDef { status: StepStatus; note?: string; photoIds?: string[] }

// Ordered checklist covering the main front-end flows. Each instruction spells out
// exactly WHAT to look at, so a non-technical tester knows what "working" means.
export const TEST_STEPS: TestStepDef[] = [
  { id: 'login', area: 'Sign in', title: 'Sign in & role-based landing',
    instruction: 'Sign in and confirm each role lands in the right place; tick every check below.',
    checks: [
      'Owner/manager email + password is accepted',
      'Worker phone + PIN is accepted',
      'Each role lands on its own home (owner dashboard / worker app / auditor read-only view)',
      'Wrong details show a clear "login failed" message — never a blank screen or a hanging spinner',
      'The Show/Hide toggle reveals and hides the password/PIN',
      'The farm name/logo shows in the header and the browser tab',
      'Sign out returns to the login screen and the back button can’t get back in',
    ] },
  { id: 'dashboard', area: 'Dashboard', title: 'Dashboard KPIs & period filter',
    instruction: 'Check the owner dashboard shows real numbers everywhere and the revenue period filter works.',
    checks: [
      'Active Batches, Total Animals, Mortality %, Avg FCR each show a real number',
      'Gross Margin and Revenue show a KSh figure',
      'Task Completion and Pending Alerts show',
      'The production chart draws',
      'Revenue period toggle Month / Quarter / Year / All changes the amount (All-time is largest)',
      'Nothing reads NaN, undefined, a bare "KSh", or a blank card',
    ] },
  { id: 'unit', area: 'Farm', title: 'Add a production unit',
    instruction: 'Farm → "+ Add Unit" and confirm it saves and shows correctly.',
    checks: ['Can set name, type (cage/pen/pond/plot) and capacity', 'Saves without an error', 'Appears with the correct species icon and occupancy (e.g. 0 / capacity)', 'A blank or zero capacity is rejected with a clear message'] },
  { id: 'batch', area: 'Farm', title: 'Add a batch & its products',
    instruction: 'Add a batch to a unit and check its auto-created products.',
    checks: [
      'Can set species/breed, quantity, acquired date, age and purchase cost',
      'Saves, and the unit’s occupancy goes UP by the quantity',
      'Auto-created products match the species (layer = Eggs + Manure + Spent hen; broiler = live bird; pig = pork/piglets; fish; maize = grain)',
      'A pig batch never shows "eggs"',
      'Each product has a sale unit and an editable price; "+ Add Product" works',
      'Ticking "this product IS the animal" marks stock sold by head',
    ] },
  { id: 'purchase', area: 'Inventory', title: 'Record a purchase & mix feed',
    instruction: 'Record stock in, then mix a feed, and confirm stock moves.',
    checks: [
      'Record Purchase saves; the item shows under Stock with the new quantity in KSh (not $)',
      'It appears under "Recent Stock"',
      'Buying the same item again ADDS to the running quantity',
      'Feed Formulation produces a finished feed whose cost is the rolled-up ingredient cost',
      'Mixing draws the ingredients DOWN from stock',
    ] },
  { id: 'worker', area: 'People', title: 'Add a worker — login, pay & batches',
    instruction: 'Add staff and confirm they get a real login and correct pay/assignment.',
    checks: [
      'Add employee with name, phone and role',
      'A worker gets a 4–6 digit PIN (a login is created); a manager/vet gets email + password',
      'Salary and pay day save; the "Works on" batch assignment persists',
      'A worker profile can be assigned',
      'A pay day outside 1–31 is stored blank; a duplicate phone is rejected',
      'Reset PIN / password works from the Manage panel',
    ] },
  { id: 'tasks', area: 'Tasks', title: 'Assign tasks to staff',
    instruction: 'Owner Tasks → assign a task and confirm the worker gets it.',
    checks: ['Assign a task to a worker (title, type, optional batch, due date)', 'The task appears in the list with the assignee', 'The assigned worker sees it in their app when they sign in', 'A worker only sees their OWN tasks'] },
  { id: 'profile', area: 'Worker config', title: 'Control what a worker sees (server-side)',
    instruction: 'Set field permissions and prove hidden money never reaches the worker.',
    checks: [
      'Set a money field to Hidden and another to Read-only, then Save — it saves',
      'Signed in as a worker on that profile, the hidden field is genuinely GONE (not greyed out)',
      'The read-only field cannot be edited',
    ] },
  { id: 'record', area: 'Worker app', title: 'Worker records in the field (offline, stock-aware)',
    instruction: 'As a worker, record the daily entries and confirm stock/warnings behave.',
    checks: [
      'Morning Round submits (water, feed used, eggs/production, abnormal)',
      'Feed USED deducts from feed stock and can’t exceed what’s in stock',
      'Mortality WITH a photo submits and the live count drops',
      'Health/vaccine: the dose can’t exceed the lot and medicine stock drops',
      'Weight Sampling submits',
      'The worker can record collected products (eggs/manure) but NOT the live animal',
      'Offline: entries save on the phone and the sync indicator clears when online',
      '"Done today" badges show and a repeat is warned (feeding/round not done twice by accident)',
      'Every entry later appears on the owner side against the correct batch',
    ] },
  { id: 'headcount', area: 'Worker app', title: 'Head count → owner reviews & applies',
    instruction: 'A worker counts the animals; the owner decides whether to correct the system.',
    checks: [
      'A worker records a Physical/Head Count with a reason for any variance',
      'The system count does NOT change automatically',
      'A "Stock variance" alert reaches the owner (critical when animals are missing)',
      'On the batch page the owner sees the pending count and taps Apply → the live count + unit occupancy update, with a history/audit entry',
      'Dismiss keeps the existing count',
    ] },
  { id: 'sale', area: 'Finance', title: 'Record a sale (stock-aware)',
    instruction: 'Sell live animals and collected products and confirm the caps.',
    checks: [
      'Selling a per-head animal BLOCKS more than are alive; the live count drops by exactly what sold',
      'A weight-sold animal (fish/pork) is capped by biomass (head × avg weight), never asked to "collect"',
      'Selling a collected product (eggs) draws from what was COLLECTED, not the live birds',
      'Each sale lists quantity × unit price = the correct total in KSh',
    ] },
  { id: 'budget', area: 'Finance', title: 'Monthly budget adds up',
    instruction: 'Check the "Budget · this month" panel.',
    checks: [
      'Revenue in includes sales AND staff fines (shows "incl. … staff fines")',
      'Expenses out splits into stock + salaries (actual net once payroll is run, else the estimate)',
      'Net = Revenue in − Expenses out',
      'The pay-day reminder appears a few days before a worker’s pay day',
    ] },
  { id: 'payroll', area: 'Payroll', title: 'Run payroll, advances, fines & lock',
    instruction: 'Run a month and confirm the money rules hold.',
    checks: [
      'net = salary − advances − fines + bonuses per row; summary totals Gross / Net / Fines / Paid',
      '"Pay" locks the month (🔒 Paid); a paid month rejects a new advance/fine',
      'Changing a salary does NOT change a paid month, but a new month uses the new salary',
      '"Payslip" (month) and "Year" statement download with matching totals',
      'An advance bigger than the salary leaves the worker owing (net ≤ 0), not a wrong figure',
    ] },
  { id: 'mypay', area: 'Worker app', title: 'Worker sees their own pay',
    instruction: 'Sign in as a worker and open "My Pay".',
    checks: [
      'Paid-to-date total, months paid, and the month payments started are shown',
      'Any outstanding advance is shown',
      'The payslip list shows each month’s gross/advances/fines/net with a paid/pending tag',
      'The figures match the owner’s Payroll page; a worker sees only their OWN pay',
    ] },
  { id: 'alerts', area: 'Alerts', title: 'Alerts fire on real data (owner-only)',
    instruction: 'Set rules, run checks, and confirm the event alerts.',
    checks: [
      'Rules (mortality %, low feed, overdue tasks, water quality) save and "Run checks now" raises alerts only when a threshold is crossed',
      'Each alert names the batch and reason; acknowledging clears it and drops the dashboard count',
      'Event alerts appear: stock variance, weight loss, abnormal observation, and "ready to move stage"',
      'Workers do NOT see any alerts',
    ] },
  { id: 'conflicts', area: 'Activity', title: 'Sync conflicts surface & resolve',
    instruction: 'When two people record the same day’s figure, the owner can review it.',
    checks: [
      'Two same-day entries for one batch produce a conflict; the later one is kept automatically',
      'The owner Activity page lists the conflict with both versions',
      'Accept keeps the auto result; "Use Version A/B" overrides the figure',
      'Once handled it leaves the review list; workers can’t see conflicts',
    ] },
  { id: 'lifecycle', area: 'Farm', title: 'Growth stages & moving a flock',
    instruction: 'Set up stages and move a flock through its lifecycle.',
    checks: [
      'Farm → "Lifecycle stages": each animal type has editable stages with a start age (days); Save works',
      'A batch’s Lifecycle card shows its age, current stage, a timeline, and "Next: X in N days" / "⚠ Due to move"',
      '"Advance stage / Move unit" moves it to another unit and can adjust the head count (hatch/transfer loss)',
      'Stage, unit and count update; BOTH units’ occupancy adjust; the move shows in History',
      'An over-age batch raises a "Ready to move stage" alert',
    ] },
  { id: 'batchpl', area: 'Batch P&L', title: 'Batch profit & loss is correct',
    instruction: 'Open a batch’s P&L and check the cost/valuation logic.',
    checks: [
      'Cost breakdown lists feed / health / labour / salaries / overhead / stock',
      'The salaries line reflects ACTUAL payroll for that batch (zero until payroll is run)',
      '"Cost per surviving animal" is spread over SURVIVORS, not the few left after sales',
      'The break-even price for the unsold animals is sensible',
      'Survived + Sold + Died add back up to the starting quantity',
    ] },
  { id: 'reports', area: 'Reports', title: 'Reports export, match & share',
    instruction: 'Export reports and share a read-only link.',
    checks: [
      'Export an "Activity & period" and a "Batch economics" report as PDF, plus one CSV/Excel; the figures match the screen',
      'The Profit & Loss has a bottom-line TOTAL row',
      'Changing the date range changes the date-filtered reports; the all-time "batch economics" ones stay the same',
      'The expiring read-only link lets an auditor/investor view WITHOUT logging in, is read-only, and stops working once expired/revoked',
    ] },
];

// Build a fresh (all-pending) run from a checklist — the admin-configured one if
// supplied, else the built-in defaults.
export function freshRun(defs: readonly TestStepDef[] = TEST_STEPS): TestStep[] {
  return defs.map((s) => ({ id: s.id, area: s.area, title: s.title, instruction: s.instruction, checks: s.checks, status: 'pending' as StepStatus }));
}

// Stable, URL-safe id from arbitrary text.
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'step';
}

// Validate & clean an admin-edited checklist: every step needs a title and an
// instruction; ids are derived (and de-duplicated) so the admin never has to
// think about them. Throws a user-facing message on the first invalid row.
export function normalizeSteps(raw: ReadonlyArray<Partial<TestStepDef>>): TestStepDef[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Add at least one test step.');
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const title = (r.title ?? '').trim();
    const instruction = (r.instruction ?? '').trim();
    if (!title) throw new Error(`Step ${i + 1} needs a title.`);
    if (!instruction) throw new Error(`Step "${title}" needs an instruction.`);
    const base = r.id && r.id.trim() ? slugify(r.id) : slugify(title);
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}_${n}`;
    seen.add(id);
    const checks = Array.isArray(r.checks) ? r.checks.map((c: unknown) => String(c).trim()).filter(Boolean) : undefined;
    return { id, area: (r.area ?? '').trim() || 'General', title, instruction, ...(checks && checks.length ? { checks } : {}) };
  });
}

const STATUSES: StepStatus[] = ['pending', 'pass', 'fail'];

export interface StepUpdate { id: string; status: StepStatus; note?: string }

// Apply one answer to the checklist. Throws (with a user-facing message) on:
//   • an unknown step id, • an invalid status, • a 'fail' without an explanation.
// Returns a NEW array (never mutates the input).
export function applyStepUpdate(steps: readonly TestStep[], update: StepUpdate): TestStep[] {
  if (!STATUSES.includes(update.status)) throw new Error('Invalid status.');
  const idx = steps.findIndex((s) => s.id === update.id);
  if (idx < 0) throw new Error('Unknown test step.');
  const note = (update.note ?? '').trim();
  if (update.status === 'fail' && !note) throw new Error('Please describe what went wrong before continuing.');
  const next = steps.slice();
  // A step that is no longer "failed" keeps neither its note nor its screenshots.
  next[idx] = {
    ...next[idx], status: update.status,
    note: update.status === 'fail' ? note : undefined,
    photoIds: update.status === 'fail' ? next[idx].photoIds : undefined,
  };
  return next;
}

// Attach a screenshot id to a FAILED step, enforcing the per-step maximum. Pure —
// the caller is responsible for actually storing the image and the `max`.
export function addPhotoToStep(steps: readonly TestStep[], stepId: string, photoId: string, max: number): TestStep[] {
  if (max <= 0) throw new Error('Screenshots are not enabled for this test.');
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) throw new Error('Unknown test step.');
  if (steps[idx].status !== 'fail') throw new Error('You can only attach a screenshot to a step you marked as failed.');
  const photos = steps[idx].photoIds ?? [];
  if (photos.length >= max) throw new Error(`Up to ${max} screenshot${max === 1 ? '' : 's'} per step.`);
  const next = steps.slice();
  next[idx] = { ...steps[idx], photoIds: [...photos, photoId] };
  return next;
}

// Every photo id currently referenced by the run — for cleanup on reset/delete.
export function allPhotoIds(steps: readonly TestStep[]): string[] {
  return steps.flatMap((s) => s.photoIds ?? []);
}

// Reset only the FAILED steps back to pending (clearing their note/screenshots);
// passed and already-pending steps are untouched. Lets an admin ask a tester to
// redo just what broke instead of the whole checklist. The reused
// applyStepUpdate/TestingGuide flow needs no changes — it already just walks
// whichever steps are 'pending', in checklist order.
export function retestFailed(steps: readonly TestStep[]): TestStep[] {
  return steps.map((s) => (s.status === 'fail' ? { ...s, status: 'pending' as StepStatus, note: undefined, photoIds: undefined } : s));
}

export interface Progress {
  total: number; done: number; passed: number; failed: number; pendingCount: number;
  pending: TestStep[]; nextPending: TestStep | null; complete: boolean;
}

export function progress(steps: readonly TestStep[]): Progress {
  const pending = steps.filter((s) => s.status === 'pending');
  const passed = steps.filter((s) => s.status === 'pass').length;
  const failed = steps.filter((s) => s.status === 'fail').length;
  const done = steps.length - pending.length;
  return {
    total: steps.length, done, passed, failed, pendingCount: pending.length,
    pending, nextPending: pending[0] ?? null, complete: steps.length > 0 && pending.length === 0,
  };
}

// A run can be submitted only once EVERY step has been answered.
export function canSubmit(steps: readonly TestStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.status !== 'pending');
}

export interface TestReport {
  total: number; passed: number; failed: number; complete: boolean;
  failures: { id: string; area: string; title: string; note: string; photoIds: string[] }[];
}

export function summarize(steps: readonly TestStep[]): TestReport {
  const p = progress(steps);
  return {
    total: p.total, passed: p.passed, failed: p.failed, complete: p.complete,
    failures: steps.filter((s) => s.status === 'fail').map((s) => ({ id: s.id, area: s.area, title: s.title, note: s.note ?? '', photoIds: s.photoIds ?? [] })),
  };
}
