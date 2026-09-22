'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from './navigation';
import { apiClient } from '@/lib/request';
import { toCsv } from '@/lib/csv';
import { Plus, Search, X, Download, ChevronRight, Receipt } from './icons';
import { DataTable, ColDef } from './data-table';
import type { ReportPayload } from '@/lib/report-types';
import { periodDateRange, BUDGET_PERIODS, type BudgetPeriod } from '@/lib/period-range';
import { parseMoneyToCents, centsToMajor, formatMoney } from '@/lib/money';
import { fieldErrorStyle, FieldError, PaymentMethodFields, SaveConfirmation, SaveError, MasterPicker, useToast, type SaveReceipt, type MasterOption } from './ui-shared';
import { compressImageFile } from '@/lib/image-compress';
import { todayInTimezone } from '@/lib/datetime';
import { useRegional } from './settings';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Segmented } from '@/components/ui-kit/segmented';
import { Button } from '@/components/ui-kit/button';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { Kv } from '@/components/ui-kit/inspector';
import { Dialog, DialogTitle, DialogDescription } from '@/components/ui-kit/dialog';
import { controlClass } from '@/components/ui-kit/field';
import { StatusTimeline } from './status-timeline';

// ── Restyle pass (ui/governance-reference-redesign, package F) ─────────────
// Ports src/components/finance/finance-page.tsx's layout onto this screen's
// exact existing data/logic — no API call, payload shape, permission check
// or validation rule below changed. Hero = the ledger: money in/out/net for
// the selected period, then every existing tab (Overview/Sales/Expenses/GL
// accounts/Payroll) restyled with ui-kit primitives and Tailwind tokens.
// The three record sheets keep their original field markup (labels, input
// attributes, per-field validation) verbatim — only their outer container
// moved from a hand-rolled position:absolute overlay onto ui-kit's Sheet
// (position:fixed, Escape-to-close, safe-area-aware), matching Governance's
// RoleBuilderSheet convention.

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
  // Forms-audit slice / item 20 / item 23 — always present on the real row
  // (GET /api/data/sales selects the whole row); typed here as this screen
  // starts reading them.
  paymentReference: string | null;
  dueDate: string | null;
  soldTo: string | null;
  notes: string | null;
  customerId: string | null;
  reversedAt: string | null;
  recordedBy: string | null;
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
  // Forms-audit slice / item 20 / item 23.
  paymentReference: string | null;
  dueDate: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  photoUrl: string | null;
  supplierId: string | null;
  reversedAt: string | null;
  recordedBy: string | null;
}
interface ApiInventoryItemLite {
  id: string;
  name: string;
  category: string;
  unit: string;
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
// owner-roast finding #2: POST /api/payroll/runs { dryRun: true } — the
// exact same eligibility/overlap/total computation the real run uses,
// stopped before anything is written.
interface PayrollPreview {
  periodStart: string;
  periodEnd: string;
  totalAmountCents: number;
  employeeCount: number;
  employees: { id: string; name: string; amountCents: number }[];
}

function fmtDate(d?: string | null): string {
  return d ? d.slice(0, 10) : '—';
}

const catChipClass = (cat: string) =>
  cat === 'Feed' ? 'chip-ok' : ['Vet', 'Vaccine', 'Medicine'].includes(cat) ? 'chip-purple' : 'chip-info';

/* ── Record Sale sheet — real POST /api/data/sales ──
 *
 * ── Why this sheet now picks a product instead of typing one ──
 * "Item" was a free-text box captioned "e.g. Tray eggs (30) × 120", and the
 * POST body carried only that string — never `productId`, never `qty`. This
 * sheet is the ONLY writer to POST /api/data/sales, and that route decrements
 * batch headcount or collected produce only when it can resolve a product with
 * a `stockEffect` (lib/finance.ts). So every sale recorded here left stock
 * untouched forever: "sold 200 birds" never came off the batch, and the
 * route's own batch_quantity guard and ProduceShortfallError were dead code in
 * practice.
 *
 * The catalogue that fixes it already exists — `products.stockEffect`, and
 * GET /api/products — and components/farm/worker.tsx already builds a picker
 * from it. Free text stays reachable as the explicit "not in the catalogue"
 * option, because an ad-hoc sale (a service, a one-off) is real and the route
 * still accepts `item` alone.
 */
interface ApiProductLite {
  id: string;
  name: string;
  stockEffect: string;
}


function RecordSaleSheet({ tenantId, batches, onCreated, onViewList, onClose }: {
  tenantId: string;
  batches: ApiBatchLite[];
  onCreated: () => void;
  onViewList: () => void;
  onClose: () => void;
}) {
  const { navigate } = useNav();
  const [products, setProducts] = useState<ApiProductLite[] | null>(null);
  const [productId, setProductId] = useState('');
  const [item, setItem] = useState('');
  // Defaults to '1': most sales are one line of one thing. A product that
  // comes out of the batch by count still forces a real number (see
  // `needsQty` below) — this default only ever stands in for a sale that
  // never had a meaningful count to begin with (a service, a mixed lot).
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<'paid' | 'pending'>('paid');
  const [batchId, setBatchId] = useState('');
  const [soldAt, setSoldAt] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [salePostingDate, setSalePostingDate] = useState('');
  const [soldTo, setSoldTo] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<MasterOption[]>([]);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<SaveReceipt | null>(null);
  // owner-roast finding #11: a 0 amount was already refused on save, but as
  // a generic banner with no mark on the field itself — the input still
  // looked exactly as submittable as a valid one. Per-field, same mechanism
  // as ui-shared.tsx's fieldErrorStyle/FieldError.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // item 20: the customer master a "Sold to" MasterPicker resolves or
  // creates against — active only, since a customer marked inactive
  // shouldn't come back in a picker's suggestions.
  useEffect(() => {
    apiClient.get<MasterOption[]>(`/api/customers?tenantId=${tenantId}&active=true`).then((res) => {
      if (res.success) setCustomers(res.data);
    });
  }, [tenantId]);

  async function createCustomer() {
    const name = soldTo.trim();
    if (!name) return;
    setCreatingCustomer(true);
    const res = await apiClient.post<MasterOption>('/api/customers', { tenantId, name });
    setCreatingCustomer(false);
    if (res.success) {
      setCustomers((prev) => [...prev, res.data]);
      setCustomerId(res.data.id);
    }
  }

  useEffect(() => {
    apiClient.get<ApiProductLite[]>('/api/products').then((res) => {
      setProducts(res.success ? res.data : []);
    });
  }, []);

  // Credit is a shortcut, not a separate field: choosing it is what "means
  // unpaid" (item 2) — status flips to pending and the due date appears.
  // Picking a different method afterwards flips it back, same as before
  // this existed (a manual PAID/PENDING toggle for the cash-not-yet-
  // collected case still stands on its own for every other method).
  function onMethodChange(next: string) {
    setMethod(next);
    if (next === 'Credit') setStatus('pending');
    else if (method === 'Credit') { setStatus('paid'); setDueDate(''); }
  }

  const product = (products ?? []).find((p) => p.id === productId) ?? null;
  // A product that comes out of the batch needs a count, or the sale records
  // revenue against a headcount that never moved. The route refuses this case
  // too — this is the courtesy copy so the user finds out before submitting.
  const needsQty = !!product && product.stockEffect === 'batch_quantity' && !!batchId;
  // Today, as a yyyy-mm-dd `max` for the date input — in the FARM's own
  // timezone (item 18), not the browser's. A future-dated sale drops out of
  // every P&L period while staying in the trial balance; "future" has to
  // mean the farm's midnight, not whatever zone the device happens to be set
  // to (an owner traveling, or simply on UTC-driven infra, must not have a
  // real today's sale refused as "in the future").
  const { timezone } = useRegional();
  const todayIso = todayInTimezone(timezone);

  // ── Money that adds up (item 3) ────────────────────────────────────────
  // Quantity x unit price = total, calculated here and shown — never a lone
  // typed figure. The TOTAL is still what gets stored as `amountCents`, so
  // nothing downstream (P&L, trial balance, a report) changes meaning.
  const unitPriceCents = parseMoneyToCents(unitPrice);
  const qtyForTotal = qty.trim() === '' ? 1 : Number(qty);
  const totalCents = unitPriceCents !== null && Number.isFinite(qtyForTotal) && qtyForTotal > 0
    ? unitPriceCents * Math.max(1, Math.trunc(qtyForTotal))
    : null;

  async function save() {
    const label = productId ? (product?.name ?? '') : item.trim();
    const qtyNum = qty.trim() === '' ? null : Number(qty);

    const errs: Record<string, string> = {};
    if (!label) errs.item = 'Choose a product, or name what was sold';
    if (unitPriceCents === null || unitPriceCents <= 0) errs.unitPrice = 'Unit price must be a positive number — 0 is not a sale';
    if (qtyNum !== null && (!Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isInteger(qtyNum))) {
      errs.qty = 'Quantity must be a whole number greater than zero';
    } else if (needsQty && qtyNum === null) {
      errs.qty = `${product?.name} comes out of the batch when sold — enter how many`;
    }
    if (soldAt && soldAt > todayIso) errs.soldAt = 'A sale cannot be dated in the future';
    if (effectiveDate && effectiveDate > todayIso) errs.effectiveDate = 'The effective date cannot be in the future';
    if (salePostingDate && salePostingDate > todayIso) errs.salePostingDate = 'The posting date cannot be in the future';
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('');
      return;
    }
    setFieldErrors({});

    const amountCents = totalCents as number;
    setSaving(true);
    setError('');
    const res = await apiClient.post<{ id: string }>('/api/data/sales', {
      tenantId,
      productId: productId || undefined,
      item: label,
      qty: qtyNum ?? undefined,
      amountCents,
      method: method.trim() || undefined,
      paymentReference: reference.trim() || undefined,
      status,
      batchId: batchId || undefined,
      soldAt: soldAt || undefined,
      soldTo: soldTo.trim() || undefined,
      customerId: customerId || undefined,
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
      effectiveDate: effectiveDate || undefined,
      postingDate: salePostingDate || undefined,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      setReceipt({
        id: res.data?.id,
        totalLabel: 'Total',
        totalCents: amountCents,
        stockEffect: needsQty && qtyNum ? `${qtyNum} × ${product?.name} out of ${batches.find((b) => b.id === batchId)?.code ?? 'the batch'}` : undefined,
      });
    } else {
      setError(res.error || 'Failed to record sale.');
    }
  }

  if (receipt) {
    return (
      <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
        <SheetTitle className="sr-only">Sale recorded</SheetTitle>
        <SaveConfirmation title="Sale recorded" receipt={receipt} onViewList={onViewList} onDone={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
      {/* item 15: a sticky footer keeps Record Sale reachable without
          scrolling past every field first, on a long sheet on a phone. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-4">
          <SheetTitle className="mb-3.5">Record Sale</SheetTitle>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>What was sold *</label>
            {products !== null && products.length === 0 ? (
              // ── Honest empty state, not a fake picker ──────────────────────
              // A dropdown whose only option is "Not in the catalogue" when the
              // catalogue has zero products isn't a picker at all — it quietly
              // admits Products setup never happened while still looking like
              // the feature works. Say that plainly and point at Products,
              // rather than routing straight to free text as if this were the
              // normal path.
              <div style={{ padding: '10px 12px', background: 'rgba(var(--warning-rgb),0.06)', border: '1px solid rgba(var(--warning-rgb),0.2)', borderRadius: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
                  No products set up yet, so sales cannot draw down stock. Set up products first, or record this as a one-off below.
                </div>
                <button type="button" className="btn-secondary" style={{ fontSize: 'var(--fs-xs)' }} onClick={() => { onClose(); navigate('crops', { tab: 'products' }); }}>
                  Set up Products
                </button>
              </div>
            ) : (
              <select
                className="farm-input"
                value={productId}
                onChange={e => { setProductId(e.target.value); if (e.target.value) setItem(''); }}
                style={{ marginBottom: productId ? 0 : 8 }}
              >
                <option value="">{products === null ? 'Loading products…' : 'Not in the catalogue — type it below'}</option>
                {(products ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {/* The escape hatch, and the only path that leaves stock untouched.
                Kept because an ad-hoc sale — a service, a one-off — is real. */}
            {!productId && (
              <input className="farm-input" placeholder="e.g. Tray eggs (30) × 120" value={item} onChange={e => setItem(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.item)}
                aria-invalid={!!fieldErrors.item} aria-describedby={fieldErrors.item ? 'sale-item-error' : undefined} />
            )}
            {products !== null && products.length === 0 && (
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                No products in the catalogue yet, so this sale cannot move stock. Add products to have sales draw down birds or produce.
              </div>
            )}
            <FieldError id="sale-item-error" message={fieldErrors.item} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Unit price (KSh) *</label>
              <input className="farm-input" type="number" min="0.01" step="0.01" placeholder="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.unitPrice)}
                aria-invalid={!!fieldErrors.unitPrice} aria-describedby={fieldErrors.unitPrice ? 'sale-unitprice-error' : undefined} />
              <FieldError id="sale-unitprice-error" message={fieldErrors.unitPrice} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>
                Quantity{needsQty ? ' *' : ''}
              </label>
              <input
                className="farm-input" type="number" inputMode="numeric" min="1" step="1"
                placeholder={needsQty ? 'Required' : '1'}
                value={qty} onChange={e => setQty(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.qty)}
                aria-invalid={!!fieldErrors.qty} aria-describedby={fieldErrors.qty ? 'sale-qty-error' : undefined}
              />
              <FieldError id="sale-qty-error" message={fieldErrors.qty} />
            </div>
          </div>
          {/* The calculated total — never a lone typed figure. This is the
              exact number that gets stored, shown before it's committed to. */}
          <div className="mb-3 flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2.5">
            <span className="text-xs font-semibold text-muted">Total</span>
            <span className="font-display text-lg font-medium text-primary">{totalCents !== null ? formatMoney(totalCents) : '—'}</span>
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
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Sale date</label>
              {/* Capped at today: a future-dated sale drops out of every P&L
                  period while staying in the trial balance, and the two can then
                  never be reconciled. */}
              <input className="farm-input" type="date" max={todayIso} value={soldAt} onChange={e => setSoldAt(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.soldAt)}
                aria-invalid={!!fieldErrors.soldAt} aria-describedby={fieldErrors.soldAt ? 'sale-solddate-error' : undefined} />
              <FieldError id="sale-solddate-error" message={fieldErrors.soldAt} />
            </div>
          </div>
          {/* item 18: the effective date — when the stock/service actually
              took effect, if that ever differs from the sale itself (a
              dispatch that trails the sale by a day or two). Left blank, it
              defaults to Sale date, and the ledger posting date defaults to
              THIS — the form says so rather than hiding a silent default. */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Effective date (optional)</label>
            <input className="farm-input" type="date" max={todayIso} value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
              style={fieldErrorStyle(!!fieldErrors.effectiveDate)}
              aria-invalid={!!fieldErrors.effectiveDate} aria-describedby={fieldErrors.effectiveDate ? 'sale-effectivedate-error' : undefined} />
            <FieldError id="sale-effectivedate-error" message={fieldErrors.effectiveDate} />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">When the stock or service actually took effect, if different from Sale date. Defaults to Sale date.</p>
          </div>
          {/* The period this counts in, defaulting to the effective date and
              through it to Sale date — so leaving both blank behaves exactly
              as before. Exposed so a sale entered after month-end can still
              be posted to the month it belongs to. */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Posting date (optional)</label>
            <input className="farm-input" type="date" max={todayIso} value={salePostingDate} onChange={e => setSalePostingDate(e.target.value)}
              style={fieldErrorStyle(!!fieldErrors.salePostingDate)}
              aria-invalid={!!fieldErrors.salePostingDate} aria-describedby={fieldErrors.salePostingDate ? 'sale-postingdate-error' : undefined} />
            <FieldError id="sale-postingdate-error" message={fieldErrors.salePostingDate} />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">Which month this counts in on reports and the trial balance. Defaults to the effective date.</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <PaymentMethodFields method={method} onMethodChange={onMethodChange} reference={reference} onReferenceChange={setReference} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Status</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {(['paid', 'pending'] as const).map(s => (
                <button key={s} onClick={() => setStatus(s)} style={{
                  padding: '9px 8px', borderRadius: 10, fontSize: 'var(--fs-xs)', fontWeight: 700, cursor: 'pointer',
                  background: status === s ? 'rgba(var(--primary-rgb),0.1)' : 'var(--card)',
                  border: status === s ? '1px solid rgba(var(--primary-rgb),0.3)' : '1px solid var(--border-subtle)',
                  color: status === s ? 'var(--primary-green)' : 'var(--text-muted)',
                }}>{s.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {/* Credit means unpaid (item 2): amount due and a due date, shown
              only once there is an unpaid balance to chase. */}
          {status === 'pending' && (
            <div style={{ marginBottom: 12 }}>
              <div className="mb-2 flex items-center justify-between rounded-lg bg-warning-soft px-3 py-2 text-xs">
                <span className="font-semibold text-warning">Amount due</span>
                <span className="font-medium text-fg">{totalCents !== null ? formatMoney(totalCents) : '—'}</span>
              </div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Due date</label>
              <input className="farm-input" type="date" min={todayIso} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <MasterPicker
              label="Sold to (optional)" listId="sale-customers" options={customers}
              name={soldTo} onNameChange={setSoldTo} onResolvedChange={setCustomerId}
              onCreate={createCustomer} creating={creatingCustomer} placeholder="e.g. Mama Njeri"
            />
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
            <textarea className="farm-input" rows={2} style={{ resize: 'none' }} placeholder="Anything worth remembering about this sale" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="shrink-0 border-t border-border bg-surface px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && <SaveError message={error} onSetupDimensions={() => { onClose(); navigate('dimensions'); }} />}
          <Button className="w-full justify-center" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Record Sale'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── Record Purchase/Expense sheet — real POST /api/purchases (same route
 * Inventory's Purchases tab uses; there is no expense-only concept in the
 * backend separate from a stock purchase). No edit/PATCH UI — GET/POST are
 * the only verbs the route supports. ── */
function RecordPurchaseSheet({ tenantId, itemNames, categories, units, farms, activeFarmId, onCreated, onViewList, onClose }: {
  tenantId: string;
  itemNames: string[];
  // Suggestions only — every one of these is a combobox (input + datalist),
  // not a hard select, so a new category/unit a farmer genuinely hasn't
  // used before still gets recorded verbatim. Built from this tenant's own
  // purchase/inventory history (see FinanceScreen), not invented — an empty
  // list here degrades to a plain text field for free, since an empty
  // <datalist> shows no suggestions at all. Supplier (item 20) is now its
  // own fetched master list instead of a history-derived suggestion — see
  // the `suppliers` state below.
  categories: string[];
  units: string[];
  // farm-scoped-data task — see components/farm/inventory.tsx's
  // RecordPurchaseSheet for the identical rationale: a purchase and the lot
  // it creates always land at the same farm, so this can never be optional
  // the way a task's farm can.
  farms: { id: string; name: string }[];
  activeFarmId: string;
  onCreated: () => void;
  onViewList: () => void;
  onClose: () => void;
}) {
  const { navigate } = useNav();
  const [supplier, setSupplier] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<MasterOption[]>([]);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [reference, setReference] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [transactionDate, setTransactionDate] = useState('');
  const [postingDate, setPostingDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  // owner-roast finding #10: with a single farm and the shell's filter on
  // 'ALL', this used to stay '' — a disabled "Select a farm…" placeholder
  // with nothing else it could sanely be, forcing a selection that has only
  // one honest answer. Multiple farms still start blank on purpose (see the
  // inventory sheet's identical comment): guessing which of several farms
  // this stock landed at would be worse than asking.
  const [farmId, setFarmId] = useState(activeFarmId !== 'ALL' ? activeFarmId : (farms.length === 1 ? farms[0].id : ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<SaveReceipt | null>(null);
  // owner-roast finding #10: the banner used to say "Supplier, item, and
  // unit are required" while silently skipping farm — the checks returned
  // one at a time instead of being collected together. Per-field, same
  // mechanism as ui-shared.tsx's fieldErrorStyle/FieldError.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // item 18: the farm's own timezone, not the browser's — see the sale
  // sheet's identical comment.
  const { timezone } = useRegional();
  const todayIso = todayInTimezone(timezone);
  const qtyNum = Number(quantity);
  const unitCostCentsLive = parseMoneyToCents(unitCost);
  const totalCentsLive = Number.isFinite(qtyNum) && qtyNum > 0 && unitCostCentsLive !== null ? qtyNum * unitCostCentsLive : null;
  const amountPaidCentsLive = amountPaid ? parseMoneyToCents(amountPaid) : 0;
  const amountDueCents = totalCentsLive !== null ? Math.max(0, totalCentsLive - (amountPaidCentsLive ?? 0)) : null;

  // Credit means unpaid (item 2): choosing it locks "Paid now" at 0 and
  // reveals the due date. A different method afterwards hands control of
  // "Paid now" back to the owner rather than guessing what they paid.
  function onMethodChange(next: string) {
    setPaymentMethod(next);
    if (next === 'Credit') setAmountPaid('0');
    else if (paymentMethod === 'Credit') { setAmountPaid(''); setDueDate(''); }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoBusy(true); setPhotoError('');
    try {
      setPhoto(await compressImageFile(file));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Couldn't add that photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  // item 20: the supplier master the picker resolves or creates against.
  useEffect(() => {
    apiClient.get<MasterOption[]>(`/api/suppliers?tenantId=${tenantId}&active=true`).then((res) => {
      if (res.success) setSuppliers(res.data);
    });
  }, [tenantId]);

  async function createSupplier() {
    const name = supplier.trim();
    if (!name) return;
    setCreatingSupplier(true);
    const res = await apiClient.post<MasterOption>('/api/suppliers', { tenantId, name });
    setCreatingSupplier(false);
    if (res.success) {
      setSuppliers((prev) => [...prev, res.data]);
      setSupplierId(res.data.id);
    }
  }

  async function save() {
    const qty = Number(quantity);
    const unitCostCents = parseMoneyToCents(unitCost);
    const amountPaidCents = amountPaid ? parseMoneyToCents(amountPaid) : null;

    const errs: Record<string, string> = {};
    if (!farmId) errs.farmId = 'Select which farm this stock is for';
    if (!supplier.trim()) errs.supplier = 'Supplier is required';
    if (!itemName.trim()) errs.itemName = 'Item is required';
    if (!unit.trim()) errs.unit = 'Unit is required';
    if (!Number.isFinite(qty) || qty <= 0) errs.quantity = 'Quantity must be a positive number';
    // Same rule as the inventory sheet and the server: an `integer` column
    // cannot hold a fraction, and truncating it silently erased the money.
    else if (!Number.isInteger(qty)) errs.quantity = `Quantity must be a whole number of ${unit.trim() || 'units'}`;
    if (unitCostCents === null || unitCostCents < 0) errs.unitCost = 'Unit cost must be a non-negative number';
    if (amountPaid && amountPaidCents === null) errs.amountPaid = 'Paid now must be a number';
    else if (amountPaidCents !== null && amountPaidCents < 0) errs.amountPaid = 'Paid now cannot be negative';
    else if (amountPaidCents !== null && unitCostCents !== null && amountPaidCents > qty * unitCostCents) {
      errs.amountPaid = 'Paid now is more than the purchase total';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('');
      return;
    }
    setFieldErrors({});

    const totalCents = qty * (unitCostCents as number);
    setSaving(true);
    setError('');
    const res = await apiClient.post<{ id: string }>('/api/purchases', {
      tenantId,
      supplier: supplier.trim(),
      supplierId: supplierId || undefined,
      itemName: itemName.trim(),
      category: category.trim() || undefined,
      unit: unit.trim(),
      quantity: qty,
      unitCostCents,
      paymentMethod: paymentMethod.trim() || undefined,
      paymentReference: reference.trim() || undefined,
      amountPaidCents: amountPaidCents ?? undefined,
      invoiceNumber: invoiceNumber.trim() || undefined,
      receivedDate: receivedDate || undefined,
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
      photoUrl: photo || undefined,
      transactionDate: transactionDate || undefined,
      postingDate: postingDate || undefined,
      farmId,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      setReceipt({
        id: (res.data as { purchase?: { id?: string } }).purchase?.id,
        totalLabel: 'Total',
        totalCents,
        stockEffect: `${qty} ${unit.trim()} of ${itemName.trim()} added to Inventory`,
      });
    } else {
      setError(res.error || 'Failed to record purchase.');
    }
  }

  if (receipt) {
    return (
      <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
        <SheetTitle className="sr-only">Purchase recorded</SheetTitle>
        <SaveConfirmation title="Purchase recorded" receipt={receipt} onViewList={onViewList} onDone={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
      {/* item 15: sticky footer keeps Record Purchase reachable on a long
          sheet without scrolling past every field first. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-4">
          <SheetTitle className="mb-3.5">Record Purchase / Expense</SheetTitle>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
            This also brings the item into Inventory stock — there is no expense-only record separate from a purchase.
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm *</label>
            <select className="farm-input" value={farmId} onChange={e => setFarmId(e.target.value)}
              style={fieldErrorStyle(!!fieldErrors.farmId)}
              aria-invalid={!!fieldErrors.farmId} aria-describedby={fieldErrors.farmId ? 'purchase-farm-error' : undefined}>
              <option value="" disabled>Select a farm…</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <FieldError id="purchase-farm-error" message={fieldErrors.farmId} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <MasterPicker
              label="Supplier *" listId="finance-suppliers" options={suppliers}
              name={supplier} onNameChange={setSupplier} onResolvedChange={setSupplierId}
              onCreate={createSupplier} creating={creatingSupplier} placeholder="e.g. Unga Ltd"
            />
            <FieldError id="purchase-supplier-error" message={fieldErrors.supplier} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Item *</label>
            <input className="farm-input" list="finance-item-names" placeholder="e.g. dairy meal, maize seed" value={itemName} onChange={e => setItemName(e.target.value)}
              style={fieldErrorStyle(!!fieldErrors.itemName)}
              aria-invalid={!!fieldErrors.itemName} aria-describedby={fieldErrors.itemName ? 'purchase-item-error' : undefined} />
            <datalist id="finance-item-names">
              {itemNames.map(n => <option key={n} value={n} />)}
            </datalist>
            <FieldError id="purchase-item-error" message={fieldErrors.itemName} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Category</label>
              <input className="farm-input" list="finance-categories" placeholder="e.g. Feed" value={category} onChange={e => setCategory(e.target.value)} />
              <datalist id="finance-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Unit *</label>
              <input className="farm-input" list="finance-units" placeholder="e.g. kg" value={unit} onChange={e => setUnit(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.unit)}
                aria-invalid={!!fieldErrors.unit} aria-describedby={fieldErrors.unit ? 'purchase-unit-error' : undefined} />
              <datalist id="finance-units">
                {units.map(u => <option key={u} value={u} />)}
              </datalist>
              <FieldError id="purchase-unit-error" message={fieldErrors.unit} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Quantity *</label>
              <input className="farm-input" type="number" placeholder="0" value={quantity} onChange={e => setQuantity(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.quantity)}
                aria-invalid={!!fieldErrors.quantity} aria-describedby={fieldErrors.quantity ? 'purchase-qty-error' : undefined} />
              <FieldError id="purchase-qty-error" message={fieldErrors.quantity} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Unit cost (KSh) *</label>
              <input className="farm-input" type="number" placeholder="0" value={unitCost} onChange={e => setUnitCost(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.unitCost)}
                aria-invalid={!!fieldErrors.unitCost} aria-describedby={fieldErrors.unitCost ? 'purchase-unitcost-error' : undefined} />
              <FieldError id="purchase-unitcost-error" message={fieldErrors.unitCost} />
            </div>
          </div>
          <div className="mb-3 flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2.5">
            <span className="text-xs font-semibold text-muted">Total</span>
            <span className="font-display text-lg font-medium text-primary">{totalCentsLive !== null ? formatMoney(totalCentsLive) : '—'}</span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <PaymentMethodFields method={paymentMethod} onMethodChange={onMethodChange} reference={reference} onReferenceChange={setReference} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Paid now (KSh)</label>
              <input className="farm-input" type="number" placeholder="0 if unpaid" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                disabled={paymentMethod === 'Credit'}
                style={fieldErrorStyle(!!fieldErrors.amountPaid)}
                aria-invalid={!!fieldErrors.amountPaid} aria-describedby={fieldErrors.amountPaid ? 'purchase-amountpaid-error' : undefined} />
              <FieldError id="purchase-amountpaid-error" message={fieldErrors.amountPaid} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Amount due</label>
              <div className="farm-input flex items-center" style={{ color: 'var(--text-muted)', background: 'var(--card)' }}>
                {amountDueCents !== null ? formatMoney(amountDueCents) : '—'}
              </div>
            </div>
          </div>
          {/* Credit means unpaid (item 2): a due date once there's a balance to chase. */}
          {(paymentMethod === 'Credit' || (amountDueCents ?? 0) > 0) && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Due date</label>
              <input className="farm-input" type="date" min={todayIso} value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Invoice / receipt no. (optional)</label>
              <input className="farm-input" placeholder="e.g. INV-00231" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Received date</label>
              <input className="farm-input" type="date" max={todayIso} value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
            </div>
          </div>
          {/* item 18: when the purchase transaction itself happened (placing
              the order, the supplier's invoice date), if that ever differs
              from when the stock actually arrived. Defaults to Received
              date, and so does the ledger posting date. */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Transaction date (optional)</label>
            <input className="farm-input" type="date" max={todayIso} value={transactionDate} onChange={e => setTransactionDate(e.target.value)} />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">When the purchase itself happened, if different from Received date. Defaults to Received date.</p>
          </div>
          {/* The period this counts in. It defaults to the transaction date,
              which itself defaults to Received date — so leaving all three
              blank behaves exactly as it always has. Exposed because a farm
              closing off a month needs to say "this belongs to September"
              for a delivery entered in October, and until this field existed
              there was no way to say it (or to check that reports honour it). */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Posting date (optional)</label>
            <input className="farm-input" type="date" max={todayIso} value={postingDate} onChange={e => setPostingDate(e.target.value)} />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">Which month this counts in on reports and the trial balance. Defaults to the transaction date.</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Notes (optional)</label>
            <textarea className="farm-input" rows={2} style={{ resize: 'none' }} placeholder="Anything worth remembering about this purchase" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div style={{ marginBottom: 4 }}>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Receipt photo (optional)</label>
            {photo && (
              <img src={photo} alt="Receipt" className="mb-2 max-h-40 w-full rounded-lg object-cover" />
            )}
            <label className={cn(
              'flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary-soft text-sm font-semibold text-primary',
              photoBusy ? 'opacity-60' : 'cursor-pointer',
            )}>
              {photoBusy ? 'Adding…' : photo ? 'Retake photo' : 'Add a photo'}
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" disabled={photoBusy} />
            </label>
            {photoError && <p className="mt-1 text-xs text-danger">{photoError}</p>}
          </div>
        </div>
        <div className="shrink-0 border-t border-border bg-surface px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && <SaveError message={error} onSetupDimensions={() => { onClose(); navigate('dimensions'); }} />}
          <Button className="w-full justify-center" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Record Purchase'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

const detailLabelStyle: React.CSSProperties = { fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };

/* ── Sale detail: edit (reason required) + reverse + history (item 23) ──────
 * "Edit a sale, purchase or expense with a required reason, storing before/
 * after values and who changed them" + "Reverse a posted row with a contra
 * entry — never a delete, never an in-place rewrite of a posted figure" +
 * "A per-record history panel, the same trust treatment StatusTimeline
 * already gives tasks." All three live here: PATCH /api/data/sales/[id]
 * (reason required, restricted to fields that don't drive the ledger — see
 * that route's own comment for exactly which and why), POST .../reverse
 * (reason required, posts a contra entry, marks reversedAt), and
 * <StatusTimeline entity="sale" .../> reading back both as audit_log rows.
 * A reversed sale shows neither action — it is done, permanently, by design. */
function SaleDetailSheet({ tenantId, sale, onClose, onChanged }: {
  tenantId: string;
  sale: ApiSale;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [item, setItem] = useState(sale.item);
  const [soldTo, setSoldTo] = useState(sale.soldTo ?? '');
  const [paymentReference, setPaymentReference] = useState(sale.paymentReference ?? '');
  const [dueDate, setDueDate] = useState(sale.dueDate ? sale.dueDate.slice(0, 10) : '');
  const [notes, setNotes] = useState(sale.notes ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showReverse, setShowReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const reversed = !!sale.reversedAt;

  async function saveEdit() {
    if (!reason.trim()) { setError('A reason is required'); return; }
    if (!item.trim()) { setError('Item cannot be blank'); return; }
    setSaving(true); setError('');
    const res = await apiClient.patch(`/api/data/sales/${sale.id}`, {
      tenantId, reason: reason.trim(), item: item.trim(),
      soldTo: soldTo.trim() || null, paymentReference: paymentReference.trim() || null,
      dueDate: dueDate || null, notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.success) { showToast('Sale updated', 'success'); onChanged(); setMode('view'); setReason(''); }
    else setError(res.error ?? 'Could not update this sale');
  }

  async function confirmReverse() {
    if (!reverseReason.trim()) return;
    setReversing(true); setReverseError('');
    const res = await apiClient.post(`/api/data/sales/${sale.id}/reverse`, { tenantId, reason: reverseReason.trim() });
    setReversing(false);
    if (res.success) { showToast('Sale reversed', 'success'); setShowReverse(false); onChanged(); onClose(); }
    else setReverseError(res.error ?? 'Could not reverse this sale');
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <SheetTitle className="truncate">{sale.item}</SheetTitle>
          {reversed && <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger">Reversed</span>}
        </div>
        <p className="mb-4 text-sm text-muted">{fmtDate(sale.soldAt)} · {sale.method || 'No method recorded'}</p>

        {mode === 'view' && (
          <>
            <div className="mb-4 rounded-xl bg-surface-2 px-3.5">
              <Kv label="Amount" value={formatMoney(sale.amountCents)} />
              <Kv label="Status" value={sale.status} />
              <Kv label="Sold to" value={sale.soldTo || '—'} />
              <Kv label="Payment reference" value={sale.paymentReference || '—'} />
              <Kv label="Due date" value={fmtDate(sale.dueDate)} />
              <Kv label="Notes" value={sale.notes || '—'} />
            </div>
            {reversed ? (
              <p className="mb-4 text-sm text-muted">This sale was reversed and can no longer be edited.</p>
            ) : (
              <div className="mb-4 flex gap-2">
                <Button variant="secondary" className="flex-1 justify-center" onClick={() => setMode('edit')}>Edit</Button>
                <Button variant="outline" className="flex-1 justify-center" onClick={() => setShowReverse(true)}>Reverse</Button>
              </div>
            )}
            <StatusTimeline tenantId={tenantId} entity="sale" entityId={sale.id} />
          </>
        )}

        {mode === 'edit' && (
          <div className="flex flex-col gap-3">
            <div>
              <label style={detailLabelStyle}>Item</label>
              <input className="farm-input" value={item} onChange={(e) => setItem(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Sold to</label>
              <input className="farm-input" value={soldTo} onChange={(e) => setSoldTo(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Payment reference</label>
              <input className="farm-input" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Due date</label>
              <input type="date" className="farm-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Notes</label>
              <textarea className="farm-input" style={{ minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Reason for this change (required)</label>
              <textarea className="farm-input" style={{ minHeight: 60 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Buyer's name was misspelled" />
            </div>
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{error}</div>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 justify-center" disabled={saving} onClick={() => { setMode('view'); setError(''); }}>Cancel</Button>
              <Button className="flex-1 justify-center" disabled={saving || !reason.trim()} onClick={saveEdit}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showReverse} onOpenChange={(o) => { if (!o) setShowReverse(false); }}>
        <DialogTitle>Reverse this sale?</DialogTitle>
        <DialogDescription>
          This posts a contra entry that cancels {formatMoney(sale.amountCents)} from the ledger — &quot;{sale.item}&quot; stays on record, marked reversed, never deleted.
        </DialogDescription>
        <textarea
          className={cn(controlClass, 'mt-2 h-24 resize-none py-2 text-base')}
          value={reverseReason}
          onChange={(e) => setReverseReason(e.target.value)}
          placeholder="Why is this being reversed?"
          autoFocus
        />
        {reverseError && <div className="mt-2 text-sm text-danger">{reverseError}</div>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="h-11 flex-1" onClick={() => setShowReverse(false)} disabled={reversing}>Cancel</Button>
          <Button variant="outline" className="h-11 flex-1" disabled={reversing || !reverseReason.trim()} onClick={confirmReverse}>
            {reversing ? 'Reversing…' : 'Reverse sale'}
          </Button>
        </div>
      </Dialog>
    </Sheet>
  );
}

/* ── Purchase detail: edit (reason required) + reverse + history (item 23) ──
 * Same shape as SaleDetailSheet above — see that component's comment. */
function PurchaseDetailSheet({ tenantId, purchase, itemLabel, onClose, onChanged }: {
  tenantId: string;
  purchase: ApiPurchase;
  itemLabel: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [supplier, setSupplier] = useState(purchase.supplier);
  const [paymentReference, setPaymentReference] = useState(purchase.paymentReference ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(purchase.invoiceNumber ?? '');
  const [dueDate, setDueDate] = useState(purchase.dueDate ? purchase.dueDate.slice(0, 10) : '');
  const [notes, setNotes] = useState(purchase.notes ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showReverse, setShowReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const reversed = !!purchase.reversedAt;

  async function saveEdit() {
    if (!reason.trim()) { setError('A reason is required'); return; }
    if (!supplier.trim()) { setError('Supplier cannot be blank'); return; }
    setSaving(true); setError('');
    const res = await apiClient.patch(`/api/purchases/${purchase.id}`, {
      tenantId, reason: reason.trim(), supplier: supplier.trim(),
      paymentReference: paymentReference.trim() || null, invoiceNumber: invoiceNumber.trim() || null,
      dueDate: dueDate || null, notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.success) { showToast('Purchase updated', 'success'); onChanged(); setMode('view'); setReason(''); }
    else setError(res.error ?? 'Could not update this purchase');
  }

  async function confirmReverse() {
    if (!reverseReason.trim()) return;
    setReversing(true); setReverseError('');
    const res = await apiClient.post(`/api/purchases/${purchase.id}/reverse`, { tenantId, reason: reverseReason.trim() });
    setReversing(false);
    if (res.success) { showToast('Purchase reversed', 'success'); setShowReverse(false); onChanged(); onClose(); }
    else setReverseError(res.error ?? 'Could not reverse this purchase');
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <SheetTitle className="truncate">{itemLabel}</SheetTitle>
          {reversed && <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger">Reversed</span>}
        </div>
        <p className="mb-4 text-sm text-muted">{fmtDate(purchase.createdAt)} · {purchase.supplier}</p>

        {mode === 'view' && (
          <>
            <div className="mb-4 rounded-xl bg-surface-2 px-3.5">
              <Kv label="Total cost" value={formatMoney(purchase.totalCostCents)} />
              <Kv label="Amount paid" value={formatMoney(purchase.amountPaidCents)} />
              <Kv label="Supplier" value={purchase.supplier} />
              <Kv label="Invoice number" value={purchase.invoiceNumber || '—'} />
              <Kv label="Payment reference" value={purchase.paymentReference || '—'} />
              <Kv label="Due date" value={fmtDate(purchase.dueDate)} />
              <Kv label="Notes" value={purchase.notes || '—'} />
            </div>
            {reversed ? (
              <p className="mb-4 text-sm text-muted">This purchase was reversed and can no longer be edited.</p>
            ) : (
              <div className="mb-4 flex gap-2">
                <Button variant="secondary" className="flex-1 justify-center" onClick={() => setMode('edit')}>Edit</Button>
                <Button variant="outline" className="flex-1 justify-center" onClick={() => setShowReverse(true)}>Reverse</Button>
              </div>
            )}
            <StatusTimeline tenantId={tenantId} entity="purchase" entityId={purchase.id} />
          </>
        )}

        {mode === 'edit' && (
          <div className="flex flex-col gap-3">
            <div>
              <label style={detailLabelStyle}>Supplier</label>
              <input className="farm-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Invoice number</label>
              <input className="farm-input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Payment reference</label>
              <input className="farm-input" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Due date</label>
              <input type="date" className="farm-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Notes</label>
              <textarea className="farm-input" style={{ minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label style={detailLabelStyle}>Reason for this change (required)</label>
              <textarea className="farm-input" style={{ minHeight: 60 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier name was misspelled" />
            </div>
            {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)' }}>{error}</div>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1 justify-center" disabled={saving} onClick={() => { setMode('view'); setError(''); }}>Cancel</Button>
              <Button className="flex-1 justify-center" disabled={saving || !reason.trim()} onClick={saveEdit}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showReverse} onOpenChange={(o) => { if (!o) setShowReverse(false); }}>
        <DialogTitle>Reverse this purchase?</DialogTitle>
        <DialogDescription>
          This posts a contra entry that cancels {formatMoney(purchase.totalCostCents)} from the ledger — the purchase stays on record, marked reversed, never deleted. Stock already received is not automatically written off; adjust the lot separately if needed.
        </DialogDescription>
        <textarea
          className={cn(controlClass, 'mt-2 h-24 resize-none py-2 text-base')}
          value={reverseReason}
          onChange={(e) => setReverseReason(e.target.value)}
          placeholder="Why is this being reversed?"
          autoFocus
        />
        {reverseError && <div className="mt-2 text-sm text-danger">{reverseError}</div>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="h-11 flex-1" onClick={() => setShowReverse(false)} disabled={reversing}>Cancel</Button>
          <Button variant="outline" className="h-11 flex-1" disabled={reversing || !reverseReason.trim()} onClick={confirmReverse}>
            {reversing ? 'Reversing…' : 'Reverse purchase'}
          </Button>
        </div>
      </Dialog>
    </Sheet>
  );
}

/* ── Supplier / customer balances (item 20) ──────────────────────────────────
 * "A balance view per supplier and per customer computed from unpaid rows —
 * no new ledger concepts, just a sum." GET /api/suppliers and /api/customers
 * already return that sum per row (balanceCents); this just lists it. One
 * component, one `kind` prop, since the two are identical in shape. */
interface MasterBalanceRow extends MasterOption {
  phone: string;
  contact: string;
  creditTerms: string | null;
  active: boolean;
  balanceCents: number;
}

function BalancesSheet({ kind, tenantId, onClose }: { kind: 'suppliers' | 'customers'; tenantId: string; onClose: () => void }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<MasterBalanceRow[] | null>(null);
  const label = kind === 'suppliers' ? 'Supplier' : 'Customer';

  const load = useCallback(() => {
    apiClient.get<MasterBalanceRow[]>(`/api/${kind}?tenantId=${tenantId}`).then((res) => {
      if (res.success) setRows(res.data);
    });
  }, [kind, tenantId]);
  useEffect(() => { load(); }, [load]);

  async function toggleActive(row: MasterBalanceRow) {
    const res = await apiClient.patch(`/api/${kind}/${row.id}?tenantId=${tenantId}`, { active: !row.active });
    if (res.success) load();
    else showToast(res.error ?? `Could not update this ${label.toLowerCase()}`, 'error');
  }

  const totalOwed = (rows ?? []).reduce((sum, r) => sum + r.balanceCents, 0);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <SheetTitle className="mb-1">{label} balances</SheetTitle>
        <p className="mb-4 text-sm text-muted">
          {kind === 'suppliers' ? 'What you still owe, per supplier.' : 'What is still owed to you, per customer.'}
        </p>
        <div className="mb-4 rounded-xl bg-primary-soft px-4 py-3">
          <div className="text-xs font-semibold text-muted">Total {kind === 'suppliers' ? 'owed' : 'outstanding'}</div>
          <div className="font-display text-2xl font-medium text-primary">{formatMoney(totalOwed)}</div>
        </div>
        {rows === null && <div className="text-sm text-muted">Loading…</div>}
        {rows !== null && rows.length === 0 && (
          <div className="text-sm text-muted">No {label.toLowerCase()}s yet — one gets added the first time you save one on a {kind === 'suppliers' ? 'purchase' : 'sale'}.</div>
        )}
        {rows !== null && rows.length > 0 && (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl bg-surface p-3.5 shadow-(--shadow-border)">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{r.name}</span>
                      {!r.active && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">Inactive</span>}
                    </div>
                    <div className="text-xs text-muted">{[r.phone, r.contact].filter(Boolean).join(' · ') || 'No contact on file'}</div>
                    {r.creditTerms && <div className="text-xs text-muted">Terms: {r.creditTerms}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn('font-display text-lg font-medium', r.balanceCents > 0 ? 'text-warning' : 'text-fg')}>{formatMoney(r.balanceCents)}</div>
                    <button type="button" onClick={() => toggleActive(r)} className="text-xs font-medium text-primary">
                      {r.active ? 'Mark inactive' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
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
    render: (r) => r.reversed
      ? <span className="chip chip-critical" style={{ fontSize: 'var(--fs-2xs)' }}>REVERSED</span>
      : <span className={`chip ${r.status === 'paid' ? 'chip-ok' : 'chip-warning'}`} style={{ fontSize: 'var(--fs-2xs)' }}>{(r.status as string).toUpperCase()}</span>,
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
 * same as every other sheet on this screen.
 *
 * owner-roast finding #2: this used to be one click straight from the date
 * picker to a posted, unreversible ledger entry — no list of who was about
 * to be paid, no amount total, no confirmation beyond the button itself.
 * It's now three steps: form -> preview (a real dry-run against the API, so
 * it can never drift from what the run actually does) -> a typed
 * confirmation before the real POST fires. ── */
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
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<{ run: ApiPayrollRun; payslips: ApiPayslip[] } | null>(null);

  const CONFIRM_WORD = 'PAY';

  async function loadPreview() {
    if (!periodStart || !periodEnd) { setError('Select a period start and end date.'); return; }
    setSaving(true);
    setError('');
    const res = await apiClient.post<PayrollPreview>('/api/payroll/runs', {
      tenantId, periodStart, periodEnd, memo: memo.trim() || undefined, dryRun: true,
    });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Could not preview this payroll run.'); return; }
    setPreview(res.data);
    setConfirmText('');
  }

  async function run() {
    if (!preview) return;
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
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85vh]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <SheetTitle className="mb-3.5">Run Payroll</SheetTitle>

        {result ? (
          <div>
            <div style={{ padding: '14px', background: 'rgba(var(--primary-rgb),0.08)', border: '1px solid rgba(var(--primary-rgb),0.25)', borderRadius: 12, marginBottom: 14, textAlign: 'center' }}>
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
        ) : preview ? (
          <>
            <div style={{ padding: '10px 12px', background: 'rgba(var(--warning-rgb),0.08)', borderRadius: 10, border: '1px solid rgba(var(--warning-rgb),0.25)', marginBottom: 12, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This is a preview — nothing has been paid yet. Confirming below posts a Payroll Expense entry to the ledger and cannot be undone from here.
            </div>
            <div className="farm-card" style={{ overflow: 'hidden', marginBottom: 10, maxHeight: 220, overflowY: 'auto' }}>
              {preview.employees.map((e, i, arr) => (
                <div key={e.id} style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{e.name}</span>
                  <span style={{ fontWeight: 700 }}>{formatMoney(e.amountCents)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px', marginBottom: 14 }}>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{preview.employeeCount} employee{preview.employeeCount === 1 ? '' : 's'} · {fmtDate(preview.periodStart)} – {fmtDate(preview.periodEnd)}</span>
              <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{formatMoney(preview.totalAmountCents)}</span>
            </div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>
              Type {CONFIRM_WORD} to confirm you want to pay {preview.employeeCount} employee{preview.employeeCount === 1 ? '' : 's'} {formatMoney(preview.totalAmountCents)}
            </label>
            <input className="farm-input" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={CONFIRM_WORD} style={{ marginBottom: 14 }} />
            {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setPreview(null); setError(''); }}>Back</button>
              <button
                className="btn-primary"
                style={{ flex: 2, justifyContent: 'center' }}
                disabled={saving || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
                onClick={run}
              >
                {saving ? 'Running…' : `Confirm & pay ${formatMoney(preview.totalAmountCents)}`}
              </button>
            </div>
          </>
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
            <div style={{ padding: '10px 12px', background: 'rgba(var(--warning-rgb),0.06)', borderRadius: 10, border: '1px solid rgba(var(--warning-rgb),0.2)', marginBottom: 14, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              Every active employee with a monthly salary set is paid their full rate for this period — gross pay only, no tax or statutory deductions. The next step shows exactly who and how much before anything is posted.
            </div>
            {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving} onClick={loadPreview}>
              {saving ? 'Loading…' : 'Preview payroll'}
            </button>
          </>
        )}
      </div>
    </Sheet>
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
  const [showSupplierBalances, setShowSupplierBalances] = useState(false);
  const [showCustomerBalances, setShowCustomerBalances] = useState(false);
  // Item 23: detail sheet (edit/reverse/history) for one selected row.
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

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

  // ── Picker suggestions, sourced from this tenant's own data (issue: free-
  // text fields that should be pickers) ─────────────────────────────────────
  // Category/unit come from the real inventory catalogue — not invented.
  // Supplier is now the real suppliers master (item 20's MasterPicker,
  // fetched inside RecordPurchaseSheet itself) rather than a purchase-
  // history-derived suggestion.
  const categoryNames = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items]
  );
  const unitNames = useMemo(
    () => Array.from(new Set(items.map((i) => i.unit).filter(Boolean))).sort(),
    [items]
  );

  const salesRows = useMemo(() => (sales ?? []).map((s) => ({
    id: s.id,
    item: s.item,
    date: fmtDate(s.soldAt),
    batchLabel: s.batchId ? batchLabelById.get(s.batchId) ?? s.batchId : '',
    method: s.method,
    amount: centsToMajor(s.amountCents),
    status: s.status,
    reversed: !!s.reversedAt,
  })), [sales, batchLabelById]);

  const filteredSales = salesRows.filter((s) => {
    if (!salesSearch.trim()) return true;
    const q = salesSearch.toLowerCase();
    return s.item.toLowerCase().includes(q) || s.batchLabel.toLowerCase().includes(q) || (s.method || '').toLowerCase().includes(q);
  });

  // Item 23: the full row (not the display-flattened salesRows/salesTable
  // shape) for whichever sale/purchase the detail sheet has open.
  const selectedSale = useMemo(() => (sales ?? []).find((s) => s.id === selectedSaleId) ?? null, [sales, selectedSaleId]);
  const selectedPurchase = useMemo(() => (purchases ?? []).find((p) => p.id === selectedPurchaseId) ?? null, [purchases, selectedPurchaseId]);

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
  // owner-roast finding #3: "recorded nothing yet" and "you are losing
  // money" used to render as the same three-tile grid — a period with zero
  // sales AND zero purchases showed "Net KSh 0K" exactly like a period with
  // real expenses and no revenue showed "Net -KSh 10K", with nothing telling
  // the two apart except doing the subtraction yourself. `transactionCount`
  // (lib/reports.ts's computePlReport meta) is the real count of sales +
  // purchases + payroll rows in the period — 0 means nothing was recorded at
  // all, not just that revenue happened to net to zero.
  const periodTransactionCount = Number(budgetReport?.meta.transactionCount ?? 0);
  const hasFinanceActivity = budgetReport !== null && periodTransactionCount > 0;
  // (`budgetTotal = totalRevenue + totalExpenses` used to sit here, feeding a
  // progress bar and a "Revenue N% / Expenses N%" pair under a heading that
  // says "Budget". There is no budget, target or forecast anywhere in this
  // schema — grep `db/schemas/*.ts`. The bar was revenue's share of gross cash
  // flow, so the two figures always summed to 100% and it carried no
  // information at all, while under that heading it read as "I am 62% of the
  // way to my target". Removed rather than rewired: the three real figures
  // above it are the honest answer, and inventing a denominator to draw a bar
  // against is exactly what this app's empty-state rule forbids.)

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
    const csv = toCsv(headers, rows);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'gl-trial-balance.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Company"
          title="Finance"
          lede="Sales, purchases, payroll, and a ledger that stays in balance."
          actions={
            // forms-audit slice, item 8: this button's LABEL always fell back
            // to "Record sale" for any tab that isn't Purchases/Payroll —
            // including Overview, the tab a farmer actually lands on — but
            // the click handler only matched `tab === 'sales'` exactly, so on
            // Overview the button read "Record sale" and did nothing at all.
            // The click handler now mirrors the label's own fallback instead
            // of a narrower, silently-different condition.
            <Button onClick={() => { if (tab === 'purchases') setShowRecordPurchase(true); else if (tab === 'payroll') setShowRunPayroll(true); else setShowRecordSale(true); }}>
              <Plus size={16} />
              {tab === 'payroll' ? 'Run payroll' : tab === 'purchases' ? 'Record purchase' : 'Record sale'}
            </Button>
          }
        />

        <div className="mt-5">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'Overview' },
              { id: 'sales', label: 'Sales' },
              { id: 'purchases', label: 'Expenses' },
              { id: 'gl', label: 'GL accounts' },
              { id: 'payroll', label: 'Payroll' },
            ]}
          />
        </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="mt-5">
          {/* Month/Quarter/YTD toggle (issue #299) — restored from the
              original design (commit 80ab7db); re-fetches GET
              /api/reports/pl scoped to the selected period (loadBudget
              above) rather than always showing all-time totals. */}
          <div className="mb-3 flex justify-end">
            <Segmented value={period} onChange={setPeriod} items={BUDGET_PERIODS.map((p) => ({ id: p, label: p.toUpperCase() }))} />
          </div>

          <div className="mb-5 rounded-xl bg-surface p-5 shadow-(--shadow-border)">
            {/* Was "Budget Overview". Renamed with the fabricated budget bar that sat
                under it: the card has never shown a budget, only what actually
                came in and went out, and a heading promising one is what made
                the bar beneath it read as attainment. */}
            <p className="text-sm font-medium">Money in and out — {periodLabel}</p>
            {budgetError && <div className="mt-2 text-sm text-danger">{budgetError}</div>}
            {!budgetError && !hasFinanceActivity ? (
              // Honest empty state (owner-roast finding #3) — no sales,
              // purchases or payroll runs at all in this period, distinct
              // from a real negative net below.
              <div className="py-4 text-center">
                <div className="mb-1 text-sm font-semibold text-fg">Nothing recorded for {periodLabel} yet</div>
                <div className="text-xs text-subtle">Record a sale or a purchase and this will show real revenue, expenses and net.</div>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <button type="button" className="text-left" onClick={() => setTab('sales')}>
                    <p className="font-display text-2xl tabular-nums text-success">KSh {(totalRevenue/1000).toFixed(0)}K</p>
                    <p className="mt-1 text-xs text-muted">Revenue</p>
                  </button>
                  <button type="button" className="text-left" onClick={() => setTab('purchases')}>
                    <p className="font-display text-2xl tabular-nums text-danger">KSh {(totalExpenses/1000).toFixed(0)}K</p>
                    <p className="mt-1 text-xs text-muted">Expenses</p>
                  </button>
                  <button type="button" className="text-left" onClick={() => setTab('gl')}>
                    <p className={cn('font-display text-2xl tabular-nums', margin > 0 ? 'text-primary' : 'text-danger')}>
                      {margin > 0 ? '+' : ''}KSh {(margin/1000).toFixed(0)}K
                    </p>
                    <p className="mt-1 text-xs text-muted">Net</p>
                  </button>
                </div>
                {margin < 0 && (
                  <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                    You spent more than you took in for {periodLabel}: KSh {(totalExpenses/1000).toFixed(0)}K recorded against KSh {(totalRevenue/1000).toFixed(0)}K in sales.
                  </div>
                )}
                {/* No bar here on purpose — see the note where budgetTotal used
                    to be computed. This line says what the three figures are and
                    what they are not, which is the same "state your basis" rule
                    the reports and the weather advice already follow. */}
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  Actuals for {periodLabel}, from your recorded sales and purchases. You haven&rsquo;t set a budget to compare them against — this app has nowhere to enter one yet.
                </p>
              </>
            )}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Batch P&amp;L</h2>
            <p className="text-xs text-subtle">Tap a row for the full picture</p>
          </div>
          {batchesError && <div className="mb-2 text-sm text-danger">{batchesError}</div>}
          {batches === null && !batchesError && (
            <div className="py-5 text-center text-sm text-subtle">Loading batch P&amp;L…</div>
          )}
          {batches !== null && (
            <div className="overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
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
            </div>
          )}
        </div>
      )}

      {/* ── Sales ── */}
      {tab === 'sales' && (
        <div className="mt-5">
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
              onRowClick={(r) => setSelectedSaleId(r.id as string)}
              defaultPageSize={20}
              pageSizes={[10, 20, 50, 100]}
              bodyHeight={320}
              tableId="finance-sales"
              emptyText="No sales records found."
            />
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 20 }}>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowCustomerBalances(true)}>
              Customer balances
            </button>
            <button className="btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={() => setShowRecordSale(true)}>
              <Plus size={16} /> Record Sale
            </button>
          </div>
        </div>
      )}

      {/* ── PURCHASES / EXPENSES ── */}
      {tab === 'purchases' && (
        <div className="mt-5">
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
                <div key={p.id} className="farm-card" style={{ padding: 14, cursor: 'pointer' }} onClick={() => setSelectedPurchaseId(p.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{itemNameById.get(p.itemId) ?? p.itemId}</div>
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>{p.supplier} · {fmtDate(p.createdAt)}</div>
                    </div>
                    {p.reversedAt ? (
                      <span className="chip chip-critical" style={{ fontSize: 'var(--fs-2xs)' }}>REVERSED</span>
                    ) : itemCategoryById.get(p.itemId) && (
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
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowSupplierBalances(true)}>
              Supplier balances
            </button>
            <button className="btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={() => setShowRecordPurchase(true)}>
              <Plus size={16} /> Record Purchase
            </button>
          </div>
        </div>
      )}

      {/* ── GL ACCOUNTS ── */}
      {tab === 'gl' && (
        <div className="mt-5">
          <div style={{ padding: '10px 14px', background: 'rgba(var(--info-rgb),0.08)', borderRadius: 12, marginBottom: 14, border: '1px solid rgba(var(--info-rgb),0.2)' }}>
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
        <div className="mt-5">
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
      </div>

      {showRecordSale && (
        <RecordSaleSheet
          tenantId={tenantId}
          batches={batches ?? []}
          onCreated={() => { loadSales(); loadGL(); }}
          onViewList={() => { setShowRecordSale(false); setTab('sales'); }}
          onClose={() => setShowRecordSale(false)}
        />
      )}
      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={items.map((i) => i.name)}
          categories={categoryNames}
          units={unitNames}
          farms={farms}
          activeFarmId={activeFarmId}
          onCreated={() => { loadPurchases(); loadGL(); }}
          onViewList={() => { setShowRecordPurchase(false); setTab('purchases'); }}
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
      {showSupplierBalances && <BalancesSheet kind="suppliers" tenantId={tenantId} onClose={() => setShowSupplierBalances(false)} />}
      {showCustomerBalances && <BalancesSheet kind="customers" tenantId={tenantId} onClose={() => setShowCustomerBalances(false)} />}
      {selectedSale && (
        <SaleDetailSheet
          tenantId={tenantId}
          sale={selectedSale}
          onClose={() => setSelectedSaleId(null)}
          onChanged={() => { loadSales(); loadGL(); }}
        />
      )}
      {selectedPurchase && (
        <PurchaseDetailSheet
          tenantId={tenantId}
          purchase={selectedPurchase}
          itemLabel={itemNameById.get(selectedPurchase.itemId) ?? selectedPurchase.itemId}
          onClose={() => setSelectedPurchaseId(null)}
          onChanged={() => { loadPurchases(); loadGL(); }}
        />
      )}
    </div>
  );
}
