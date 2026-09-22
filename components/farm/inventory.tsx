'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import { apiClient } from '@/lib/request';
import { toCsv } from '@/lib/csv';
import { Plus, Search, X, Download, Wheat, Syringe, Beaker, Sprout, Receipt, AlertTriangle, Upload, type LucideIcon } from './icons';
import { useToast, fieldErrorStyle, FieldError } from './ui-shared';
import { CsvImportModal } from './csv-import';
import { DataTable, ColDef } from './data-table';
import { parseMoneyToCents, centsToMajor } from '@/lib/money';
import { cn } from '@/lib/utils';
import { PageHeader, Kpi } from '@/components/ui-kit/page-header';
import { Segmented, Chips } from '@/components/ui-kit/segmented';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { Dossier, Inspector, Kv } from '@/components/ui-kit/inspector';
import { Field } from '@/components/ui-kit/field';

// ── Inventory screen, redesigned onto the reference (ui/governance-
// reference-redesign) but wired to the exact same backend as before — see
// docs/ui-migration-map.md §2 Inventory. Every API call below is unchanged:
//   GET  /api/inventory/items                — merged item+lots stock list
//   GET  /api/purchases, POST /api/purchases  — purchase history + record
//   PATCH /api/inventory/lots/[id]            — reason-required qty adjust
//   GET  /api/inventory/items/[id]/usage-history — receipt history for an item
//   GET  /api/inventory/variance              — staleness-based variance flag
//
// D7: the reference's Mixes tab is dropped entirely — there is no feed-mix
// backend anywhere on this branch (never was even before this redesign).
// D8: the local-only Purchases tab (no reference equivalent — reference only
// surfaces purchases inline in a stock line's dossier) stays as its own tab.
// The reference's "Lots" tab is our staleness-based Variance tab, relabelled
// "Lots" to match the reference's mental model — the tab's underlying id
// (`variance`) and its real "reason-required recount" flow are unchanged.
//
// Hero: the Stock list. The reference sorts by days-of-cover ascending — we
// have no consumption/feeding-out ledger anywhere on this branch (only
// purchases IN are recorded — see lib/inventory.ts), so "days of cover" would
// be invented. Sorted instead by real distance-to-reorder: expiring items
// first (the more time-sensitive, unfixable-by-reordering problem — same
// priority computeItemStatus already uses), then by qtyOnHand/lowStockThreshold
// ascending. A tapped stock line opens a Dossier (desktop) / bottom sheet
// (mobile) showing its lots (real movements — receipt + reason-required
// adjustments) and its purchase history — both already-existing endpoints,
// nothing new.

/* ── API row shapes (exactly as the routes above return them) ── */
interface ApiLot {
  id: string;
  itemId: string;
  lotNo: string;
  qtyOnHand: number;
  unitCostCents: number;
  expiryDate: string | null;
  receivedDate: string;
  farmId: string | null; // farm-scoped-data task (migration 0019)
}
interface ApiInventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  lowStockThreshold: number;
  qtyOnHand: number; // sum of this item's lots' qtyOnHand, computed server-side
  lots: ApiLot[];
  status: 'ok' | 'low' | 'expiring';
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
interface ApiVarianceRow {
  lotId: string;
  itemId: string;
  itemName: string;
  lotNo: string;
  qtyOnHand: number;
  lastReconciledAt: string;
  daysSinceReconciliation: number;
  flagged: boolean;
}

const catIcon: Record<string, LucideIcon> = {
  Feed: Wheat, Vaccine: Syringe, Medicine: Beaker, Seed: Sprout,
};

function CategoryIcon({ category }: { category: string }) {
  const Icon = catIcon[category];
  return Icon ? <Icon size={12} className="mr-1 inline align-text-bottom" aria-hidden="true" /> : null;
}

function fmtDate(d?: string | null): string | undefined {
  if (!d) return undefined;
  return d.slice(0, 10);
}

function avgUnitCostCents(item: ApiInventoryItem): number {
  const totalQty = item.lots.reduce((s, l) => s + l.qtyOnHand, 0);
  if (totalQty <= 0) return item.lots[0]?.unitCostCents ?? 0;
  const totalCost = item.lots.reduce((s, l) => s + l.unitCostCents * l.qtyOnHand, 0);
  return Math.round(totalCost / totalQty);
}

function nearestExpiry(item: ApiInventoryItem): string | null {
  const dates = item.lots.map(l => l.expiryDate).filter((d): d is string => !!d).sort();
  return dates[0] ?? null;
}

/* Purchases have no `status` column — the real fields are totalCostCents vs
 * amountPaidCents. That's the honest replacement for the mock's
 * "delivered"/"pending" chip. */
function paymentStatus(p: ApiPurchase): 'paid' | 'partial' | 'unpaid' {
  if (p.totalCostCents > 0 && p.amountPaidCents >= p.totalCostCents) return 'paid';
  if (p.amountPaidCents > 0) return 'partial';
  return 'unpaid';
}

