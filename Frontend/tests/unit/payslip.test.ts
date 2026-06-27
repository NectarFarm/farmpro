import { describe, it, expect } from 'vitest';
import {
  computePayslip, validPeriod, currentPeriod, periodLabel, monthsBetween, yearStatement,
  type LedgerEntry,
} from '@/lib/payslip';

describe('computePayslip', () => {
  it('net = gross − advances − fines + bonuses', () => {
    const entries: LedgerEntry[] = [
      { type: 'advance', amount: 5000 },
      { type: 'fine', amount: 1000 },
      { type: 'bonus', amount: 500 },
    ];
    expect(computePayslip(18000, entries)).toEqual({
      gross: 18000, advances: 5000, fines: 1000, bonuses: 500, adjustments: 0, net: 12500,
    });
  });

  it('sums multiple entries of the same type', () => {
    const b = computePayslip(10000, [
      { type: 'advance', amount: 2000 }, { type: 'advance', amount: 1000 },
      { type: 'fine', amount: 300 }, { type: 'fine', amount: 200 },
    ]);
    expect(b.advances).toBe(3000);
    expect(b.fines).toBe(500);
    expect(b.net).toBe(6500);
  });

  it('treats adjustment as signed (can be a deduction or a top-up)', () => {
    expect(computePayslip(10000, [{ type: 'adjustment', amount: -750 }]).net).toBe(9250);
    expect(computePayslip(10000, [{ type: 'adjustment', amount: 750 }]).net).toBe(10750);
  });

  it('ignores negative advance/fine/bonus amounts (clamped to 0)', () => {
    expect(computePayslip(10000, [{ type: 'fine', amount: -50 }]).fines).toBe(0);
  });

  it('a huge advance can drive net below zero (employee owes the farm)', () => {
    expect(computePayslip(10000, [{ type: 'advance', amount: 12000 }]).net).toBe(-2000);
  });

  it('rounds away float drift in net', () => {
    // 100.1 + 0.2 = 100.30000000000001 in IEEE-754 → must round to 100.3.
    expect(computePayslip(100.1, [{ type: 'bonus', amount: 0.2 }]).net).toBe(100.3);
  });
});

describe('validPeriod', () => {
  it('accepts YYYY-MM with a real month', () => {
    expect(validPeriod('2026-06')).toBe(true);
    expect(validPeriod('2026-12')).toBe(true);
  });
  it('rejects bad shapes and impossible months', () => {
    for (const p of ['2026-13', '2026-00', '2026-6', '26-06', 'June', '', null, 5]) expect(validPeriod(p)).toBe(false);
  });
});

describe('currentPeriod / periodLabel', () => {
  it('formats the current month and a label', () => {
    expect(currentPeriod(new Date(2026, 5, 15))).toBe('2026-06'); // June (month index 5)
    expect(periodLabel('2026-06')).toBe('Jun 2026');
  });
});

describe('monthsBetween (months paid since start)', () => {
  it('is inclusive of both ends', () => {
    expect(monthsBetween('2026-01', '2026-06')).toBe(6);
    expect(monthsBetween('2026-06', '2026-06')).toBe(1);
  });
  it('spans year boundaries', () => {
    expect(monthsBetween('2025-11', '2026-02')).toBe(4);
  });
  it('is 0 when reversed or invalid', () => {
    expect(monthsBetween('2026-06', '2026-01')).toBe(0);
    expect(monthsBetween('bad', '2026-01')).toBe(0);
  });
});

describe('yearStatement', () => {
  const slips = [
    { period: '2026-01', status: 'paid', gross: 18000, advances: 0, fines: 0, bonuses: 0, net: 18000 },
    { period: '2026-02', status: 'paid', gross: 18000, advances: 5000, fines: 1000, bonuses: 0, net: 12000 },
    { period: '2026-03', status: 'pending', gross: 18000, advances: 0, fines: 0, bonuses: 0, net: 18000 },
    { period: '2025-12', status: 'paid', gross: 9999, advances: 0, fines: 0, bonuses: 0, net: 9999 },
  ];
  it('totals only the requested year and counts paid months', () => {
    const s = yearStatement(slips, '2026');
    expect(s.months).toBe(3);
    expect(s.paidMonths).toBe(2);
    expect(s.gross).toBe(54000);
    expect(s.advances).toBe(5000);
    expect(s.fines).toBe(1000);
    expect(s.net).toBe(48000);
  });
});
