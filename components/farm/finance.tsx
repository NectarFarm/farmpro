'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { apiClient } from '@/lib/request';
import { Plus, Search, X, Download, ChevronRight, Receipt } from './icons';
import { DataTable, ColDef } from './data-table';
import type { ReportPayload } from '@/lib/report-types';
import { periodDateRange, BUDGET_PERIODS, type BudgetPeriod } from '@/lib/period-range';
import { parseMoneyToCents, centsToMajor, formatMoney } from '@/lib/money';

// ── Real-data wiring (issue #240) ───────────────────────────────────────────
// This screen used to render entirely from hardcoded mock data (a sales
// list, a purchases/expenses list, a GL entries list, a batch P&L list, and
// a payroll rows list). All those mock constants are gone. Real endpoints
// used below:
//   GET/POST /api/data/sales                      — Sales tab (issue #239)
//   GET/POST /api/purchases                        — Purchases/Expenses tab
//                                                     (issue #235; no PATCH
//                                                     exists, so there is no
//                                                     edit-purchase UI here —
//                                                     never existed on this
//                                                     screen either)
//   GET /api/batches + GET /api/batches/[id]/cost-breakdown
//                                                   — Batch P&L (Overview),
//                                                     composed client-side;
//                                                     no aggregate backend
//                                                     endpoint exists (see
//                                                     note near the batch P&L
//                                                     column definitions)
//   GET /api/gl/accounts + GET /api/gl/trial-balance
//                                                   — GL Accounts tab
//   GET /api/reports/pl                             — Budget Overview's
//                                                     Revenue/Expenses/Net,
//                                                     date-filtered by the
//                                                     Month/Quarter/YTD
//                                                     toggle (issue #299;
//                                                     see lib/period-range.ts
//                                                     for the from/to math).
//                                                     Reuses the Reports
//                                                     backend (issue #263)
//                                                     rather than forking its
//                                                     sales/purchases
//                                                     date-range query — its
//                                                     `meta.periodRevenue` /
//                                                     `periodExpense` are
//                                                     already unit-normalized
//                                                     (both whole currency
//                                                     units), which sidesteps
//                                                     the trial-balance unit
//                                                     mismatch noted below for
//                                                     this card specifically.
//   GET /api/inventory/items                        — resolves a purchase's
//                                                     itemId to a name/category
//                                                     for display (purchases
//                                                     rows only carry itemId)
//
// Payroll (payroll-and-gps task): the Payroll tab now runs
// GET/POST /api/payroll/runs and GET /api/payroll/runs/[id] for real — an
// owner runs payroll for a period and sees the resulting run + payslips.
// Write access is gated server-side by canEdit(payroll) (owner-only by
// default; lib/permissions.ts) — the "Run Payroll" button is shown to
// everyone who can see this tab and the server 403 is surfaced inline
// rather than duplicating the role check client-side, same pattern the rest
// of this screen doesn't bother pre-checking either.
//
// ── Money units (issue: money-unit-enforcement) ─────────────────────────────
// `sales.amountCents` used to be `sales.amount`, a plain whole-currency-unit
// number, while `purchases.totalCostCents` was already cents — the mismatch
// inflated the EXPENSE side of GET /api/gl/trial-balance ~100x relative to
// the REVENUE side for any tenant with both real sales and real purchases
// (issue #290's fix moved the conversion around; this issue removed it by
// putting every money column in cents). The GL Accounts tab below now
// displays the trial balance's `debitCents`/`creditCents`/`balanceCents`
// converted to whole units via lib/money.ts's `centsToMajor` for display —
// both sides share the same unit by construction, not by a conversion this
// screen has to get right.

/* ── API row shapes (exactly as the routes above return them) ── */
interface ApiSale {
  id: string;
  batchId: string | null;
  item: string;
  amountCents: number;
  method: string;
  status: string;
  soldAt: string;
  createdAt: string;
}
interface ApiPurchase {
  id: string;
  supplier: string;
  itemId: string;
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  paymentMethod: string;
  amountPaidCents: number;
  createdAt: string;
  farmId: string | null; // farm-scoped-data task (migration 0019)
}
interface ApiInventoryItemLite {
  id: string;
  name: string;
  category: string;
}
interface ApiBatchLite {
  id: string;
  code: string;
  name: string;
  status: string;
  acquisitionCostCents: number;
}
interface CostBreakdownCategory {
  key: string;
  label: string;
  amountCents: number;
  tracked: boolean;
  reason?: string;
}
interface ApiCostBreakdown {
  batchId: string;
  code: string;
  totalTrackedCents: number;
  categories: CostBreakdownCategory[];
}
interface ApiAccount {
  id: string;
  code: string;
  name: string;
  class: string;
  normalBalance: string;
}
interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  class: string;
  normalBalance: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}
interface ApiTrialBalance {
  rows: TrialBalanceRow[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  balanced: boolean;
}

// GET/POST /api/payroll/runs, GET /api/payroll/runs/[id] (payroll-and-gps task).
interface ApiPayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalAmountCents: number;
  employeeCount: number;
  memo: string;
  createdAt: string | null;
}
interface ApiPayslip {
  id: string;
  employeeId: string;
  employeeName: string;
  amountCents: number;
}