// ── Stock ordering — no days-of-cover data exists (see header comment), so
// the hero list sorts by real signals only: expiring beats low beats ok
// (same priority lib/inventory.ts's computeItemStatus uses), then by how
// close qtyOnHand is to lowStockThreshold. An item with no threshold set
// can never be "low" by definition, so it sorts to the back of its bucket
// rather than dividing by zero.
function stockRank(item: ApiInventoryItem): number {
  return item.status === 'expiring' ? 0 : item.status === 'low' ? 1 : 2;
}
function stockRatio(item: ApiInventoryItem): number {
  if (item.lowStockThreshold <= 0) return Infinity;
  return item.qtyOnHand / item.lowStockThreshold;
}
function stockCoverPct(item: ApiInventoryItem): number {
  if (item.lowStockThreshold <= 0) return 100;
  return Math.max(4, Math.min(100, Math.round((item.qtyOnHand / (item.lowStockThreshold * 3)) * 100)));
}

/* ── Record Purchase sheet — real POST /api/purchases. Used from both the
 * Purchases tab (blank) and the item dossier (prefilled). ── */
function RecordPurchaseSheet({ tenantId, itemNames, supplierNames, categories, units, paymentMethods, prefill, farms, activeFarmId, onCreated, onClose }: {
  tenantId: string;
  itemNames: string[];
  // Suggestions only — every one of these is a combobox (input + datalist),
  // not a hard select, so a genuinely new supplier/category/unit/method is
  // still recorded verbatim. Built from this tenant's own purchases/items
  // (see InventoryScreen/InventoryDetailScreen), not invented.
  supplierNames: string[];
  categories: string[];
  units: string[];
  paymentMethods: string[];
  prefill?: { itemName?: string; unit?: string; category?: string };
  // farm-scoped-data task: both purchases.farmId and the inventoryLots.farmId
  // it creates need a farm — see lib/inventory.ts's recordPurchase. Defaults
  // to the shell's active farm; when that's 'ALL' the picker starts empty so
  // the form never silently guesses which farm this stock landed at.
  farms: { id: string; name: string }[];
  activeFarmId: string;
  onCreated: () => void;
  onClose: () => void;
}) {
  const [supplier, setSupplier] = useState('');
  const [itemName, setItemName] = useState(prefill?.itemName ?? '');
  const [category, setCategory] = useState(prefill?.category ?? '');
  const [unit, setUnit] = useState(prefill?.unit ?? '');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  // owner-roast finding #10: with a single farm and the shell's filter on
  // 'ALL', this used to stay '' — a disabled "Select a farm…" placeholder
  // with nothing else it could sanely be. Multiple farms still start blank
  // on purpose (see this component's own farms-prop comment above): guessing
  // which of several farms this stock landed at would be worse than asking.
  const [farmId, setFarmId] = useState(activeFarmId !== 'ALL' ? activeFarmId : (farms.length === 1 ? farms[0].id : ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // owner-roast finding #10: the banner used to say "Supplier, item, and
  // unit are required" while silently skipping farm — the checks returned
  // one at a time instead of being collected together. Per-field, same
  // mechanism as ui-shared.tsx's fieldErrorStyle/FieldError.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();

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
    // Quantities are stored in an `integer` column, so a fraction cannot be
    // kept. This used to be truncated silently by `Math.trunc(qty)` below —
    // "0.5 bags" became a zero-quantity, zero-cost purchase and the money paid
    // was erased. The server refuses it now; say so before the round trip.
    else if (!Number.isInteger(qty)) errs.quantity = `Quantity must be a whole number of ${unit.trim() || 'units'}`;
    if (unitCostCents === null || unitCostCents < 0) errs.unitCost = 'Cost per unit must be a non-negative number';
    if (amountPaid && amountPaidCents === null) errs.amountPaid = 'Amount paid must be a number';
    else if (amountPaidCents !== null && amountPaidCents < 0) errs.amountPaid = 'Amount paid cannot be negative';
    // Paying more than the bill left the purchase row claiming it was PAID
    // while the journal only credited Cash the total — the difference simply
    // vanished from the ledger. Refused on both sides now.
    else if (amountPaidCents !== null && unitCostCents !== null && amountPaidCents > qty * unitCostCents) {
      errs.amountPaid = 'Amount paid is more than the purchase total';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('');
      return;
    }
    setFieldErrors({});

    setSaving(true);
    setError('');
    const res = await apiClient.post('/api/purchases', {
      tenantId,
      supplier: supplier.trim(),
      itemName: itemName.trim(),
      category: category.trim() || undefined,
      unit: unit.trim(),
      lowStockThreshold: lowStockThreshold ? Math.trunc(Number(lowStockThreshold)) : undefined,
      quantity: qty,
      unitCostCents,
      paymentMethod: paymentMethod.trim() || undefined,
      amountPaidCents: amountPaidCents ?? undefined,
      lotNo: lotNo.trim() || undefined,
      expiryDate: expiryDate || undefined,
      farmId,
    });
    setSaving(false);
    if (res.success) {
      showToast('Purchase recorded. Stock is on hand.', 'success');
      onCreated();
      onClose();
    } else {
      setError(res.error || 'Could not record this purchase.');
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[92vh]">
      <SheetTitle className="sr-only">Record Purchase</SheetTitle>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-4 font-display text-xl font-medium">Record Purchase</div>

        <div className="grid gap-3">
          <Field label="Farm *">
            {farms.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted">Stock has to land at a farm. You do not have one yet — that is set up when the application is approved.</p>
            ) : (
              <>
                <select
                  className="h-10 w-full min-w-0 rounded-md bg-surface px-3 text-sm text-fg shadow-(--shadow-border) outline-none"
                  value={farmId} onChange={e => setFarmId(e.target.value)}
                  style={fieldErrorStyle(!!fieldErrors.farmId)}
                  aria-invalid={!!fieldErrors.farmId} aria-describedby={fieldErrors.farmId ? 'inv-purchase-farm-error' : undefined}>
                  <option value="" disabled>Select a farm…</option>
                  {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <FieldError id="inv-purchase-farm-error" message={fieldErrors.farmId} />
              </>
            )}
          </Field>

          <Field label="Supplier *">
            <Input list="inv-supplier-names" placeholder="e.g. Unga Ltd" value={supplier} onChange={e => setSupplier(e.target.value)}
              style={fieldErrorStyle(!!fieldErrors.supplier)}
              aria-invalid={!!fieldErrors.supplier} aria-describedby={fieldErrors.supplier ? 'inv-purchase-supplier-error' : undefined} />
            <datalist id="inv-supplier-names">
              {supplierNames.map(n => <option key={n} value={n} />)}
            </datalist>
            <FieldError id="inv-purchase-supplier-error" message={fieldErrors.supplier} />
          </Field>

          <Field label="Item *">
            <Input list="inv-item-names" placeholder="e.g. dairy meal, maize seed, layers mash" value={itemName} onChange={e => setItemName(e.target.value)}
              style={fieldErrorStyle(!!fieldErrors.itemName)}
              aria-invalid={!!fieldErrors.itemName} aria-describedby={fieldErrors.itemName ? 'inv-purchase-item-error' : undefined} />
            <datalist id="inv-item-names">
              {itemNames.map(n => <option key={n} value={n} />)}
            </datalist>
            <FieldError id="inv-purchase-item-error" message={fieldErrors.itemName} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Input list="inv-categories" placeholder="e.g. Feed" value={category} onChange={e => setCategory(e.target.value)} />
              <datalist id="inv-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </Field>
            <Field label="Unit *">
              <Input list="inv-units" placeholder="e.g. kg" value={unit} onChange={e => setUnit(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.unit)}
                aria-invalid={!!fieldErrors.unit} aria-describedby={fieldErrors.unit ? 'inv-purchase-unit-error' : undefined} />
              <datalist id="inv-units">
                {units.map(u => <option key={u} value={u} />)}
              </datalist>
              <FieldError id="inv-purchase-unit-error" message={fieldErrors.unit} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity *">
              <Input type="number" inputMode="numeric" placeholder="0" value={quantity} onChange={e => setQuantity(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.quantity)}
                aria-invalid={!!fieldErrors.quantity} aria-describedby={fieldErrors.quantity ? 'inv-purchase-qty-error' : undefined} />
              <FieldError id="inv-purchase-qty-error" message={fieldErrors.quantity} />
            </Field>
            <Field label="Cost/unit (KSh) *">
              <Input type="number" inputMode="decimal" placeholder="0" value={unitCost} onChange={e => setUnitCost(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.unitCost)}
                aria-invalid={!!fieldErrors.unitCost} aria-describedby={fieldErrors.unitCost ? 'inv-purchase-unitcost-error' : undefined} />
              <FieldError id="inv-purchase-unitcost-error" message={fieldErrors.unitCost} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Lot No.">
              <Input placeholder="auto if blank" value={lotNo} onChange={e => setLotNo(e.target.value)} />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment method">
              <Input list="inv-payment-methods" placeholder="e.g. M-Pesa" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} />
              <datalist id="inv-payment-methods">
                {paymentMethods.map(m => <option key={m} value={m} />)}
              </datalist>
            </Field>
            <Field label="Amount paid (KSh)">
              <Input type="number" inputMode="decimal" placeholder="0 if unpaid" value={amountPaid} onChange={e => setAmountPaid(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.amountPaid)}
                aria-invalid={!!fieldErrors.amountPaid} aria-describedby={fieldErrors.amountPaid ? 'inv-purchase-amountpaid-error' : undefined} />
              <FieldError id="inv-purchase-amountpaid-error" message={fieldErrors.amountPaid} />
            </Field>
          </div>

          <Field label="Reorder threshold (new items only)">
            <Input type="number" inputMode="numeric" placeholder="e.g. 500" value={lowStockThreshold} onChange={e => setLowStockThreshold(e.target.value)} />
          </Field>
        </div>

        {error && <div className="mt-3 text-xs text-danger">{error}</div>}
        <Button className="mt-4 mb-2 w-full justify-center" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Record Purchase'}
        </Button>
      </div>
    </Sheet>
  );
}

/* ── Per-lot adjust control — real PATCH /api/inventory/lots/[id], reason
 * required (the endpoint 400s without one). Real "movement": each lot is a
 * receipt (arrival) that a reason-required correction can move again. ── */
function LotRow({ lot, tenantId, onSaved }: { lot: ApiLot; tenantId: string; onSaved: () => void }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(lot.qtyOnHand));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const newQty = Number(qty);
    if (!Number.isFinite(newQty) || newQty < 0) { setError('Enter a valid quantity.'); return; }
    if (!reason.trim()) { setError('A reason is required for this adjustment.'); return; }
    setSaving(true);
    setError('');
    const res = await apiClient.patch(`/api/inventory/lots/${lot.id}?tenantId=${tenantId}`, {
      qtyOnHand: Math.trunc(newQty),
      reason: reason.trim(),
    });
    setSaving(false);
    if (res.success) {
      setOpen(false);
      setReason('');
      showToast(`${lot.lotNo} is now ${Math.trunc(newQty).toLocaleString()}.`, 'success');
      onSaved();
    } else {
      setError(res.error || 'Could not adjust this lot.');
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{lot.lotNo}</div>
          <div className="mt-0.5 text-xs text-subtle">
            Received {fmtDate(lot.receivedDate) ?? '—'}{lot.expiryDate ? ` · Expires ${fmtDate(lot.expiryDate)}` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium">{lot.qtyOnHand.toLocaleString()}</div>
          <button type="button" onClick={() => setOpen(o => !o)} className="mt-0.5 text-xs font-medium text-primary">
            {open ? 'Cancel' : 'Adjust'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2.5 grid gap-2.5">
          <Field label="New quantity">
            <Input type="number" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value)} />
          </Field>
          <Field label="Reason * (required, goes to the audit trail)">
            <Input placeholder="e.g. physical recount, spoilage, theft" value={reason} onChange={e => setReason(e.target.value)} />
          </Field>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button size="sm" onClick={save} disabled={saving || !reason.trim()}>
            {saving ? 'Saving…' : 'Save adjustment'}
          </Button>
        </div>
      )}
    </li>
  );
}

