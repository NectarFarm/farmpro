// Guided front-end acceptance test (UAT) — pure state machine, no DB/IO, so the
// rules (a failure needs an explanation, you can only submit once every step is
// answered, restart resets cleanly) are unit-testable to the boundary.
//
// The farmer works ONE step at a time. Each step is checked off as "Works" or
// "Failed". A failed step must carry a note before moving on. When every step is
// answered the run can be submitted, producing a report for the admin.

export type StepStatus = 'pending' | 'pass' | 'fail';

export interface TestStepDef { id: string; area: string; title: string; instruction: string; }
export interface TestStep extends TestStepDef { status: StepStatus; note?: string; photoIds?: string[] }

// Ordered checklist covering the main front-end flows. Each instruction spells out
// exactly WHAT to look at, so a non-technical tester knows what "working" means.
export const TEST_STEPS: TestStepDef[] = [
  { id: 'login', area: 'Sign in', title: 'Sign in & role-based landing', instruction:
    'Sign in with your email + password (owner/manager) or phone + PIN (worker). Check: correct details are accepted and you land on the RIGHT home for your role — owner/manager → the owner dashboard, worker → the phone worker app, auditor → the read-only auditor view. Check the small things too: wrong details show a clear "login failed" message (never a blank screen or a spinner that hangs); the Show/Hide toggle reveals and hides the password/PIN; the farm name/logo shows in the header and browser tab; and signing out returns you to the login screen (and the back button can\'t get you back in).' },
  { id: 'dashboard', area: 'Dashboard', title: 'Dashboard KPIs & period filter', instruction:
    'On the owner dashboard, check every KPI card shows a real number under its grouped heading — Active Batches, Total Animals, Mortality %, Avg FCR, Gross Margin, Revenue, Task Completion, Pending Alerts — and the production chart draws. Then on the Finance group switch the Revenue period between Month / Quarter / Year / All and confirm the amount changes for each (Year ≥ Quarter ≥ Month, All-time is the largest). Nothing should read NaN, undefined, a bare "KSh" with no amount, or a blank card.' },
  { id: 'unit', area: 'Farm', title: 'Add a production unit', instruction:
    'Farm → "+ Add Unit" (cage / pen / pond / plot). Check: you can set its name, type and capacity; it saves without an error; it appears in the list with the correct species icon and shows its occupancy (e.g. 0 / capacity); and a blank or zero capacity is rejected with a clear message rather than saved.' },
  { id: 'batch', area: 'Farm', title: 'Add a batch & its products', instruction:
    'Farm → add a batch to a unit (species/breed, quantity, acquired date, age, purchase cost). Check: it saves and the unit\'s occupancy goes UP by the quantity; opening the batch shows the auto-created products MATCHED to the species (a layer batch = Eggs + Manure + Spent hen; broilers = a live bird; pigs = pork/piglets; fish; maize = grain — and a pig batch never shows "eggs"), each with a sale unit and an editable price. Check "+ Add Product" adds an extra, and ticking "this product IS the animal" marks the stock you sell by head.' },
  { id: 'purchase', area: 'Inventory', title: 'Record a purchase & mix feed', instruction:
    'Inventory → "+ Record Purchase": item, supplier, quantity, unit cost. Check: it saves; the item shows under Stock with the new quantity and a value in KSh (not $); it appears under "Recent Stock"; and buying the same item again ADDS to the running quantity. Then open "Feed Formulation", pick ingredients + kg, and confirm it produces a finished feed whose cost is the rolled-up cost of the ingredients and that making it draws those ingredients down from stock.' },
  { id: 'worker', area: 'People', title: 'Add a worker — pay & batches', instruction:
    'People → "+ Add Employee": name, phone, role (worker/manager/vet), a monthly salary, a pay day, and the batches they work on (untick one to test). Check: the row shows their salary, pay day and "Works on" count; re-opening lets you change the assignment and it persists; a pay day outside 1–31 is stored as blank (not saved as a bad value); and adding a second worker with the same phone is rejected.' },
  { id: 'profile', area: 'Worker config', title: 'Control what a worker sees (server-side)', instruction:
    'Worker config → open a permission profile, set a money field (e.g. feed cost or a price) to Hidden and another to Read-only, then Save — confirm it saves. Then ACTUALLY sign in as a worker on that profile and check ON THEIR PHONE that the hidden field is genuinely gone (not just greyed out) and the read-only one cannot be edited. This proves money fields are stripped on the server before they ever reach the worker\'s device.' },
  { id: 'record', area: 'Worker app', title: 'Worker records in the field (offline)', instruction:
    'Sign in as a worker (phone + PIN). Do the Morning Round (water level, feed left, eggs/production collected, anything abnormal) and submit; record a mortality WITH a photo; and do a Weight Sampling entry. Check: each saves on the phone and the offline/sync indicator clears when there is network; the worker can only record the products they are allowed (collected eggs/manure — NOT the live animals); and every entry later appears on the owner side against the correct batch.' },
  { id: 'sale', area: 'Finance', title: 'Record a sale (stock-aware)', instruction:
    'Finance → "+ Record Sale". First sell a live animal from a batch: check it warns/BLOCKS when you try to sell more than are alive, and after saving the batch\'s live count drops by exactly what you sold. Then sell a collected product (e.g. eggs): check it draws down from what was COLLECTED, not from the live birds. Each sale shows in the Sales list with quantity × unit price = the correct total in KSh.' },
  { id: 'budget', area: 'Finance', title: 'Monthly budget adds up', instruction:
    'Finance → the "Budget · this month" panel. Check: Revenue in includes both sales AND any staff fines (it shows "incl. … staff fines" when fines exist); Expenses out splits into stock + salaries — and the salaries figure becomes the ACTUAL net once you have run payroll, otherwise the wage-bill estimate; Net = Revenue in − Expenses out; and the pay-day reminder appears a few days before a worker\'s pay day.' },
  { id: 'payroll', area: 'Payroll', title: 'Run payroll, advances, fines & lock', instruction:
    'Payroll → pick the month. Record an advance and a fine for a worker, then "Run payroll". Check: net = salary − advances − fines + bonuses on each row, and the summary totals Gross / Net / Fines / Paid. Press "Pay" to lock the month and confirm it shows 🔒 Paid. Then verify the rules that matter: a PAID month rejects a new advance/fine; changing that worker\'s salary does NOT change the paid month, but a NEW month uses the new salary; "Payslip" downloads that month and "Year" downloads the full-year statement (totals matching); and an advance bigger than the salary leaves the worker still owing (net at/below zero) rather than a wrong figure.' },
  { id: 'mypay', area: 'Worker app', title: 'Worker sees their own pay', instruction:
    'Sign in as a worker and open "My Pay". Check: the headline number is their paid-to-date total, with the count of months paid and the month payments started; any outstanding advance is shown clearly; and the payslip list shows each month\'s gross, advances, fines and net with a paid/pending tag. Confirm these match exactly what the owner paid on the Payroll page — and that a worker can ONLY see their own pay, no one else\'s.' },
  { id: 'alerts', area: 'Alerts', title: 'Alert rules fire on real data', instruction:
    'Alerts → set your rules (mortality %, low feed kg, overdue tasks, water quality), press "Save Rules", then "Run checks now". Check: an alert is raised from your real data when a threshold is crossed and NOT raised when it isn\'t; each alert names the batch and the reason; and acknowledging an alert clears it and drops the "Pending Alerts" count on the dashboard by one.' },
  { id: 'batchpl', area: 'Batch P&L', title: 'Batch profit & loss is correct', instruction:
    'Open a batch\'s profit & loss. Check: the cost breakdown lists feed / health / labour / salaries / overhead / stock, and the salaries line reflects ACTUAL payroll for that batch\'s workers (it stays zero until you have run payroll — it is not a guess); "cost per surviving animal" is spread over the SURVIVORS (not the few left after sales); the break-even price for the unsold animals is sensible; and Survived + Sold + Died add back up to the starting quantity.' },
  { id: 'reports', area: 'Reports', title: 'Reports export, match & share', instruction:
    'Reports → export one "Activity & period" report and one "Batch economics" report as PDF, plus one as CSV or Excel, and open the files. Check: the figures in the file match the screen; the Profit & Loss carries a bottom-line TOTAL row; and changing the date range changes the date-filtered reports while the all-time "batch economics" ones stay the same. Finally generate the expiring read-only link and open it in a private window — confirm an auditor/investor can view WITHOUT logging in, that it is read-only, and that it stops working once expired/revoked.' },
];

// Build a fresh (all-pending) run from a checklist — the admin-configured one if
// supplied, else the built-in defaults.
export function freshRun(defs: readonly TestStepDef[] = TEST_STEPS): TestStep[] {
  return defs.map((s) => ({ id: s.id, area: s.area, title: s.title, instruction: s.instruction, status: 'pending' as StepStatus }));
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
    return { id, area: (r.area ?? '').trim() || 'General', title, instruction };
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
