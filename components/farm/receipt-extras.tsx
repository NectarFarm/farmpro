'use client';
// Extra lines, freight / loading / levies, and a lot split on one receipt
// (issue #423). A sheet with none of these still posts the single-item body.
// The server recomputes the apportionment. These figures are the preview.
import React from 'react';
import { Button } from '@/components/ui-kit/button';
import { DateField } from '@/components/ui-kit/date-field';
import { Field } from '@/components/ui-kit/field';
import { Input } from '@/components/ui-kit/input';
import { formatMoney, parseMoneyToCents } from '@/lib/money';
import { allocateCharges, landedUnitCostCents, type ChargeKind } from '@/lib/landed-cost';

export interface LotDraft {
  key: string;
  quantity: string;
  expiry: string;
  lotNo: string;
}

export interface LineDraft {
  key: string;
  itemName: string;
  category: string;
  unit: string;
  quantity: string;
  unitCost: string;
  expiry: string;
  lotNo: string;
  lots: LotDraft[];
}

export function newDraftKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function blankLine(): LineDraft {
  return { key: newDraftKey(), itemName: '', category: '', unit: '', quantity: '', unitCost: '', expiry: '', lotNo: '', lots: [] };
}

export function blankLot(): LotDraft {
  return { key: newDraftKey(), quantity: '', expiry: '', lotNo: '' };
}

export function receiptIsActive(extraLines: LineDraft[], charges: string[], firstLots: LotDraft[]): boolean {
  return extraLines.length > 0 || firstLots.length > 0 || charges.some((value) => value.trim() !== '');
}

interface RawLine {
  itemName: string;
  category?: string;
  unit: string;
  quantity: number;
  unitCostCents: number;
  expiryDate?: string;
  lotNo?: string;
  lots?: { quantity: number; expiryDate?: string; lotNo?: string }[];
  extendedCents: number;
}

export interface ReceiptPreviewLine {
  label: string;
  rawUnitCents: number;
  landedUnitCents: number;
  landedTotalCents: number;
}

export function previewReceipt(
  lines: { quantity: number; unitCostCents: number; label: string }[],
  chargeCents: number[],
): ReceiptPreviewLine[] | null {
  if (lines.some((line) => line.quantity <= 0)) return null;
  const allocated = allocateCharges(
    lines.map((line) => ({ extendedCents: line.quantity * line.unitCostCents, quantity: line.quantity })),
    chargeCents.filter((cents) => cents > 0).map((amountCents) => ({ amountCents })),
  );
  return lines.map((line, i) => {
    const landedTotalCents = line.quantity * line.unitCostCents + allocated[i];
    return {
      label: line.label,
      rawUnitCents: line.unitCostCents,
      landedUnitCents: landedUnitCostCents(landedTotalCents, line.quantity),
      landedTotalCents,
    };
  });
}

