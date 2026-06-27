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
  { id: 'login', area: 'Sign in', title: 'Sign in works', instruction:
    'Open the app and sign in with your email or phone + password/PIN. Check: correct details are accepted; wrong details show a clear "login failed" message (not a blank screen); the Show/Hide password toggle works; and you land on YOUR own dashboard.' },
  { id: 'dashboard', area: 'Dashboard', title: 'Dashboard shows real numbers', instruction:
    'On the dashboard, check every KPI card shows an actual number — Active Batches, Total Animals, Mortality %, Avg FCR, Gross Margin, Revenue (month), Task Completion, Pending Alerts — and the production chart draws. Nothing should read NaN, undefined, or "KSh" with no amount.' },
  { id: 'unit', area: 'Farm', title: 'Add a production unit', instruction:
    'Farm → add a unit (cage / pen / pond / plot). Check: you can set its name, type and capacity; it saves without error; and it appears in the list with the correct species icon.' },
  { id: 'batch', area: 'Farm', title: 'Add a batch & its products', instruction:
    'Add a batch to a unit (species/breed, quantity, acquired date, cost). Check: it saves; opening it shows the auto-created products for that species (e.g. a layer batch = Eggs + Manure + Spent hen) each with a price and sale unit.' },
  { id: 'purchase', area: 'Inventory', title: 'Record a purchase (stock in)', instruction:
    'Inventory → "+ Record Purchase": item, supplier, quantity, unit cost. Check: it saves; the item now shows under Stock with the new quantity; costs read in KSh (not $); and it appears under "Recent Stock".' },
  { id: 'worker', area: 'People', title: 'Add a worker — pay & batches', instruction:
    'People → "+ Add Employee": name, phone, role, a monthly salary, a pay day, and the batches they work on (try unticking one). Check: the row shows their salary, pay day and "Works on" count; and you can re-open and change the assignment.' },
  { id: 'profile', area: 'Worker config', title: 'Control what a worker sees', instruction:
    'Worker config → open a profile, set a money field (e.g. feed cost) to Hidden, then Save. Check it saves. Ideally: sign in as that worker and confirm the hidden field really is gone.' },
  { id: 'record', area: 'Worker app', title: 'Worker records in the field', instruction:
    'Sign in as a worker (phone + PIN). Do the Morning Round (water, feed left, eggs/production, anything abnormal) and record a mortality with a photo. Check: it saves on the phone, the sync indicator clears, and the entries later appear on the owner side.' },
  { id: 'sale', area: 'Finance', title: 'Record a sale', instruction:
    'Finance → "+ Record Sale": sell a live animal from a batch. Check: it warns/blocks if you try to sell more than are alive; after saving, that batch\'s live count drops by exactly what you sold; and the sale shows in the Sales list with the correct total.' },
  { id: 'budget', area: 'Finance', title: 'Monthly budget adds up', instruction:
    'On Finance, check the "Budget · this month" panel: Revenue in, Expenses out (split into stock + salaries), and Net. Check the numbers match what you recorded, and the pay-day reminder appears when a pay day is near.' },
  { id: 'batchpl', area: 'Batch P&L', title: 'Batch profit & loss is correct', instruction:
    'Open a batch. Check: the cost breakdown lists feed/health/labour/salaries/overhead/stock; "cost per surviving animal" is spread over survivors (not the few left after sales); the break-even price for the unsold animals looks right; and Survived + Sold + Died add up to the starting number.' },
  { id: 'reports', area: 'Reports', title: 'Reports export & match', instruction:
    'Reports → export at least one as PDF and one as CSV, and open the files. Check: the figures in the file match the screen; the Profit & Loss has a bottom TOTAL row; and changing the date range changes the date-filtered reports (the "full lifecycle" ones stay the same).' },
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
