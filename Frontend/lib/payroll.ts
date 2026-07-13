// Pure payroll math — no DB, no I/O — so it can be unit-tested exhaustively and
// reused on both client (budget) and server (per-batch costing).
//
// Assignment model (employees.assignedBatchIds):
//   null  → assigned to ALL active batches (current & future) — the default
//   [ids] → assigned to exactly those (intersected with what's active)
//   []    → assigned to none
// Salary is a monthly figure (KSh). It is spread across the active batches a
// worker covers, by head count (a worker on a 500-bird and a 50-bird batch loads
// ~10× the cost onto the bigger one). If every covered batch is empty, split evenly.

export interface PayrollEmployee {
  active: boolean;
  salary?: number | null;
  assignedBatchIds?: string[] | null;
}

export interface PayrollBatch {
  id: string;
  currentQty: number;
  status: string; // 'ACTIVE' counts; anything else is ignored
}

// Sum of every active employee's monthly salary — the whole farm's wage bill.
export function totalMonthlyWageBill(employees: PayrollEmployee[]): number {
  const total = employees.reduce((s, e) => s + (e.active && e.salary ? e.salary : 0), 0);
  return Math.round(total * 100) / 100;
}

// The active batch ids a worker's pay is spread over (see assignment model above).
export function coveredActiveBatchIds(emp: { assignedBatchIds?: string[] | null }, activeIds: string[]): string[] {
  if (emp.assignedBatchIds == null) return activeIds.slice();
  const assigned = new Set(emp.assignedBatchIds);
  return activeIds.filter((id) => assigned.has(id));
}

// Allocate each active employee's monthly salary to the active batches they cover,
// by head share. Returns monthly KSh per ACTIVE batch (id → amount, 0 if none).
// Salary for a worker who covers no active batch is simply not allocated anywhere
// (it still counts in the farm-wide wage bill / budget — it's just unattributed).
export function monthlySalaryByBatch(
  employees: PayrollEmployee[],
  batches: PayrollBatch[],
): Record<string, number> {
  const active = batches.filter((b) => b.status === 'ACTIVE');
  const activeIds = active.map((b) => b.id);
  const qty: Record<string, number> = {};
  for (const b of active) qty[b.id] = Math.max(0, b.currentQty);

  const out: Record<string, number> = {};
  for (const id of activeIds) out[id] = 0;

  for (const e of employees) {
    if (!e.active || !e.salary || e.salary <= 0) continue;
    const covered = coveredActiveBatchIds(e, activeIds);
    if (covered.length === 0) continue;
    const totalQty = covered.reduce((s, id) => s + qty[id], 0);
    for (const id of covered) {
      const share = totalQty > 0 ? qty[id] / totalQty : 1 / covered.length;
      out[id] += e.salary * share;
    }
  }

  for (const id of activeIds) out[id] = Math.round(out[id] * 100) / 100;
  return out;
}

// Allocate ACTUAL payroll (the gross of generated payslips, whether their status is
// still pending or already paid) to batches — the best-practice basis for per-batch
// labour cost. Unlike monthlySalaryByBatch this uses each worker's real RUN payroll
// gross and includes EVERY worker who had payroll run for them (even if since
// deactivated), because that labour was genuinely incurred. Spread by head share
// across each worker's assigned active batches, same rule as the live allocator.
export interface PaidWorker { paidGross: number; assignedBatchIds?: string[] | null }
export function labourByBatch(workers: readonly PaidWorker[], batches: readonly PayrollBatch[]): Record<string, number> {
  const active = batches.filter((b) => b.status === 'ACTIVE');
  const activeIds = active.map((b) => b.id);
  const qty: Record<string, number> = {};
  for (const b of active) qty[b.id] = Math.max(0, b.currentQty);

  const out: Record<string, number> = {};
  for (const id of activeIds) out[id] = 0;

  for (const w of workers) {
    if (!w.paidGross || w.paidGross <= 0) continue;
    const covered = coveredActiveBatchIds(w, activeIds);
    if (covered.length === 0) continue;
    const totalQty = covered.reduce((s, id) => s + qty[id], 0);
    for (const id of covered) {
      const share = totalQty > 0 ? qty[id] / totalQty : 1 / covered.length;
      out[id] += w.paidGross * share;
    }
  }
  for (const id of activeIds) out[id] = Math.round(out[id] * 100) / 100;
  return out;
}

// Whole days from `from` until the next occurrence of `payDay` (1–31), clamped to
// each month's length (a payDay of 31 in a 30-day month falls on the 30th). Returns
// 0 when today IS pay day, and Infinity when there's no valid pay day.
export function daysUntilPayDay(payDay: number | null | undefined, from: Date): number {
  if (!payDay || payDay < 1) return Infinity;
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const clamp = (y: number, m: number) => Math.min(payDay, daysInMonth(y, m));
  const y = from.getFullYear(), m = from.getMonth(), d = from.getDate();

  const thisMonthPay = clamp(y, m);
  if (d <= thisMonthPay) return thisMonthPay - d;

  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return (daysInMonth(y, m) - d) + clamp(ny, nm);
}
