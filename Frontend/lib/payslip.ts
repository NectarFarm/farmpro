// Pure payroll math — no DB — so net pay, statements and period handling are
// unit-testable. Net = gross − advances − fines + bonuses + signed adjustments.
// Fines reduce net pay AND count as farm income (handled by the finance layer).

export type LedgerType = 'advance' | 'fine' | 'bonus' | 'adjustment';
export interface LedgerEntry { type: LedgerType; amount: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PayslipBreakdown {
  gross: number; advances: number; fines: number; bonuses: number; adjustments: number; net: number;
}

export function computePayslip(gross: number, entries: readonly LedgerEntry[]): PayslipBreakdown {
  let advances = 0, fines = 0, bonuses = 0, adjustments = 0;
  for (const e of entries) {
    if (e.type === 'advance') advances += Math.max(0, e.amount);
    else if (e.type === 'fine') fines += Math.max(0, e.amount);
    else if (e.type === 'bonus') bonuses += Math.max(0, e.amount);
    else adjustments += e.amount; // adjustment may be + or −
  }
  const g = Math.max(0, gross);
  return {
    gross: r2(g), advances: r2(advances), fines: r2(fines), bonuses: r2(bonuses), adjustments: r2(adjustments),
    net: r2(g - advances - fines + bonuses + adjustments),
  };
}

// 'YYYY-MM' with a real month 01–12.
export function validPeriod(p: unknown): p is string {
  return typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export function currentPeriod(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function periodLabel(p: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = p.split('-');
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

// Inclusive month count from `from` to `to` (e.g. 'months paid' since start). 0 if invalid or reversed.
export function monthsBetween(from: string, to: string): number {
  if (!validPeriod(from) || !validPeriod(to)) return 0;
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

export interface YearTotals { months: number; paidMonths: number; gross: number; advances: number; fines: number; bonuses: number; net: number }
type SlipLike = { period: string; status: string; gross: number; advances: number; fines: number; bonuses: number; net: number };

export function yearStatement(slips: readonly SlipLike[], year: string): YearTotals {
  const ps = slips.filter((p) => p.period.startsWith(`${year}-`));
  const sum = (k: keyof SlipLike) => r2(ps.reduce((s, p) => s + (Number(p[k]) || 0), 0));
  return {
    months: ps.length, paidMonths: ps.filter((p) => p.status === 'paid').length,
    gross: sum('gross'), advances: sum('advances'), fines: sum('fines'), bonuses: sum('bonuses'), net: sum('net'),
  };
}
