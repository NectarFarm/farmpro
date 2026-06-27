import { describe, it, expect } from 'vitest';
import {
  totalMonthlyWageBill,
  coveredActiveBatchIds,
  monthlySalaryByBatch,
  daysUntilPayDay,
  type PayrollEmployee,
  type PayrollBatch,
} from '@/lib/payroll';

const emp = (o: Partial<PayrollEmployee>): PayrollEmployee => ({ active: true, salary: 0, assignedBatchIds: null, ...o });
const batch = (id: string, currentQty: number, status = 'ACTIVE'): PayrollBatch => ({ id, currentQty, status });
// Sum of an allocation map — must never exceed the wage bill it came from.
const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

describe('totalMonthlyWageBill', () => {
  it('sums salaries of ACTIVE employees only', () => {
    expect(totalMonthlyWageBill([
      emp({ salary: 20000 }),
      emp({ salary: 15000 }),
      emp({ salary: 99999, active: false }), // inactive → excluded
    ])).toBe(35000);
  });

  it('ignores missing / zero salaries and rounds away float drift', () => {
    // 10000.1 + 5000.2 = 15000.299999999998 in IEEE-754 → must round to 15000.3.
    expect(totalMonthlyWageBill([
      emp({ salary: undefined }), emp({ salary: 0 }), emp({ salary: null }),
      emp({ salary: 10000.1 }), emp({ salary: 5000.2 }),
    ])).toBe(15000.3);
  });

  it('is 0 for no employees', () => {
    expect(totalMonthlyWageBill([])).toBe(0);
  });
});

describe('coveredActiveBatchIds', () => {
  const active = ['a', 'b', 'c'];

  it('null assignment → ALL active batches (the default)', () => {
    expect(coveredActiveBatchIds(emp({ assignedBatchIds: null }), active)).toEqual(['a', 'b', 'c']);
  });

  it('explicit list → only those that are active (stale ids dropped)', () => {
    expect(coveredActiveBatchIds(emp({ assignedBatchIds: ['b', 'zzz'] }), active)).toEqual(['b']);
  });

  it('empty list → none', () => {
    expect(coveredActiveBatchIds(emp({ assignedBatchIds: [] }), active)).toEqual([]);
  });

  it('preserves active-set order, not assignment order', () => {
    expect(coveredActiveBatchIds(emp({ assignedBatchIds: ['c', 'a'] }), active)).toEqual(['a', 'c']);
  });
});

describe('monthlySalaryByBatch', () => {
  it('default (all) spreads salary across active batches by HEAD count', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 30000, assignedBatchIds: null })],
      [batch('big', 500), batch('small', 50)],
    );
    // 500:50 ⇒ 10:1 ⇒ 27272.73 / 2727.27
    expect(out.big).toBeCloseTo(27272.73, 2);
    expect(out.small).toBeCloseTo(2727.27, 2);
    expect(sum(out)).toBeCloseTo(30000, 2); // fully allocated
  });

  it('assigning to ONE batch puts the whole salary there, nothing on the other', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 30000, assignedBatchIds: ['a'] })],
      [batch('a', 100), batch('b', 100)],
    );
    expect(out.a).toBe(30000);
    expect(out.b).toBe(0);
  });

  it('UNASSIGNING a batch re-spreads pay over only the remaining assigned batches', () => {
    // 3 active batches, worker unassigned from c ⇒ assigned = [a,b].
    const out = monthlySalaryByBatch(
      [emp({ salary: 30000, assignedBatchIds: ['a', 'b'] })],
      [batch('a', 100), batch('b', 100), batch('c', 100)],
    );
    expect(out.a).toBe(15000);
    expect(out.b).toBe(15000);
    expect(out.c).toBe(0); // nothing loads onto the unassigned batch
  });

  it('empty assignment ([]) allocates the salary to NOTHING (unattributed)', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 30000, assignedBatchIds: [] })],
      [batch('a', 100), batch('b', 100)],
    );
    expect(out.a).toBe(0);
    expect(out.b).toBe(0);
    expect(sum(out)).toBe(0);
  });

  it('inactive employees and zero salaries contribute nothing', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 50000, active: false }), emp({ salary: 0 }), emp({ salary: undefined })],
      [batch('a', 100)],
    );
    expect(out.a).toBe(0);
  });

  it('closed/sold-out batches never receive an allocation', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 20000, assignedBatchIds: null })],
      [batch('a', 100, 'ACTIVE'), batch('closed', 0, 'CLOSED')],
    );
    expect(out.a).toBe(20000);
    expect(out.closed).toBeUndefined(); // not even a key for non-active batches
  });

  it('when all covered batches are empty (0 head), splits the salary EVENLY', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 9000, assignedBatchIds: null })],
      [batch('a', 0), batch('b', 0), batch('c', 0)],
    );
    expect(out.a).toBe(3000);
    expect(out.b).toBe(3000);
    expect(out.c).toBe(3000);
  });

  it('accumulates multiple employees with different assignments', () => {
    // E1 (all, 20k) over a(100)+b(100) ⇒ 10k each.
    // E2 (only b, 12k) ⇒ +12k to b.
    const out = monthlySalaryByBatch(
      [emp({ salary: 20000, assignedBatchIds: null }), emp({ salary: 12000, assignedBatchIds: ['b'] })],
      [batch('a', 100), batch('b', 100)],
    );
    expect(out.a).toBe(10000);
    expect(out.b).toBe(22000);
    expect(sum(out)).toBe(32000);
  });

  it('a salary for a worker assigned only to a now-closed batch is dropped, not misallocated', () => {
    const out = monthlySalaryByBatch(
      [emp({ salary: 8000, assignedBatchIds: ['gone'] })],
      [batch('a', 100, 'ACTIVE'), batch('gone', 0, 'CLOSED')],
    );
    expect(out.a).toBe(0); // never leaks onto the unrelated active batch
  });

  it('returns an all-zero map (no allocation) when there are no active batches', () => {
    const out = monthlySalaryByBatch([emp({ salary: 10000 })], [batch('x', 0, 'CLOSED')]);
    expect(out).toEqual({});
  });
});

describe('daysUntilPayDay', () => {
  it('returns 0 when today IS pay day', () => {
    expect(daysUntilPayDay(15, new Date(2026, 5, 15))).toBe(0); // 15 Jun 2026
  });

  it('counts forward to a pay day later this month', () => {
    expect(daysUntilPayDay(28, new Date(2026, 5, 20))).toBe(8);
  });

  it('rolls into next month once this month’s pay day has passed', () => {
    // 20 Jun, pay day 5 ⇒ 10 days left in June (30-day) + 5 = 15.
    expect(daysUntilPayDay(5, new Date(2026, 5, 20))).toBe(15);
  });

  it('clamps a 31 pay day to the last day of a short month', () => {
    // Feb 2026 has 28 days; on 27 Feb, pay day 31 ⇒ pays on the 28th ⇒ 1 day.
    expect(daysUntilPayDay(31, new Date(2026, 1, 27))).toBe(1);
  });

  it('handles the December → January year rollover', () => {
    // 20 Dec, pay day 5 ⇒ 11 days left in Dec (31-day) + 5 = 16.
    expect(daysUntilPayDay(5, new Date(2026, 11, 20))).toBe(16);
  });

  it('is Infinity for an unset / invalid pay day', () => {
    expect(daysUntilPayDay(null, new Date(2026, 5, 1))).toBe(Infinity);
    expect(daysUntilPayDay(0, new Date(2026, 5, 1))).toBe(Infinity);
    expect(daysUntilPayDay(undefined, new Date(2026, 5, 1))).toBe(Infinity);
  });
});