/** Lines and charges for POST /api/purchases. The first line is the sheet's existing item. */
export function buildReceiptParts(input: {
  first: { itemName: string; category: string; unit: string; quantity: string; unitCost: string; expiry: string; lotNo: string; lots: LotDraft[] };
  extraLines: LineDraft[];
  freight: string;
  loading: string;
  levy: string;
}): { error: string } | { lines: RawLine[]; charges: { kind: ChargeKind; amountCents: number }[]; goodsPlusCharges: number } {
  const drafts = [input.first, ...input.extraLines];
  const lines: RawLine[] = [];
  for (const draft of drafts) {
    const itemName = draft.itemName.trim();
    const unit = draft.unit.trim();
    if (!itemName) return { error: 'Each line needs an item' };
    if (!unit) return { error: 'Each line needs a unit' };
    const quantity = Number(draft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Each line needs a quantity' };
    if (!Number.isInteger(quantity)) return { error: `Quantity must be a whole number of ${unit}` };
    const unitCostCents = parseMoneyToCents(draft.unitCost);
    if (unitCostCents === null || unitCostCents < 0) return { error: 'Each line needs a unit cost' };
    const line: RawLine = {
      itemName,
      category: draft.category.trim() || undefined,
      unit,
      quantity,
      unitCostCents,
      extendedCents: quantity * unitCostCents,
    };
    if (draft.lots.length > 0) {
      const lots = [];
      let sum = 0;
      for (const lot of draft.lots) {
        const lotQty = Number(lot.quantity);
        if (!Number.isInteger(lotQty) || lotQty <= 0) return { error: 'Each lot needs a whole quantity' };
        sum += lotQty;
        lots.push({
          quantity: lotQty,
          ...(lot.expiry ? { expiryDate: lot.expiry } : {}),
          ...(lot.lotNo.trim() ? { lotNo: lot.lotNo.trim() } : {}),
        });
      }
      if (sum !== quantity) return { error: 'Lot quantities must add up to the line quantity.' };
      line.lots = lots;
    } else {
      if (draft.expiry) line.expiryDate = draft.expiry;
      if (draft.lotNo.trim()) line.lotNo = draft.lotNo.trim();
    }
    lines.push(line);
  }

  const charges: { kind: ChargeKind; amountCents: number }[] = [];
  const named: [ChargeKind, string][] = [
    ['freight', input.freight],
    ['loading', input.loading],
    ['levy', input.levy],
  ];
  for (const [kind, text] of named) {
    if (!text.trim()) continue;
    const amountCents = parseMoneyToCents(text);
    if (amountCents === null || amountCents <= 0) return { error: 'A charge must be a number above zero, or left blank' };
    charges.push({ kind, amountCents });
  }
  const goodsPlusCharges = lines.reduce((sum, line) => sum + line.extendedCents, 0) + charges.reduce((sum, charge) => sum + charge.amountCents, 0);
  return { lines, charges, goodsPlusCharges };
}

export function ReceiptExtras({
  extraLines,
  onExtraLines,
  freight,
  onFreight,
  loading,
  onLoading,
  levy,
  onLevy,
  firstLots,
  onFirstLots,
  preview,
  itemNames,
  categories,
  units,
}: {
  extraLines: LineDraft[];
  onExtraLines: (lines: LineDraft[]) => void;
  freight: string;
  onFreight: (value: string) => void;
  loading: string;
  onLoading: (value: string) => void;
  levy: string;
  onLevy: (value: string) => void;
  firstLots: LotDraft[];
  onFirstLots: (lots: LotDraft[]) => void;
  preview: ReceiptPreviewLine[] | null;
  itemNames: string[];
  categories: string[];
  units: string[];
}) {
  const inputClass = 'h-11 min-h-11';
  return (
    <div className="mb-3 flex w-full min-w-0 flex-col gap-3">
      <LotSplit lots={firstLots} onChange={onFirstLots} />
      {extraLines.map((line, index) => (
        <div key={line.key} className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted">Item {index + 2}</span>
            <Button type="button" size="lg" variant="outline" className="min-h-11" onClick={() => onExtraLines(extraLines.filter((row) => row.key !== line.key))}>
              Remove
            </Button>
          </div>
          <Field label="Item *">
            <Input className={inputClass} list={`receipt-items-${line.key}`} value={line.itemName} onChange={(e) => updateLine(extraLines, onExtraLines, line.key, { itemName: e.target.value })} />
            <datalist id={`receipt-items-${line.key}`}>{itemNames.map((name) => <option key={name} value={name} />)}</datalist>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <Input className={inputClass} list={`receipt-cats-${line.key}`} value={line.category} onChange={(e) => updateLine(extraLines, onExtraLines, line.key, { category: e.target.value })} />
              <datalist id={`receipt-cats-${line.key}`}>{categories.map((name) => <option key={name} value={name} />)}</datalist>
            </Field>
            <Field label="Unit *">
              <Input className={inputClass} list={`receipt-units-${line.key}`} value={line.unit} onChange={(e) => updateLine(extraLines, onExtraLines, line.key, { unit: e.target.value })} />
              <datalist id={`receipt-units-${line.key}`}>{units.map((name) => <option key={name} value={name} />)}</datalist>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quantity *">
              <Input className={inputClass} inputMode="numeric" value={line.quantity} onChange={(e) => updateLine(extraLines, onExtraLines, line.key, { quantity: e.target.value })} />
            </Field>
            <Field label="Raw unit cost (KSh) *">
              <Input className={inputClass} inputMode="decimal" value={line.unitCost} onChange={(e) => updateLine(extraLines, onExtraLines, line.key, { unitCost: e.target.value })} />
            </Field>
          </div>
          <Field label="Expiry (optional)">
            <DateField aria-label={`Expiry for item ${index + 2}`} value={line.expiry} onChange={(value) => updateLine(extraLines, onExtraLines, line.key, { expiry: value })} />
          </Field>
          <LotSplit lots={line.lots} onChange={(lots) => updateLine(extraLines, onExtraLines, line.key, { lots })} />
          {preview?.[index + 1] && (
            <p className="text-xs text-muted">
              Raw {formatMoney(preview[index + 1].rawUnitCents)} · Landed {formatMoney(preview[index + 1].landedUnitCents)} · Line {formatMoney(preview[index + 1].landedTotalCents)}
            </p>
          )}
        </div>
      ))}
      <Button type="button" size="lg" variant="secondary" className="min-h-11 w-full" onClick={() => onExtraLines([...extraLines, blankLine()])}>
        Add another item
      </Button>
      <Field label="Freight (KSh)">
        <Input className={inputClass} inputMode="decimal" placeholder="Blank if none" value={freight} onChange={(e) => onFreight(e.target.value)} />
      </Field>
      <Field label="Loading (KSh)">
        <Input className={inputClass} inputMode="decimal" placeholder="Blank if none" value={loading} onChange={(e) => onLoading(e.target.value)} />
      </Field>
      <Field label="Levies (KSh)">
        <Input className={inputClass} inputMode="decimal" placeholder="Blank if none" value={levy} onChange={(e) => onLevy(e.target.value)} />
      </Field>
      {preview && preview.length > 0 && (extraLines.length > 0 || freight.trim() || loading.trim() || levy.trim()) && (
        <div className="flex flex-col gap-1 rounded-lg bg-primary-soft px-3 py-2.5 text-sm">
          {preview.map((line, index) => (
            <div key={`${line.label}-${index}`} className="flex flex-col">
              <span className="text-muted">{line.label}</span>
              <span>Raw {formatMoney(line.rawUnitCents)}</span>
              <span>Landed {formatMoney(line.landedUnitCents)}</span>
              <span>Line {formatMoney(line.landedTotalCents)}</span>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-muted">Freight, loading and levies are shared across these items by their cost. They are not a separate stock item.</p>
        </div>
      )}
    </div>
  );
}

function LotSplit({ lots, onChange }: { lots: LotDraft[]; onChange: (lots: LotDraft[]) => void }) {
  if (lots.length === 0) {
    return (
      <Button type="button" size="lg" variant="outline" className="min-h-11 w-full" onClick={() => onChange([blankLot(), blankLot()])}>
        Split this quantity into lots
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">Each lot gets the same landed unit cost and its own expiry. The quantities have to add up to the line.</p>
      {lots.map((lot, index) => (
        <div key={lot.key} className="grid grid-cols-2 gap-2">
          <Field label={`Lot ${index + 1} quantity *`}>
            <Input className="h-11 min-h-11" inputMode="numeric" value={lot.quantity} onChange={(e) => onChange(lots.map((row) => row.key === lot.key ? { ...row, quantity: e.target.value } : row))} />
          </Field>
          <Field label="Expiry">
            <DateField aria-label={`Expiry for lot ${index + 1}`} value={lot.expiry} onChange={(value) => onChange(lots.map((row) => row.key === lot.key ? { ...row, expiry: value } : row))} />
          </Field>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" size="lg" variant="secondary" className="min-h-11" onClick={() => onChange([...lots, blankLot()])}>Add a lot</Button>
        <Button type="button" size="lg" variant="outline" className="min-h-11" onClick={() => onChange([])}>One lot</Button>
      </div>
    </div>
  );
}

function updateLine(lines: LineDraft[], onChange: (lines: LineDraft[]) => void, key: string, patch: Partial<LineDraft>) {
  onChange(lines.map((line) => line.key === key ? { ...line, ...patch } : line));
}