function fmtDate(d?: string | null): string {
  return d ? d.slice(0, 10) : '—';
}

const catChipClass = (cat: string) =>
  cat === 'Feed' ? 'chip-ok' : ['Vet', 'Vaccine', 'Medicine'].includes(cat) ? 'chip-purple' : 'chip-info';

/* ── Record Sale sheet — real POST /api/data/sales ── */
function RecordSaleSheet({ tenantId, batches, onCreated, onClose }: {
  tenantId: string;
  batches: ApiBatchLite[];
  onCreated: () => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [status, setStatus] = useState<'paid' | 'pending'>('paid');
  const [batchId, setBatchId] = useState('');
  const [soldAt, setSoldAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const amountCents = parseMoneyToCents(amount);
    if (!item.trim()) { setError('Item is required.'); return; }
    if (amountCents === null || amountCents <= 0) { setError('Amount must be a positive number.'); return; }

    setSaving(true);
    setError('');
    const res = await apiClient.post('/api/data/sales', {
      tenantId,
      item: item.trim(),
      amountCents,
      method: method.trim() || undefined,
      status,
      batchId: batchId || undefined,
      soldAt: soldAt || undefined,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      onClose();
    } else {
      setError(res.error || 'Failed to record sale.');
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 110 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)', maxHeight: '85%', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Record Sale</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Item *</label>
          <input className="farm-input" placeholder="e.g. Tray eggs (30) × 120" value={item} onChange={e => setItem(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Amount (KSh) *</label>
            <input className="farm-input" type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Method</label>
            <input className="farm-input" placeholder="e.g. Mpesa" value={method} onChange={e => setMethod(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Batch (optional)</label>
            <select className="farm-input" value={batchId} onChange={e => setBatchId(e.target.value)}>
              <option value="">No batch (general sale)</option>
              {batches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Sold on</label>
            <input className="farm-input" type="date" value={soldAt} onChange={e => setSoldAt(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Status</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['paid', 'pending'] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '9px 8px', borderRadius: 10, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer',
                background: status === s ? 'rgba(74,222,128,0.1)' : 'var(--card)',
                border: status === s ? '1px solid rgba(74,222,128,0.3)' : '1px solid var(--border-subtle)',
                color: status === s ? 'var(--primary-green)' : 'var(--text-muted)',
              }}>{s.toUpperCase()}</button>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Record Sale'}
        </button>
      </div>
    </div>
  );
}

/* ── Record Purchase/Expense sheet — real POST /api/purchases (same route
 * Inventory's Purchases tab uses; there is no expense-only concept in the
 * backend separate from a stock purchase). No edit/PATCH UI — GET/POST are
 * the only verbs the route supports. ── */
function RecordPurchaseSheet({ tenantId, itemNames, farms, activeFarmId, onCreated, onClose }: {
  tenantId: string;
  itemNames: string[];
  // farm-scoped-data task — see components/farm/inventory.tsx's
  // RecordPurchaseSheet for the identical rationale: a purchase and the lot
  // it creates always land at the same farm, so this can never be optional
  // the way a task's farm can.
  farms: { id: string; name: string }[];
  activeFarmId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [supplier, setSupplier] = useState('');
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [farmId, setFarmId] = useState(activeFarmId !== 'ALL' ? activeFarmId : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const qty = Number(quantity);
    const unitCostCents = parseMoneyToCents(unitCost);
    if (!supplier.trim() || !itemName.trim() || !unit.trim()) {
      setError('Supplier, item, and unit are required.');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) { setError('Quantity must be a positive number.'); return; }
    if (unitCostCents === null || unitCostCents < 0) { setError('Cost per unit must be a non-negative number.'); return; }
    if (!farmId) { setError('Select which farm this stock is for.'); return; }

    const amountPaidCents = amountPaid ? parseMoneyToCents(amountPaid) : null;
    if (amountPaid && amountPaidCents === null) { setError('Amount paid must be a number.'); return; }

    setSaving(true);
    setError('');
    const res = await apiClient.post('/api/purchases', {
      tenantId,
      supplier: supplier.trim(),
      itemName: itemName.trim(),
      category: category.trim() || undefined,
      unit: unit.trim(),
      quantity: Math.trunc(qty),
      unitCostCents,
      paymentMethod: paymentMethod.trim() || undefined,
      amountPaidCents: amountPaidCents ?? undefined,
      farmId,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      onClose();
    } else {
      setError(res.error || 'Failed to record purchase.');
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 110 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)', maxHeight: '85%', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Record Purchase / Expense</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          This also brings the item into Inventory stock — there is no expense-only record separate from a purchase.
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm *</label>
          <select className="farm-input" value={farmId} onChange={e => setFarmId(e.target.value)}>
            <option value="" disabled>Select a farm…</option>
            {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Supplier *</label>
          <input className="farm-input" placeholder="e.g. Unga Ltd" value={supplier} onChange={e => setSupplier(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Item *</label>
          <input className="farm-input" list="finance-item-names" placeholder="e.g. Broiler Starter Mash" value={itemName} onChange={e => setItemName(e.target.value)} />
          <datalist id="finance-item-names">
            {itemNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Category</label>
            <input className="farm-input" placeholder="e.g. Feed" value={category} onChange={e => setCategory(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Unit *</label>
            <input className="farm-input" placeholder="e.g. kg" value={unit} onChange={e => setUnit(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Quantity *</label>
            <input className="farm-input" type="number" placeholder="0" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Cost/unit (KSh) *</label>
            <input className="farm-input" type="number" placeholder="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Payment Method</label>
            <input className="farm-input" placeholder="e.g. M-Pesa" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Amount Paid (KSh)</label>
            <input className="farm-input" type="number" placeholder="0 if unpaid" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
          </div>
        </div>

        {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Record Purchase'}
        </button>
      </div>
    </div>
  );
}

/* ── Column definitions ─────────────────────────────────────────────────── */

// Batch P&L (Overview tab): composed client-side from GET /api/batches +
// each batch's GET /api/batches/[id]/cost-breakdown — there is no aggregate
// "batch P&L" backend endpoint. Fine at this farm's scale (a handful of
// batches); if the batch count grows large this per-batch loop should become
// a real aggregate endpoint (flagged in the PR as a follow-on).
const BATCH_PNL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: 'name', header: 'Batch', sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{r.name as string}</div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{r.code as string}</div>
      </div>
    ),
  },
  {
    key: 'revenue', header: 'Revenue', sortable: true, align: 'right', minWidth: 80,
    summary: 'sum',
    render: (r) => <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--status-ok)' }}>KSh {(r.revenue as number).toLocaleString()}</span>,
  },
  {
    key: 'cost', header: 'Cost', sortable: true, align: 'right', minWidth: 72,
    summary: 'sum',
    render: (r) => <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>KSh {(r.cost as number).toLocaleString()}</span>,
  },
  {
    key: 'margin', header: 'Margin', sortable: true, align: 'right', minWidth: 72,
    summary: 'sum',
    render: (r) => <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: (r.margin as number) > 0 ? 'var(--primary-green)' : 'var(--status-critical)' }}>KSh {(r.margin as number).toLocaleString()}</span>,
  },
  {
    key: 'pct', header: '%', sortable: true, align: 'right', minWidth: 50,
    summary: 'avg',
    render: (r) => <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: (r.pct as number) > 20 ? 'var(--status-ok)' : 'var(--status-warning)' }}>{r.pct as number}%</span>,
  },
  {
    key: 'status', header: 'Status', align: 'center', minWidth: 70,
    summary: 'count',
    render: (r) => <span className={`chip ${r.status === 'ACTIVE' ? 'chip-ok' : 'chip-info'}`} style={{ fontSize: 'var(--fs-2xs)' }}>{r.status as string}</span>,
  },
];

const SALES_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: 'item', header: 'Item', sortable: true, minWidth: 160,
    summary: () => <span style={{ fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{r.item as string}</div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>{(r.batchLabel as string) || '—'} · {(r.method as string) || '—'}</div>
      </div>
    ),
  },
  { key: 'date', header: 'Date', sortable: true, minWidth: 88, render: (r) => <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{r.date as string}</span> },
  {
    key: 'amount', header: 'Amount', sortable: true, align: 'right', minWidth: 90,
    summary: 'sum',
    render: (r) => <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--status-ok)' }}>KSh {(r.amount as number).toLocaleString()}</span>,
  },
  {
    key: 'status', header: 'Status', align: 'center', minWidth: 70,
    summary: 'count',
    render: (r) => <span className={`chip ${r.status === 'paid' ? 'chip-ok' : 'chip-warning'}`} style={{ fontSize: 'var(--fs-2xs)' }}>{(r.status as string).toUpperCase()}</span>,
  },
];

const GL_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: 'code', header: 'Code', sortable: true, minWidth: 56,
    summary: () => <span style={{ fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>TOTALS</span>,
    render: (r) => <span style={{ fontFamily: 'monospace', fontSize: 'var(--fs-sm)', color: 'var(--accent-blue)' }}>{r.code as string}</span>,
  },
  { key: 'name', header: 'Account', sortable: true, minWidth: 130, render: (r) => <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{r.name as string}</span> },
  {
    key: 'class', header: 'Type', sortable: true, align: 'center', minWidth: 80,
    render: (r) => {
      const t = r.class as string;
      const cls = t === 'REVENUE' ? 'chip-ok' : t === 'EXPENSE' ? 'chip-critical' : t === 'ASSET' ? 'chip-info' : 'chip-warning';
      return <span className={`chip ${cls}`} style={{ fontSize: 'var(--fs-2xs)' }}>{t}</span>;
    },
  },
  {
    key: 'debit', header: 'Debit', sortable: true, align: 'right', minWidth: 90,
    summary: 'sum',
    render: (r) => (r.debit as number) > 0
      ? <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--status-critical)' }}>KSh {(r.debit as number).toLocaleString()}</span>
      : <span style={{ color: 'var(--text-dim)' }}>—</span>,
  },
  {
    key: 'credit', header: 'Credit', sortable: true, align: 'right', minWidth: 90,
    summary: 'sum',
    render: (r) => (r.credit as number) > 0
      ? <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--status-ok)' }}>KSh {(r.credit as number).toLocaleString()}</span>
      : <span style={{ color: 'var(--text-dim)' }}>—</span>,
  },
  {
    key: 'balance', header: 'Balance', sortable: true, align: 'right', minWidth: 90,
    summary: 'sum',
    render: (r) => <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>KSh {(r.balance as number).toLocaleString()}</span>,
  },
];

/* ── Run Payroll sheet — real POST /api/payroll/runs (payroll-and-gps task).
 * Only asks for the period: every ACTIVE employee with a monthlySalaryCents
 * > 0 is paid their full rate automatically — there is no per-employee
 * amount entry here, deliberately (see db/schemas/people.ts's comment on
 * why this app has no attendance data to compute anything finer-grained
 * from). A 403 here (a non-owner role) is shown as a plain inline error,
 * same as every other sheet on this screen. ── */
function RunPayrollSheet({ tenantId, onCreated, onClose }: {
  tenantId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [periodStart, setPeriodStart] = useState(firstOfMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfMonth);
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ run: ApiPayrollRun; payslips: ApiPayslip[] } | null>(null);

  async function run() {
    if (!periodStart || !periodEnd) { setError('Select a period start and end date.'); return; }
    setSaving(true);
    setError('');
    const res = await apiClient.post<{ run: ApiPayrollRun; payslips: ApiPayslip[] }>('/api/payroll/runs', {
      tenantId, periodStart, periodEnd, memo: memo.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Failed to run payroll.'); return; }
    setResult(res.data);
    onCreated();
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-end', zIndex: 110 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)', maxHeight: '85%', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Run Payroll</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {result ? (
          <div>
            <div style={{ padding: '14px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 12, marginBottom: 14, textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 4 }}>Payroll run complete</div>
              <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 700, color: 'var(--primary-green)' }}>{formatMoney(result.run.totalAmountCents)}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{result.run.employeeCount} employee{result.run.employeeCount === 1 ? '' : 's'} paid · posted to the ledger</div>
            </div>
            <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 14 }}>
              {result.payslips.map((p, i, arr) => (
                <div key={p.id} style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{p.employeeName}</span>
                  <span style={{ fontWeight: 700 }}>{formatMoney(p.amountCents)}</span>
                </div>
              ))}
            </div>
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Period start *</label>
                <input className="farm-input" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Period end *</label>
                <input className="farm-input" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Memo (optional)</label>
              <input className="farm-input" placeholder="e.g. August 2026 salaries" value={memo} onChange={e => setMemo(e.target.value)} />
            </div>
            <div style={{ padding: '10px 12px', background: 'rgba(251,191,36,0.06)', borderRadius: 10, border: '1px solid rgba(251,191,36,0.2)', marginBottom: 14, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              Every active employee with a monthly salary set is paid their full rate for this period — gross pay only, no tax or statutory deductions. This posts a Payroll Expense entry to the ledger and cannot be undone from here.
            </div>
            {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving} onClick={run}>
              {saving ? 'Running…' : 'Run Payroll'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────────── */

export function FinanceScreen() {
  const { navigate, tenantId, activeFarmId, farms } = useNav();
  const [tab, setTab] = useState<'overview' | 'sales' | 'purchases' | 'gl' | 'payroll'>('overview');
  const [period, setPeriod] = useState<BudgetPeriod>('month');
  const [glSearch, setGlSearch] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const [showRecordSale, setShowRecordSale] = useState(false);
  const [showRecordPurchase, setShowRecordPurchase] = useState(false);

  const [sales, setSales] = useState<ApiSale[] | null>(null);
  const [salesError, setSalesError] = useState('');
  const [purchases, setPurchases] = useState<ApiPurchase[] | null>(null);
  const [purchasesError, setPurchasesError] = useState('');
  const [items, setItems] = useState<ApiInventoryItemLite[]>([]);
  const [batches, setBatches] = useState<ApiBatchLite[] | null>(null);
  const [batchesError, setBatchesError] = useState('');
  const [costBreakdowns, setCostBreakdowns] = useState<Map<string, ApiCostBreakdown>>(new Map());
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<ApiTrialBalance | null>(null);
  const [glError, setGlError] = useState('');
  const [budgetReport, setBudgetReport] = useState<ReportPayload | null>(null);
  const [budgetError, setBudgetError] = useState('');

  // Payroll (payroll-and-gps task)
  const [payrollRuns, setPayrollRuns] = useState<ApiPayrollRun[] | null>(null);
  const [payrollError, setPayrollError] = useState('');
  const [showRunPayroll, setShowRunPayroll] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedPayslips, setExpandedPayslips] = useState<ApiPayslip[] | null>(null);
  const [expandedError, setExpandedError] = useState('');

  // farm-scoped-data task: sales/purchases/batches all re-fetch on
  // activeFarmId change. Sales is a JOIN filter (batchId -> batches.unitId
  // -> production_units.farmId — sales has no farm_id of its own);
  // purchases is a direct column; batches is the same JOIN GET /api/batches
  // already documents.
  const loadSales = useCallback(() => {
    apiClient.get<ApiSale[]>(`/api/data/sales?tenantId=${tenantId}&farmId=${activeFarmId}`).then((res) => {
      if (res.success) { setSales(res.data); setSalesError(''); }
      else setSalesError(res.error || 'Failed to load sales.');
    });
  }, [tenantId, activeFarmId]);

  const loadPurchases = useCallback(() => {
    apiClient.get<ApiPurchase[]>(`/api/purchases?tenantId=${tenantId}&farmId=${activeFarmId}`).then((res) => {
      if (res.success) { setPurchases(res.data); setPurchasesError(''); }
      else setPurchasesError(res.error || 'Failed to load purchases.');
    });
  }, [tenantId, activeFarmId]);

  const loadBatches = useCallback(() => {
    apiClient.get<ApiBatchLite[]>(`/api/batches?tenantId=${tenantId}&farmId=${activeFarmId}`).then((res) => {
      if (res.success) { setBatches(res.data); setBatchesError(''); }
      else setBatchesError(res.error || 'Failed to load batches.');
    });
  }, [tenantId, activeFarmId]);

  // GL (chart of accounts + trial balance) stays tenant-wide regardless of
  // activeFarmId — journal_entries/journal_lines (db/schemas/finance.ts)
  // have no farm relationship: a posted journal entry traces back to a sale
  // or purchase by id, not by farm, and building one would mean joining the
  // GL through sales/purchases at report time, which is real new scope this
  // task didn't take on. Same "don't fake a filter that doesn't exist"
  // stance as GET /api/dashboard/kpis's tenant-wide metrics.
  const loadGL = useCallback(() => {
    apiClient.get<ApiAccount[]>('/api/gl/accounts').then((res) => {
      if (res.success) setAccounts(res.data);
    });
    apiClient.get<ApiTrialBalance>(`/api/gl/trial-balance?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setTrialBalance(res.data); setGlError(''); }
      else setGlError(res.error || 'Failed to load trial balance.');
    });
  }, [tenantId]);

  // Payroll (payroll-and-gps task): a manager sees this list (canView is
  // 'view' by default) even though POST /api/payroll/runs 403s them — the
  // 403 is what actually enforces "manager can't run payroll," not hiding
  // the list. A worker would get a 403 here too (payroll: 'hidden'), but
  // this screen's own tab bar already keeps workers off the Finance screen
  // entirely (see components/farm/navigation.tsx's per-role tab config).
  const loadPayrollRuns = useCallback(() => {
    apiClient.get<ApiPayrollRun[]>(`/api/payroll/runs?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setPayrollRuns(res.data); setPayrollError(''); }
      else { setPayrollRuns([]); setPayrollError(res.error || 'Failed to load payroll runs.'); }
    });
  }, [tenantId]);

  async function toggleRunPayslips(runId: string) {
    if (expandedRunId === runId) { setExpandedRunId(null); return; }
    setExpandedRunId(runId);
    setExpandedPayslips(null);
    setExpandedError('');
    const res = await apiClient.get<{ run: ApiPayrollRun; payslips: ApiPayslip[] }>(`/api/payroll/runs/${runId}?tenantId=${tenantId}`);
    if (res.success) setExpandedPayslips(res.data.payslips);
    else setExpandedError(res.error || 'Failed to load payslips.');
  }

  // Budget Overview (issue #299): Month/Quarter/YTD toggle refetches
  // GET /api/reports/pl with that period's from/to (lib/period-range.ts),
  // instead of the all-time trial balance — see the file-top comment.
  // Same GL caveat as loadGL above — lib/reports.ts's computePlReport has no
  // farmId support (it's built on the same farm-relationship-free GL), so
  // this stays tenant-wide too.
  const loadBudget = useCallback(() => {
    const { from, to } = periodDateRange(period);
    const params = new URLSearchParams({ tenantId, from, to });
    apiClient.get<ReportPayload>(`/api/reports/pl?${params.toString()}`).then((res) => {
      if (res.success) { setBudgetReport(res.data); setBudgetError(''); }
      else setBudgetError(res.error || 'Failed to load budget overview.');
    });
  }, [tenantId, period]);

  useEffect(() => { loadSales(); }, [loadSales]);
  useEffect(() => { loadPurchases(); }, [loadPurchases]);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { loadGL(); }, [loadGL]);
  useEffect(() => { loadBudget(); }, [loadBudget]);
  useEffect(() => { loadPayrollRuns(); }, [loadPayrollRuns]);
  useEffect(() => {
    apiClient.get<ApiInventoryItemLite[]>(`/api/inventory/items?tenantId=${tenantId}`).then((res) => {
      if (res.success) setItems(res.data);
    });
  }, [tenantId]);

  // Batch P&L (task 3): fetch each batch's real cost-breakdown once the
  // batch list has loaded. Fine to loop client-side at this scale; a real
  // aggregate endpoint would be worth a follow-on issue if the batch count
  // grows large.
  useEffect(() => {
    if (!batches || batches.length === 0) { setCostBreakdowns(new Map()); return; }
    let cancelled = false;
    Promise.all(
      batches.map((b) => apiClient.get<ApiCostBreakdown>(`/api/batches/${b.id}/cost-breakdown?tenantId=${tenantId}`))
    ).then((results) => {
      if (cancelled) return;
      const map = new Map<string, ApiCostBreakdown>();
      results.forEach((res, i) => { if (res.success) map.set(batches[i].id, res.data); });
      setCostBreakdowns(map);
    });
    return () => { cancelled = true; };
  }, [batches, tenantId]);

  const itemNameById = useMemo(() => new Map(items.map((i) => [i.id, i.name] as const)), [items]);
  const itemCategoryById = useMemo(() => new Map(items.map((i) => [i.id, i.category] as const)), [items]);
  const batchLabelById = useMemo(() => new Map((batches ?? []).map((b) => [b.id, b.code] as const)), [batches]);

  const salesRows = useMemo(() => (sales ?? []).map((s) => ({
    id: s.id,
    item: s.item,
    date: fmtDate(s.soldAt),
    batchLabel: s.batchId ? batchLabelById.get(s.batchId) ?? s.batchId : '',
    method: s.method,
    amount: centsToMajor(s.amountCents),
    status: s.status,
  })), [sales, batchLabelById]);

  const filteredSales = salesRows.filter((s) => {
    if (!salesSearch.trim()) return true;
    const q = salesSearch.toLowerCase();
    return s.item.toLowerCase().includes(q) || s.batchLabel.toLowerCase().includes(q) || (s.method || '').toLowerCase().includes(q);
  });

  // Batch P&L rows: revenue = this batch's real sales summed; cost = the
  // batch's real cost-breakdown total (currently just acquisitionCostCents —
  // see app/api/batches/[id]/cost-breakdown/route.ts for why feed/health/
  // labour/overhead are 0/untracked today).
  // Kept in cents (matches sales.amountCents) until the final rows.map below
  // — converted to whole units there, right next to cost's own conversion,
  // same "convert once, right where both sides of the margin meet" pattern
  // lib/reports.ts's computeBatchPlReport uses.
  const salesByBatchCents = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales ?? []) {
      if (!s.batchId) continue;
      m.set(s.batchId, (m.get(s.batchId) ?? 0) + s.amountCents);
    }
    return m;
  }, [sales]);

  const batchPLRows = useMemo(() => (batches ?? []).map((b) => {
    const breakdown = costBreakdowns.get(b.id);
    const costCents = breakdown?.totalTrackedCents ?? b.acquisitionCostCents ?? 0;
    const cost = centsToMajor(costCents);
    const revenue = centsToMajor(salesByBatchCents.get(b.id) ?? 0);
    const margin = revenue - cost;
    const pct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
    return { id: b.id, code: b.code, name: b.name, revenue, cost, margin, pct, status: b.status };
  }), [batches, costBreakdowns, salesByBatchCents]);

  // Budget Overview (issue #299): real revenue/expense totals for the
  // selected Month/Quarter/YTD period, from GET /api/reports/pl's
  // period-filtered meta (see loadBudget above and lib/reports.ts's
  // computePlReport) — not the all-time trial balance.
  const periodLabel = useMemo(() => periodDateRange(period).label, [period]);
  const totalRevenue = Number(budgetReport?.meta.periodRevenue ?? 0);
  const totalExpenses = Number(budgetReport?.meta.periodExpense ?? 0);
  const margin = totalRevenue - totalExpenses;
  const budgetTotal = totalRevenue + totalExpenses;

  // Converted to whole units here (once, via lib/money.ts's centsToMajor)
  // rather than at every render/export site below — the server's real
  // ledger (GET /api/gl/trial-balance) is cents (debitCents/creditCents/
  // balanceCents); this screen displays whole currency units.
  const glRows = useMemo(() => (trialBalance?.rows ?? []).map((g) => ({
    accountId: g.accountId,
    code: g.code,
    name: g.name,
    class: g.class,
    normalBalance: g.normalBalance,
    debit: centsToMajor(g.debitCents),
    credit: centsToMajor(g.creditCents),
    balance: centsToMajor(g.balanceCents),
  })), [trialBalance]);
  const filteredGL = glRows.filter((g) => {
    if (!glSearch.trim()) return true;
    const q = glSearch.toLowerCase();
    return g.name.toLowerCase().includes(q) || g.code.includes(q) || g.class.toLowerCase().includes(q);
  });

  function exportGLCsv() {
    const headers = ['code', 'account', 'type', 'normalBalance', 'debit', 'credit', 'balance'];
    const rows = glRows.map((g) => [g.code, g.name, g.class, g.normalBalance, g.debit, g.credit, g.balance]);
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'gl-trial-balance.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="screen-content">
      <TopNav title="Finance" subtitle="Sales, purchases & GL"
        rightEl={
          <button className="btn-fab" style={{ width: 36, height: 36, borderRadius: 10 }}
            onClick={() => { if (tab === 'sales') setShowRecordSale(true); else if (tab === 'purchases') setShowRecordPurchase(true); }}>
            <Plus size={16} />
          </button>
        }
      />

      {/* Tabs */}
      <div className="px-screen" style={{ paddingTop: 12 }}>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {([['overview','Overview'],['sales','Sales'],['purchases','Expenses'],['gl','GL Accounts'],['payroll','Payroll']] as [string,string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as typeof tab)} className={`filter-chip ${tab === id ? 'active' : ''}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="px-screen">
          {/* Month/Quarter/YTD toggle (issue #299) — restored from the
              original design (commit 80ab7db); re-fetches GET
              /api/reports/pl scoped to the selected period (loadBudget
              above) rather than always showing all-time totals. */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 12 }}>
            {BUDGET_PERIODS.map((p) => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: '4px 10px', borderRadius: 100, fontSize: 'var(--fs-2xs)', fontWeight: 700, cursor: 'pointer',
                background: period === p ? 'rgba(74,222,128,0.2)' : 'transparent',
                border: period === p ? '1px solid rgba(74,222,128,0.4)' : '1px solid transparent',
                color: period === p ? 'var(--primary-green)' : 'var(--text-muted)',
              }}>{p.toUpperCase()}</button>
            ))}
          </div>

          <div className="farm-card farm-card-active" style={{ padding: 18, marginBottom: 14 }}>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Budget Overview — {periodLabel}</div>
            {budgetError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{budgetError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--status-ok)' }}>KSh {(totalRevenue/1000).toFixed(0)}K</div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600 }}>Revenue</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--status-critical)' }}>KSh {(totalExpenses/1000).toFixed(0)}K</div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600 }}>Expenses</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: margin > 0 ? 'var(--primary-green)' : 'var(--status-critical)' }}>
                  {margin > 0 ? '+' : ''}KSh {(margin/1000).toFixed(0)}K
                </div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', fontWeight: 600 }}>Net</div>
              </div>
            </div>
            <div className="progress-track" style={{ marginTop: 14 }}>
              <div className="progress-fill" style={{ width: `${budgetTotal > 0 ? Math.min((totalRevenue/budgetTotal)*100,100) : 0}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
              <span>Revenue {budgetTotal > 0 ? Math.round((totalRevenue/budgetTotal)*100) : 0}%</span>
              <span>Expenses {budgetTotal > 0 ? Math.round((totalExpenses/budgetTotal)*100) : 0}%</span>
            </div>
          </div>

          <div className="section-eyebrow" style={{ marginBottom: 10 }}>Batch P&amp;L</div>
          {batchesError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{batchesError}</div>}
          {batches === null && !batchesError && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-dim)', fontSize: 'var(--fs-base)' }}>Loading batch P&amp;L…</div>
          )}
          {batches !== null && (
            <DataTable
              rows={batchPLRows as unknown as Record<string, unknown>[]}
              columns={BATCH_PNL_COLS}
              rowKey={(r) => r.id as string}
              onRowClick={(r) => navigate('batch-detail', { id: r.id as string, code: r.code as string })}
              defaultPageSize={10}
              pageSizes={[10, 20, 50]}
              bodyHeight={220}
              tableId="finance-batchpl"
              emptyText="No batch P&L data."
            />
          )}
          <div style={{ marginBottom: 20 }} />
        </div>
      )}

      {/* ── Sales ── */}
      {tab === 'sales' && (
        <div className="px-screen">
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 'var(--fs-base)' }} placeholder="Search item, batch, method…" value={salesSearch} onChange={e => setSalesSearch(e.target.value)} />
            {salesSearch && <button onClick={() => setSalesSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>}
          </div>
          {salesError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{salesError}</div>}
          {sales === null && !salesError ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-dim)', fontSize: 'var(--fs-base)' }}>Loading sales…</div>
          ) : (
            <DataTable
              rows={filteredSales as unknown as Record<string, unknown>[]}
              columns={SALES_COLS}
              rowKey={(r) => r.id as string}
              defaultPageSize={20}
              pageSizes={[10, 20, 50, 100]}
              bodyHeight={320}
              tableId="finance-sales"
              emptyText="No sales records found."
            />
          )}
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12, marginBottom: 20 }} onClick={() => setShowRecordSale(true)}>
            <Plus size={16} /> Record Sale
          </button>
        </div>
      )}

      {/* ── PURCHASES / EXPENSES ── */}
      {tab === 'purchases' && (
        <div className="px-screen">
          {purchasesError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{purchasesError}</div>}
          {purchases === null && !purchasesError ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-dim)', fontSize: 'var(--fs-base)' }}>Loading purchases…</div>
          ) : (purchases ?? []).length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ marginBottom: 8, color: 'var(--text-dim)' }}><Receipt size={40} aria-hidden="true" /></div>
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>No expenses yet</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Record one below.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {(purchases ?? []).map((p) => (
                <div key={p.id} className="farm-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{itemNameById.get(p.itemId) ?? p.itemId}</div>
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>{p.supplier} · {fmtDate(p.createdAt)}</div>
                    </div>
                    {itemCategoryById.get(p.itemId) && (
                      <span className={`chip ${catChipClass(itemCategoryById.get(p.itemId) as string)}`} style={{ fontSize: 'var(--fs-2xs)' }}>{itemCategoryById.get(p.itemId)}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{p.quantity.toLocaleString()} units</span>
                    <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--status-critical)' }}>KSh {centsToMajor(p.totalCostCents).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 20 }} onClick={() => setShowRecordPurchase(true)}>
            <Plus size={16} /> Record Purchase
          </button>
        </div>
      )}

      {/* ── GL ACCOUNTS ── */}
      {tab === 'gl' && (
        <div className="px-screen">
          <div style={{ padding: '10px 14px', background: 'rgba(96,165,250,0.08)', borderRadius: 12, marginBottom: 14, border: '1px solid rgba(96,165,250,0.2)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 2 }}>General Ledger — {accounts.length} accounts</div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--status-ok)' }}>KSh {centsToMajor(trialBalance?.totalCreditsCents ?? 0).toLocaleString()}</div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Total Credits</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--status-critical)' }}>KSh {centsToMajor(trialBalance?.totalDebitsCents ?? 0).toLocaleString()}</div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Total Debits</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: trialBalance?.balanced ? 'var(--status-ok)' : 'var(--status-critical)' }}>
                  {trialBalance ? (trialBalance.balanced ? 'Balanced' : 'Out of balance') : '—'}
                </div>
                <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>Status</div>
              </div>
            </div>
          </div>

          {glError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{glError}</div>}

          <div style={{ position: 'relative', marginBottom: 14 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input className="farm-input" style={{ paddingLeft: 34, fontSize: 'var(--fs-base)' }} placeholder="Search account, code, type…" value={glSearch} onChange={e => setGlSearch(e.target.value)} />
            {glSearch && <button onClick={() => setGlSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={14} /></button>}
          </div>

          {trialBalance === null && !glError ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-dim)', fontSize: 'var(--fs-base)' }}>Loading trial balance…</div>
          ) : (
            <DataTable
              rows={filteredGL as unknown as Record<string, unknown>[]}
              columns={GL_COLS}
              rowKey={(r) => r.code as string}
              defaultPageSize={20}
              pageSizes={[10, 20, 50]}
              bodyHeight={340}
              tableId="finance-gl"
              emptyText="No GL entries match your search."
            />
          )}

          <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 12, marginBottom: 20 }} onClick={exportGLCsv} disabled={glRows.length === 0}>
            <Download size={14} /> Export GL to CSV
          </button>
        </div>
      )}

      {/* ── PAYROLL ── */}
      {tab === 'payroll' && (
        <div className="px-screen" style={{ marginTop: 8 }}>
          <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }} onClick={() => setShowRunPayroll(true)}>
            <Plus size={14} /> Run Payroll
          </button>

          {payrollError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 12 }}>{payrollError}</div>}

          {payrollRuns === null && <div style={{ padding: 20, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading…</div>}

          {payrollRuns !== null && payrollRuns.length === 0 && !payrollError && (
            <div className="farm-card" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No payroll runs yet</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Set a monthly salary on your employees (People → Edit Employee) then run payroll for a period above.
              </div>
            </div>
          )}

          {payrollRuns !== null && payrollRuns.length > 0 && (
            <div className="farm-card" style={{ overflow: 'hidden' }}>
              {payrollRuns.map((r, i, arr) => (
                <div key={r.id} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <div
                    style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => toggleRunPayslips(r.id)}
                  >
                    <div>
                      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</div>
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>{r.employeeCount} employee{r.employeeCount === 1 ? '' : 's'} paid{r.memo ? ` · ${r.memo}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--primary-green)' }}>{formatMoney(r.totalAmountCents)}</span>
                      <ChevronRight size={14} color="var(--text-dim)" style={{ transform: expandedRunId === r.id ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                    </div>
                  </div>
                  {expandedRunId === r.id && (
                    <div style={{ padding: '0 14px 12px 14px', background: 'var(--card)' }}>
                      {expandedError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', padding: '8px 0' }}>{expandedError}</div>}
                      {!expandedError && expandedPayslips === null && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', padding: '8px 0' }}>Loading payslips…</div>}
                      {!expandedError && expandedPayslips !== null && expandedPayslips.map((p) => (
                        <div key={p.id} style={{ padding: '7px 0', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{p.employeeName}</span>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(p.amountCents)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRecordSale && (
        <RecordSaleSheet
          tenantId={tenantId}
          batches={batches ?? []}
          onCreated={() => { loadSales(); loadGL(); }}
          onClose={() => setShowRecordSale(false)}
        />
      )}
      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={items.map((i) => i.name)}
          farms={farms}
          activeFarmId={activeFarmId}
          onCreated={() => { loadPurchases(); loadGL(); }}
          onClose={() => setShowRecordPurchase(false)}
        />
      )}
      {showRunPayroll && (
        <RunPayrollSheet
          tenantId={tenantId}
          onCreated={() => { loadPayrollRuns(); loadGL(); }}
          onClose={() => setShowRunPayroll(false)}
        />
      )}
    </div>
  );
}