/* ── Shared dossier body: KV summary + Lots (movements) + Purchases. Used by
 * both the inline Dossier/Inspector (InventoryScreen) and the standalone
 * InventoryDetailScreen, so the two never drift. ── */
function StockDossierBody({ item, tenantId, onAdjusted }: { item: ApiInventoryItem; tenantId: string; onAdjusted: () => void }) {
  const [history, setHistory] = useState<ApiPurchase[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    apiClient.get<ApiPurchase[]>(`/api/inventory/items/${item.id}/usage-history?tenantId=${tenantId}`).then((res) => {
      if (!cancelled && res.success) setHistory(res.data);
    });
    return () => { cancelled = true; };
  }, [item.id, tenantId]);

  const cost = avgUnitCostCents(item);
  const expiry = nearestExpiry(item);

  return (
    <>
      <dl>
        <Kv label="On hand" value={`${item.qtyOnHand.toLocaleString()} ${item.unit}`} />
        <Kv label="Reorder at" value={`${item.lowStockThreshold.toLocaleString()} ${item.unit}`} />
        <Kv label="Cost / unit" value={`KSh ${centsToMajor(cost).toLocaleString()}`} />
        <Kv label="Value" value={`KSh ${centsToMajor(cost * item.qtyOnHand).toLocaleString()}`} />
        <Kv label="Nearest expiry" value={expiry ? fmtDate(expiry) : 'Not tracked'} />
        <Kv label="Status" value={<Badge variant={item.status === 'ok' ? 'success' : item.status === 'low' ? 'warning' : 'danger'}>{item.status.toUpperCase()}</Badge>} />
      </dl>

      <h3 className="mt-6 text-xs font-medium tracking-[0.12em] text-subtle uppercase">Lots</h3>
      {item.lots.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No lots recorded for this item.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {item.lots.map((lot) => <LotRow key={lot.id} lot={lot} tenantId={tenantId} onSaved={onAdjusted} />)}
        </ul>
      )}

      {/* Purchases — really the item's receipt history (see app/api/inventory/
          items/[id]/usage-history/route.ts: there is no consumption/feeding
          ledger to derive usage-out from, so this honestly shows when stock
          came IN). */}
      <h3 className="mt-6 text-xs font-medium tracking-[0.12em] text-subtle uppercase">Purchases</h3>
      {history === null ? (
        <p className="mt-2 text-sm text-muted">Loading…</p>
      ) : history.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No purchases recorded for this item yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {history.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{p.supplier}</span>
                <span className="block text-xs text-subtle">{fmtDate(p.createdAt)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-medium">{p.quantity.toLocaleString()}{item.unit}</span>
                <span className="block text-xs text-muted">KSh {centsToMajor(p.totalCostCents).toLocaleString()}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const VARIANCE_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: 'itemName', header: 'Item', sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>TOTALS</span>,
    render: (r) => (
      <div>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{r.itemName as string}</div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)' }}>{r.lotNo as string}</div>
      </div>
    ),
  },
  { key: 'qtyOnHand', header: 'On Hand', sortable: true, align: 'right', minWidth: 80, summary: 'sum', render: (r) => <span style={{ fontSize: 'var(--fs-sm)' }}>{(r.qtyOnHand as number).toLocaleString()}</span> },
  {
    key: 'daysSinceReconciliation', header: 'Stale (days)', sortable: true, align: 'right', minWidth: 96,
    summary: 'avg',
    render: (r) => <span style={{ fontWeight: 700, color: (r.flagged as boolean) ? 'var(--status-critical)' : 'var(--text-secondary)' }}>{r.daysSinceReconciliation as number}d</span>,
  },
  {
    key: 'flagged', header: 'Action', align: 'center', minWidth: 68,
    summary: 'count',
    render: (r) => r.flagged
      ? <span className="chip chip-critical" style={{ fontSize: 'var(--fs-2xs)' }}>RECOUNT</span>
      : <span className="chip chip-ok" style={{ fontSize: 'var(--fs-2xs)' }}>OK</span>,
  },
];

