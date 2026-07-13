import { describe, it, expect } from 'vitest';
import {
  dateInRange, filterRange, plRow, plTotalsRow, profitAndLoss, fcrReport, batchCard,
  periodSummary, monthsOverlapping, PL_COLUMNS,
} from '@/lib/reports';
import type { BatchCostSummary } from '@/lib/types';

// Minimal cost summary with sane defaults; override per test.
const cost = (o: Partial<BatchCostSummary> = {}): BatchCostSummary => ({
  batchId: 'b', acquisitionCost: 0, feedCost: 0, healthCost: 0, laborCost: 0, salaryCost: 0,
  overheadCost: 0, totalCost: 0, totalRevenue: 0, grossMargin: 0, costPerUnit: 0, outputUnit: 'kg',
  mortalityPct: 0, currentQty: 0, ...o,
});

describe('dateInRange', () => {
  it('is inclusive of both endpoints', () => {
    expect(dateInRange('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true);
    expect(dateInRange('2026-03-31', '2026-03-01', '2026-03-31')).toBe(true);
  });
  it('excludes days outside the window', () => {
    expect(dateInRange('2026-02-28', '2026-03-01', '2026-03-31')).toBe(false);
    expect(dateInRange('2026-04-01', '2026-03-01', '2026-03-31')).toBe(false);
  });
  it('compares by day, ignoring any time component', () => {
    expect(dateInRange('2026-03-15T23:59:59Z', '2026-03-01', '2026-03-31')).toBe(true);
  });
  it('EXCLUDES undated rows (null/empty) from a dated report', () => {
    expect(dateInRange(null, '2026-03-01', '2026-03-31')).toBe(false);
    expect(dateInRange(undefined, '2026-03-01', '2026-03-31')).toBe(false);
    expect(dateInRange('', '2026-03-01', '2026-03-31')).toBe(false);
  });
});

describe('filterRange', () => {
  it('keeps only rows whose date falls in the window', () => {
    const rows = [{ d: '2026-03-01' }, { d: '2026-03-20' }, { d: '2026-04-02' }, { d: null }];
    const out = filterRange(rows, (r) => r.d, '2026-03-01', '2026-03-31');
    expect(out.map((r) => r.d)).toEqual(['2026-03-01', '2026-03-20']);
  });
});

describe('plRow — salaries are a first-class column (the consistency bug)', () => {
  it('places each cost in the right column, including Salaries', () => {
    const c = cost({ feedCost: 100, healthCost: 20, laborCost: 30, salaryCost: 40, overheadCost: 10, acquisitionCost: 500, totalCost: 700, totalRevenue: 900, grossMargin: 200 });
    expect(plRow('B1', 'Layer house A', c)).toEqual(['B1', 'Layer house A', 100, 20, 30, 40, 10, 500, 700, 900, 200]);
    // Column header for the salary value really is "Salaries".
    expect(PL_COLUMNS[plRow('B1', 'Layer house A', c).indexOf(40)]).toBe('Salaries');
    // Unit sits right after the batch name column.
    expect(PL_COLUMNS[1]).toBe('Unit');
  });
  it('treats a missing salaryCost as 0 (never undefined in the sheet)', () => {
    const c = cost({ salaryCost: undefined });
    expect(plRow('B1', 'Layer house A', c)[5]).toBe(0);
  });
});

describe('plTotalsRow', () => {
  it('sums every money column across batches', () => {
    const a = cost({ feedCost: 100, salaryCost: 40, totalCost: 200, totalRevenue: 300, grossMargin: 100 });
    const b = cost({ feedCost: 50, salaryCost: 10, totalCost: 90, totalRevenue: 40, grossMargin: -50 });
    const row = plTotalsRow([a, b]);
    expect(row[0]).toBe('TOTAL');
    expect(row[1]).toBe('');   // Unit column stays blank on the totals row
    expect(row[2]).toBe(150);  // feed
    expect(row[5]).toBe(50);   // salaries
    expect(row[8]).toBe(290);  // total cost
    expect(row[9]).toBe(340);  // revenue
    expect(row[10]).toBe(50);  // margin (100 + -50)
  });
});

describe('profitAndLoss', () => {
  it('appends a TOTAL row and is lifecycle-scoped', () => {
    const r = profitAndLoss([
      { name: 'A', unit: 'Layer house A', cost: cost({ totalCost: 100, totalRevenue: 150, grossMargin: 50 }) },
      { name: 'B', unit: 'Kienyeji Meat - Lower', cost: cost({ totalCost: 200, totalRevenue: 100, grossMargin: -100 }) },
    ], { Generated: 'x' });
    expect(r.scope).toBe('lifecycle');
    expect(r.rows).toHaveLength(3);            // 2 batches + TOTAL
    expect(r.rows[0][1]).toBe('Layer house A');
    expect(r.rows[1][1]).toBe('Kienyeji Meat - Lower');
    expect(r.rows[2][0]).toBe('TOTAL');
    expect(r.rows[2][1]).toBe('');
    expect(r.rows[2][10]).toBe(-50);           // 50 + -100
  });
  it('has no TOTAL row when there are no batches', () => {
    const r = profitAndLoss([], { Generated: 'x' });
    expect(r.rows).toHaveLength(0);
  });
});

describe('fcrReport', () => {
  it('labels the FCR basis per species (eggs vs kg)', () => {
    const r = fcrReport([
      { name: 'Layers', unit: 'Layer house A', species: 'layer', cost: cost({ fcr: 2.4, outputUnit: 'eggs', mortalityPct: 3 }) },
      { name: 'Broilers', unit: 'Unassigned', species: 'broiler', cost: cost({ fcr: 1.7, outputUnit: 'kg', mortalityPct: 5 }) },
    ], { Generated: 'x' });
    expect(r.rows[0]).toEqual(['Layers', 'Layer house A', 'layer', 2.4, 'feed/dozen', '3%', 0]);
    expect(r.rows[1][4]).toBe('feed/kg');
    expect(r.scope).toBe('lifecycle');
  });
  it('shows an em dash when FCR is not computable', () => {
    const r = fcrReport([{ name: 'X', unit: 'Unassigned', species: 'maize', cost: cost({ fcr: undefined }) }], { Generated: 'x' });
    expect(r.rows[0][3]).toBe('—');
  });
});

describe('batchCard', () => {
  it('breaks the headcount into survived / sold / on-farm', () => {
    const r = batchCard([{ name: 'A', unit: 'Layer house A', species: 'broiler', stage: 'GROWING', cost: cost({ survivors: 95, soldHead: 70, currentQty: 25 }) }], { Generated: 'x' });
    expect(r.rows[0][1]).toBe('Layer house A');
    expect(r.rows[0].slice(6, 9)).toEqual([95, 70, 25]);
  });
});

describe('periodSummary — date-ranged P&L from transactions', () => {
  it('totals expenses and nets them against revenue', () => {
    const r = periodSummary({ revenue: 100000, feedCost: 30000, healthCost: 5000, labourCost: 8000, salaryCost: 12000, acquisitionCost: 20000 }, { Generated: 'x' });
    expect(r.scope).toBe('range');
    const map = Object.fromEntries(r.rows as [string, number][]);
    expect(map['Total expenses']).toBe(75000);     // 30000+5000+8000+12000+20000
    expect(map['Net for period']).toBe(25000);     // 100000 − 75000
  });
});

describe('monthsOverlapping', () => {
  it('a fully-elapsed calendar range is its length ÷ 30', () => {
    // Jan has 31 days, inclusive ⇒ 31/30.
    expect(monthsOverlapping('2026-01-01', '2026-01-31', '2026-01-01', '2026-12-31')).toBeCloseTo(31 / 30, 5);
  });
  it('clamps to today when the range runs into the future', () => {
    // range Jun 1–30 but "today" is Jun 10 ⇒ 10 inclusive days.
    expect(monthsOverlapping('2026-06-01', '2026-06-30', '2026-01-01', '2026-06-10')).toBeCloseTo(10 / 30, 5);
  });
  it('starts at the acquisition day when the batch began after the range start', () => {
    // batch acquired Jun 16, range Jun 1–30, today past ⇒ 15 inclusive days (16..30).
    expect(monthsOverlapping('2026-06-01', '2026-06-30', '2026-06-16', '2026-12-31')).toBeCloseTo(15 / 30, 5);
  });
  it('is 0 when there is no overlap', () => {
    expect(monthsOverlapping('2026-06-01', '2026-06-30', '2026-08-01', '2026-12-31')).toBe(0);
  });
});