export function InventoryScreen() {
  const { tenantId, activeFarmId, farms } = useNav();
  const [tab, setTab] = useState<'stock' | 'purchases' | 'variance'>('stock');
  const [cat, setCat] = useState('All');
  const [stockSearch, setStockSearch] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showRecordPurchase, setShowRecordPurchase] = useState(false);
  const [importing, setImporting] = useState(false);
  // What the last CSV import refused, and why. Held on the screen rather than
  // inside the import sheet because the sheet closes when the import starts.
  const [importReport, setImportReport] = useState('');

  const [items, setItems] = useState<ApiInventoryItem[] | null>(null);
  const [purchases, setPurchases] = useState<ApiPurchase[] | null>(null);
  const [variance, setVariance] = useState<ApiVarianceRow[] | null>(null);

  // Master–detail: a stock line opens a Dossier (desktop) / bottom sheet
  // (mobile) — same selection pattern as components/farm/governance.tsx.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // farm-scoped-data task: items/purchases both re-fetch on activeFarmId
  // change. GET /api/inventory/items filters LOTS to the farm (the item
  // catalogue itself stays the same — see that route's header); GET
  // /api/purchases filters directly on purchases.farmId.
  const loadItems = useCallback(() => {
    apiClient.get<ApiInventoryItem[]>(`/api/inventory/items?tenantId=${tenantId}&farmId=${activeFarmId}`).then(res => {
      if (res.success) setItems(res.data);
    });
  }, [tenantId, activeFarmId]);
  const loadPurchases = useCallback(() => {
    apiClient.get<ApiPurchase[]>(`/api/purchases?tenantId=${tenantId}&farmId=${activeFarmId}`).then(res => {
      if (res.success) setPurchases(res.data);
    });
  }, [tenantId, activeFarmId]);
  // Variance (GET /api/inventory/variance) has no farmId support yet — it's
  // not one of the endpoints this task scoped (see lib/inventory.ts's
  // computeVariance); stays tenant-wide regardless of activeFarmId.
  const loadVariance = useCallback(() => {
    apiClient.get<ApiVarianceRow[]>(`/api/inventory/variance?tenantId=${tenantId}`).then(res => {
      if (res.success) setVariance(res.data);
    });
  }, [tenantId]);

  const loadAll = useCallback(() => {
    loadItems();
    loadPurchases();
    loadVariance();
  }, [loadItems, loadPurchases, loadVariance]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loading = items === null;
  const cats = ['All', ...Array.from(new Set((items ?? []).map(i => i.category).filter(Boolean)))];
  const lowCount = (items ?? []).filter((i) => i.status === 'low' || i.status === 'expiring').length;
  const totalLots = (items ?? []).reduce((s, i) => s + i.lots.length, 0);
  const flaggedVariances = (variance ?? []).filter(v => v.flagged).length;

  // The CSV template (components/farm/csv-import.tsx) has no supplier column,
  // so imported rows record purchases under a fixed "CSV Import" supplier —
  // real POST /api/purchases calls, not a silent no-op (issue #236 task 7).
  async function handleImportRows(rows: Record<string, string>[]) {
    setImporting(true);
    // Rows this import refused, reported back instead of swallowed. A silent
    // `continue` is how a CSV of 200 items imports 140 and nobody notices.
    const skipped: string[] = [];
    let imported = 0;
    for (const [i, row] of rows.entries()) {
      const line = i + 2; // +1 for zero-index, +1 for the header row
      const itemName = row.name?.trim();
      const unit = row.unit?.trim();
      const qty = Number(row.qty);
      if (!itemName || !unit || !Number.isFinite(qty) || qty <= 0) {
        skipped.push(`line ${line}: needs a name, a unit and a quantity above zero`);
        continue;
      }
      // A non-integer quantity used to be truncated silently — 12.5 kg became
      // 12 — and the server now refuses it outright, so say so here rather
      // than sending a request that will 400.
      if (!Number.isInteger(qty)) {
        skipped.push(`line ${line}: quantity ${row.qty} is not a whole number`);
        continue;
      }
      const costPerUnitCents = parseMoneyToCents(row.costPerUnit);
      // ── An unparseable cost is refused, not turned into zero ─────────────
      // This used to be `costPerUnitCents !== null && > 0 ? ... : 0`, which
      // converted parseMoneyToCents's deliberate refusal (it returns null
      // rather than a wrong number for "KSh 1200", "1e5", "12.34.56") into a
      // cost of ZERO. A whole CSV could import at zero valuation, taking
      // avgUnitCostCents and every downstream expense figure with it, and no
      // error was ever shown. The quantity check on the line above already
      // skipped a bad qty — the cost silently did not.
      if (costPerUnitCents === null || costPerUnitCents < 0) {
        skipped.push(`line ${line}: cost "${row.costPerUnit ?? ''}" is not an amount we can read`);
        continue;
      }
      const res = await apiClient.post('/api/purchases', {
        tenantId,
        supplier: 'CSV Import',
        itemName,
        category: row.category || undefined,
        unit,
        quantity: qty,
        unitCostCents: costPerUnitCents,
        lowStockThreshold: row.reorder ? Math.trunc(Number(row.reorder)) : undefined,
        lotNo: row.lotNumber || undefined,
        expiryDate: row.expiryDate || undefined,
        // A CSV row carries no farm column (same reason the template has no
        // supplier column — see file header); import against the currently
        // active farm when one is selected, or leave unscoped under 'ALL'
        // rather than guess.
        farmId: activeFarmId !== 'ALL' ? activeFarmId : undefined,
      });
      // The server is the authority, so its refusal is reported too — a unit
      // that contradicts an existing item lands here.
      if (res.success) imported += 1;
      else skipped.push(`line ${line}: ${res.error ?? 'refused'}`);
    }
    setImporting(false);
    setImportReport(skipped.length > 0
      ? `Imported ${imported} of ${rows.length}. Not imported — ${skipped.join('; ')}`
      : '');
    loadAll();
  }

  function exportStockCSV() {
    const headers = ['id', 'name', 'category', 'unit', 'qtyOnHand', 'lowStockThreshold', 'avgCostCents', 'status'];
    const rows = (items ?? []).map(i => [i.id, i.name, i.category, i.unit, i.qtyOnHand, i.lowStockThreshold, avgUnitCostCents(i), i.status]);
    const csv = toCsv(headers, rows);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'inventory.csv';
    a.click();
  }

  const filteredStock = (items ?? [])
    .filter((i) => cat === 'All' || i.category === cat)
    .filter((i) => {
      if (!stockSearch.trim()) return true;
      const q = stockSearch.toLowerCase();
      return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q) || i.lots.some(l => l.lotNo.toLowerCase().includes(q));
    });
  const sortedStock = [...filteredStock].sort((a, b) => stockRank(a) - stockRank(b) || stockRatio(a) - stockRatio(b));

  const itemNameById = new Map((items ?? []).map(i => [i.id, i.name] as const));
  const selectedItem = (items ?? []).find(i => i.id === selectedId) ?? null;

  function pickItem(id: string) {
    setSelectedId(id);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) setMobileOpen(true);
  }

  // Picker suggestions for RecordPurchaseSheet, sourced from this tenant's
  // own items/purchases rather than invented (issue: free-text fields that
  // should be pickers). Every field stays a combobox, so a value not in this
  // list yet is still recorded verbatim.
  const supplierNames = Array.from(new Set((purchases ?? []).map(p => p.supplier).filter(Boolean))).sort();
  const categoryNames = Array.from(new Set((items ?? []).map(i => i.category).filter(Boolean))).sort();
  const unitNames = Array.from(new Set((items ?? []).map(i => i.unit).filter(Boolean))).sort();
  const paymentMethodNames = Array.from(new Set((purchases ?? []).map(p => p.paymentMethod).filter(Boolean))).sort();

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Farm"
          title="Inventory"
          lede="What's running low, what came in, and lots that need a walk."
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="icon-sm" onClick={() => setShowImport(true)} title="Import inventory CSV" aria-label="Import inventory CSV">
                <Upload size={14} />
              </Button>
              <Button variant="secondary" size="icon-sm" onClick={exportStockCSV} title="Export inventory CSV" aria-label="Export inventory CSV">
                <Download size={14} />
              </Button>
              <Button onClick={() => setShowRecordPurchase(true)}>
                <Plus size={14} /> Record purchase
              </Button>
            </div>
          )}
        />

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Items" value={(items ?? []).length} hint="Catalogued" onClick={() => setTab('stock')} />
          <Kpi label="Low / expiring" value={lowCount} hint={lowCount === 0 ? 'All clear' : 'Reorder these'} tone={lowCount > 0 ? 'warn' : 'ok'} onClick={() => setTab('stock')} />
          <Kpi label="Flagged" value={flaggedVariances} hint="Need a recount" tone={flaggedVariances > 0 ? 'danger' : 'plain'} onClick={() => setTab('variance')} />
          <Kpi label="Lots" value={totalLots} hint="On hand" onClick={() => setTab('stock')} />
        </div>

        <div className="mt-5">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'stock', label: 'Stock', hint: "What's running low" },
              { id: 'purchases', label: 'Purchases', hint: 'What brought it in' },
              { id: 'variance', label: 'Lots', hint: 'What needs a recount' },
            ]}
          />
        </div>

        {loading && <div className="py-10 text-center text-sm text-muted">Loading inventory…</div>}

        {/* STOCK TAB — master–detail */}
        {!loading && tab === 'stock' && (
          <div className="mt-5">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input value={stockSearch} onChange={e => setStockSearch(e.target.value)} placeholder="Search item, category, lot…" className="pl-9" aria-label="Search stock" />
              {stockSearch && (
                <button type="button" onClick={() => setStockSearch('')} className="absolute top-1/2 right-3 -translate-y-1/2 text-subtle">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="mb-4">
              <Chips value={cat} onChange={setCat} items={cats.map(c => ({ id: c, label: c }))} />
            </div>

            {(items ?? []).length === 0 ? (
              <EmptyState
                icon={<Wheat size={20} />}
                title="Nothing in stock yet"
                body="Record a purchase to bring feed, seed or medicine in. Feeding a batch later draws down from this."
                action={<Button className="w-full justify-center" onClick={() => setShowRecordPurchase(true)}><Plus size={14} /> Record a purchase</Button>}
              />
            ) : (
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
                <div className="min-w-0 rounded-xl bg-surface p-3 shadow-(--shadow-border) lg:p-4">
                  <p className="px-1 text-xs text-muted">Quantity against reorder level. A short bar is the one to reorder first.</p>
                  {sortedStock.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted">No items match your filter.</div>
                  ) : (
                    <ul className="mt-3">
                      {sortedStock.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => pickItem(item.id)}
                            className={cn('flex w-full flex-col gap-2 rounded-lg px-3 py-3 text-left', selectedId === item.id ? 'bg-primary-soft' : 'hover:bg-surface-2')}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium"><CategoryIcon category={item.category} />{item.name}</span>
                                <span className="block text-xs text-subtle">
                                  {item.qtyOnHand.toLocaleString()} {item.unit} · {item.lots.length === 1 ? item.lots[0].lotNo : `${item.lots.length} lots`}
                                </span>
                              </span>
                              <Badge variant={item.status === 'ok' ? 'success' : item.status === 'low' ? 'warning' : 'danger'}>{item.status.toUpperCase()}</Badge>
                            </span>
                            <span className="block h-1.5 overflow-hidden rounded-full bg-border">
                              <span
                                className={cn('block h-full rounded-full', item.status === 'expiring' ? 'bg-danger' : item.status === 'low' ? 'bg-warning' : 'bg-primary')}
                                style={{ width: `${stockCoverPct(item)}%` }}
                              />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="hidden min-w-0 lg:block">
                  {selectedItem ? (
                    <Dossier
                      kicker={selectedItem.category || 'Uncategorised'}
                      title={selectedItem.name}
                      lede={`${selectedItem.qtyOnHand.toLocaleString()} ${selectedItem.unit} on hand`}
                      footer={<Button className="w-full justify-center" onClick={() => setShowRecordPurchase(true)}>Record a purchase</Button>}
                    >
                      <StockDossierBody item={selectedItem} tenantId={tenantId} onAdjusted={loadItems} />
                    </Dossier>
                  ) : (
                    <EmptyState icon={<Wheat size={20} />} title="Nothing selected" body="Pick a line on the left to see its lots and purchases." />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PURCHASES TAB */}
        {!loading && tab === 'purchases' && (
          <div className="mt-5">
            {(purchases ?? []).length === 0 ? (
              <EmptyState
                icon={<Receipt size={20} />}
                title="No purchases yet"
                body="A purchase is how stock arrives. Record one to put feed, seed or medicine on the shelf."
                action={<Button className="w-full justify-center" onClick={() => setShowRecordPurchase(true)}><Plus size={14} /> Record a purchase</Button>}
              />
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {(purchases ?? []).map((p) => {
                    const status = paymentStatus(p);
                    return (
                      <li key={p.id} className="rounded-xl bg-surface p-3.5 shadow-(--shadow-border)">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{itemNameById.get(p.itemId) ?? p.itemId}</div>
                            <div className="mt-0.5 text-xs text-muted">{p.supplier} · {p.quantity.toLocaleString()}</div>
                          </div>
                          <Badge variant={status === 'paid' ? 'success' : status === 'partial' ? 'warning' : 'danger'}>{status.toUpperCase()}</Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-xs text-muted">{fmtDate(p.createdAt)}</span>
                          <span className="font-display text-lg font-medium">KSh {centsToMajor(p.totalCostCents).toLocaleString()}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <Button className="mt-4 w-full justify-center" onClick={() => setShowRecordPurchase(true)}>
                  <Plus size={14} /> Record a purchase
                </Button>
              </>
            )}
          </div>
        )}

        {/* LOTS TAB (D8: relabelled from "Variance" — staleness-based, not an
            expected-vs-actual gap; there is no physical-counts table on this
            branch, see lib/inventory.ts) */}
        {!loading && tab === 'variance' && (
          <div className="mt-5">
            <div className="mb-4 rounded-xl bg-warning-soft px-3.5 py-3 shadow-(--shadow-border)">
              <div className="flex items-center gap-1.5 text-sm font-medium text-warning"><AlertTriangle size={13} aria-hidden="true" /> Reconciliation review</div>
              <p className="mt-1 text-xs leading-relaxed text-fg/80">How long since each lot&apos;s on-hand figure was last confirmed (received or reason-adjusted). Lots stale past 30 days are flagged for a physical recount — there&apos;s no expected-vs-actual number to show without one.</p>
            </div>
            <DataTable
              rows={(variance ?? []) as unknown as Record<string, unknown>[]}
              columns={VARIANCE_COLS}
              rowKey={(r) => r.lotId as string}
              defaultPageSize={20}
              pageSizes={[10, 20, 50]}
              bodyHeight={320}
              tableId="inventory-variance"
              emptyText="No lots recorded."
            />
          </div>
        )}
      </div>

      {/* Mobile stock dossier */}
      <Inspector
        open={mobileOpen && !!selectedItem}
        onOpenChange={setMobileOpen}
        kicker={selectedItem?.category || 'Uncategorised'}
        title={selectedItem?.name ?? 'Item'}
        lede={selectedItem ? `${selectedItem.qtyOnHand.toLocaleString()} ${selectedItem.unit} on hand` : undefined}
        footer={<Button className="w-full justify-center" onClick={() => setShowRecordPurchase(true)}>Record a purchase</Button>}
      >
        {selectedItem && <StockDossierBody item={selectedItem} tenantId={tenantId} onAdjusted={loadItems} />}
      </Inspector>

      {/* CSV Import Modal */}
      {showImport && (
        <CsvImportModal
          entity="inventory"
          onClose={() => setShowImport(false)}
          onImport={handleImportRows}
        />
      )}
      {importing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: '14px 20px', fontSize: 'var(--fs-sm)', color: 'var(--text-primary)' }}>Importing…</div>
        </div>
      )}
      {/* An import that refused rows says which and why. Silently importing
          140 of 200 rows is the failure mode this replaces. */}
      {importReport && (
        <div className="fixed right-3 bottom-21 left-3 z-[210] max-h-[40vh] overflow-y-auto rounded-xl bg-surface p-3.5 text-xs leading-relaxed text-fg shadow-(--shadow-raised)">
          <div className="flex items-start gap-2.5">
            <span className="flex-1">{importReport}</span>
            <button type="button" onClick={() => setImportReport('')} className="shrink-0 text-xs font-medium text-primary">Dismiss</button>
          </div>
        </div>
      )}
      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={(items ?? []).map(i => i.name)}
          supplierNames={supplierNames}
          categories={categoryNames}
          units={unitNames}
          paymentMethods={paymentMethodNames}
          prefill={selectedItem ? { itemName: selectedItem.name, unit: selectedItem.unit, category: selectedItem.category } : undefined}
          farms={farms}
          activeFarmId={activeFarmId}
          onCreated={loadAll}
          onClose={() => setShowRecordPurchase(false)}
        />
      )}
    </div>
  );
}

export function InventoryDetailScreen() {
  const { params, tenantId, activeFarmId, farms } = useNav();
  const id = params.id;
  const [items, setItems] = useState<ApiInventoryItem[] | null>(null);
  // Purchase history, fetched tenant-wide (not just this item's) purely to
  // seed the Record Purchase sheet's Supplier/Payment Method suggestions —
  // same real-data-not-invented sourcing as InventoryScreen's Purchases tab.
  const [purchases, setPurchases] = useState<ApiPurchase[] | null>(null);
  const [showRecordPurchase, setShowRecordPurchase] = useState(false);

  const load = useCallback(() => {
    apiClient.get<ApiInventoryItem[]>(`/api/inventory/items?tenantId=${tenantId}&farmId=${activeFarmId}`).then(res => {
      if (res.success) setItems(res.data);
    });
    apiClient.get<ApiPurchase[]>(`/api/purchases?tenantId=${tenantId}&farmId=${activeFarmId}`).then(res => {
      if (res.success) setPurchases(res.data);
    });
  }, [tenantId, activeFarmId]);

  useEffect(() => { load(); }, [load]);

  if (items === null) {
    return (
      <div className="screen-content">
        <TopNav title="Item" showBack />
        <div className="px-screen pt-10 text-center text-sm text-muted">Loading item…</div>
      </div>
    );
  }

  const item = items.find(i => i.id === id);
  if (!item) {
    return (
      <div className="screen-content">
        <TopNav title="Item" showBack />
        <div className="px-screen pt-10 text-center text-sm text-muted">Item not found.</div>
      </div>
    );
  }

  // Picker suggestions for RecordPurchaseSheet — same real-data sourcing as
  // InventoryScreen.
  const supplierNames = Array.from(new Set((purchases ?? []).map(p => p.supplier).filter(Boolean))).sort();
  const categoryNames = Array.from(new Set(items.map(i => i.category).filter(Boolean))).sort();
  const unitNames = Array.from(new Set(items.map(i => i.unit).filter(Boolean))).sort();
  const paymentMethodNames = Array.from(new Set((purchases ?? []).map(p => p.paymentMethod).filter(Boolean))).sort();

  return (
    <div className="screen-content">
      <TopNav title="" showBack />
      <div className="px-screen pt-3 pb-10">
        <Dossier
          kicker={item.category || 'Uncategorised'}
          title={item.name}
          lede={`${item.qtyOnHand.toLocaleString()} ${item.unit} on hand`}
          footer={<Button className="w-full justify-center" onClick={() => setShowRecordPurchase(true)}>Record a purchase</Button>}
        >
          <StockDossierBody item={item} tenantId={tenantId} onAdjusted={load} />
        </Dossier>
      </div>

      {showRecordPurchase && (
        <RecordPurchaseSheet
          tenantId={tenantId}
          itemNames={items.map(i => i.name)}
          supplierNames={supplierNames}
          categories={categoryNames}
          units={unitNames}
          paymentMethods={paymentMethodNames}
          prefill={{ itemName: item.name, unit: item.unit, category: item.category }}
          farms={farms}
          activeFarmId={activeFarmId}
          onCreated={load}
          onClose={() => setShowRecordPurchase(false)}
        />
      )}
    </div>
  );
}
