'use client';
// Record an expense that is not stock (issue #416).
// POST /api/expenses writes the expense and its journal entry. It does not
// call the purchase route and it does not create an inventory lot.
import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import { parseMoneyToCents, formatMoney } from '@/lib/money';
import { todayInTimezone } from '@/lib/datetime';
import { compressImageFile } from '@/lib/image-compress';
import { referenceLabel } from '@/lib/payment-method';
import { useRegional } from './settings';
import { useNav } from './navigation';
import { Receipt } from './icons';
import { cn } from '@/lib/utils';
import { fmtFarmDate } from '@/lib/datetime';
import {
  fieldErrorStyle, FieldError, PaymentMethodFields, SaveConfirmation, SaveError, MasterPicker,
  useRequiredDimensions, RequiredDimensionFields, missingDimensionErrors, dimensionsForSubmit,
  useToast, type SaveReceipt, type MasterOption,
} from './ui-shared';
import { Button } from '@/components/ui-kit/button';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { Field } from '@/components/ui-kit/field';
import { Input } from '@/components/ui-kit/input';
import { Select } from '@/components/ui-kit/select';
import { DateField } from '@/components/ui-kit/date-field';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Dialog, DialogTitle, DialogDescription } from '@/components/ui-kit/dialog';
import { controlClass } from '@/components/ui-kit/field';
import { Kv } from '@/components/ui-kit/inspector';
import { StatusTimeline } from './status-timeline';

const inputClass = 'min-h-11 h-11';

export interface ApiExpenseCategory {
  id: string;
  code: string;
  name: string;
  accountCode: string;
  active: boolean;
}

export interface ApiExpense {
  id: string;
  payee: string;
  supplierId: string | null;
  categoryId: string;
  categoryName: string;
  accountCode: string;
  amountCents: number;
  amountPaidCents: number;
  paymentMethod: string;
  paymentReference: string | null;
  farmId: string | null;
  unitId: string | null;
  notes: string | null;
  photoUrl: string | null;
  transactionDate: string | null;
  postingDate: string | null;
  recordedBy: string | null;
  reversedAt: string | null;
  createdAt: string;
}

interface ApiUnit {
  id: string;
  name: string;
  farmId: string;
}

export function RecordExpenseSheet({ tenantId, farms, activeFarmId, onCreated, onViewList, onClose }: {
  tenantId: string;
  farms: { id: string; name: string }[];
  activeFarmId: string;
  onCreated: () => void;
  onViewList: () => void;
  onClose: () => void;
}) {
  const { navigate } = useNav();
  const { timezone } = useRegional();
  const todayIso = todayInTimezone(timezone);

  const [payee, setPayee] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<MasterOption[]>([]);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [categories, setCategories] = useState<ApiExpenseCategory[] | null>(null);
  const [categoriesError, setCategoriesError] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [reference, setReference] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [farmId, setFarmId] = useState(activeFarmId !== 'ALL' ? activeFarmId : (farms.length === 1 ? farms[0].id : ''));
  const [units, setUnits] = useState<ApiUnit[] | null>(null);
  const [unitsError, setUnitsError] = useState('');
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayIso);
  const [postingDate, setPostingDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<SaveReceipt | null>(null);
  const [dimPicks, setDimPicks] = useState<Record<string, string>>({});

  const selectedCategory = (categories ?? []).find((c) => c.id === categoryId) ?? null;
  const { missing: requiredDims } = useRequiredDimensions(
    tenantId, 'expense', farmId ? 'farm' : undefined, farmId || undefined, selectedCategory?.accountCode,
  );

  const amountCentsLive = parseMoneyToCents(amount);
  const paidCentsLive = amountPaid.trim() ? parseMoneyToCents(amountPaid) : 0;

  useEffect(() => {
    apiClient.get<MasterOption[]>(`/api/suppliers?tenantId=${tenantId}&active=true`).then((res) => {
      if (res.success) setSuppliers(res.data);
    });
  }, [tenantId]);

  useEffect(() => {
    apiClient.get<ApiExpenseCategory[]>(`/api/expense-categories?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setCategories(res.data); setCategoriesError(''); }
      else { setCategories([]); setCategoriesError(res.error || 'Could not load expense categories.'); }
    });
  }, [tenantId]);

  useEffect(() => {
    if (!farmId) { setUnits([]); setUnitsError(''); setUnitId(''); return; }
    let cancelled = false;
    setUnits(null);
    apiClient.get<ApiUnit[]>(`/api/units?tenantId=${tenantId}&farmId=${farmId}`).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setUnits(res.data);
        setUnitsError('');
        setUnitId((cur) => (res.data.some((u) => u.id === cur) ? cur : ''));
      } else {
        setUnits([]);
        setUnitsError(res.error || 'Could not load houses for this farm.');
        setUnitId('');
      }
    });
    return () => { cancelled = true; };
  }, [tenantId, farmId]);

  // Credit means unpaid: choosing it locks "Paid now" at 0. A different
  // method afterwards hands control of "Paid now" back to the owner rather
  // than guessing what they paid — same rule as the purchase sheet
  // (components/farm/finance.tsx). Copying the amount in here went stale the
  // moment the amount was corrected, leaving the difference in Accounts
  // Payable on an expense the owner had marked paid.
  function onMethodChange(next: string) {
    setPaymentMethod(next);
    if (next === 'Credit') setAmountPaid('0');
    else if (paymentMethod === 'Credit') setAmountPaid('');
  }

  async function createSupplier() {
    const name = payee.trim();
    if (!name) return;
    setCreatingSupplier(true);
    const res = await apiClient.post<MasterOption>('/api/suppliers', { tenantId, name });
    setCreatingSupplier(false);
    if (res.success) {
      setSuppliers((prev) => [...prev, res.data]);
      setSupplierId(res.data.id);
    }
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

  async function save() {
    const amountCents = parseMoneyToCents(amount);
    const amountPaidCents = amountPaid.trim() ? parseMoneyToCents(amountPaid) : null;
    const errs: Record<string, string> = {};
    if (!date) errs.date = 'Date is required';
    if (!farmId) errs.farmId = 'Select which farm this expense is for';
    if (!payee.trim()) errs.payee = 'Payee is required';
    if (!categoryId) errs.categoryId = 'Choose an expense category';
    if (amountCents === null || amountCents <= 0) errs.amount = 'Amount must be more than zero';
    if (!paymentMethod) errs.paymentMethod = 'Choose how this was paid';
    const refLabel = referenceLabel(paymentMethod);
    if (refLabel && !reference.trim()) errs.reference = `${refLabel} is required`;
    if (amountPaid.trim() && amountPaidCents === null) errs.amountPaid = 'Paid now must be a number';
    else if (amountPaidCents !== null && amountPaidCents < 0) errs.amountPaid = 'Paid now cannot be negative';
    else if (amountPaidCents !== null && amountCents !== null && amountPaidCents > amountCents) {
      errs.amountPaid = 'Paid now is more than the expense';
    }
    Object.assign(errs, missingDimensionErrors(requiredDims, dimPicks));
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setError('');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setError('');
    const res = await apiClient.post<{ expense: { id: string } }>('/api/expenses', {
      tenantId,
      payee: payee.trim(),
      supplierId: supplierId || undefined,
      categoryId,
      amountCents,
      amountPaidCents: amountPaidCents ?? undefined,
      paymentMethod,
      paymentReference: reference.trim() || undefined,
      farmId,
      unitId: unitId || undefined,
      date,
      postingDate: postingDate || undefined,
      notes: notes.trim() || undefined,
      photoUrl: photo || undefined,
      dimensions: dimensionsForSubmit(requiredDims, dimPicks),
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      setReceipt({
        id: res.data.expense?.id,
        totalLabel: 'Amount',
        totalCents: amountCents as number,
        stockEffect: 'No stock was created. This is an expense only.',
      });
    } else {
      setError(res.error || 'Failed to record the expense.');
    }
  }

  if (receipt) {
    return (
      <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85dvh]">
        <SheetTitle className="sr-only">Expense recorded</SheetTitle>
        <SaveConfirmation title="Expense recorded" receipt={receipt} onViewList={onViewList} onDone={onClose} />
      </Sheet>
    );
  }

  const catalogueMissing = categories !== null && categories.length === 0 && !categoriesError;
  const canSave = !saving && !photoBusy && categories !== null && categories.length > 0 && farms.length > 0;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85dvh]">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-4">
          <SheetTitle className="mb-1.5">Record expense</SheetTitle>
          <p className="mb-4 text-xs leading-relaxed text-muted">
            Transport, labour, a vet visit, airtime, or anything else that is money out and not stock. Nothing is added to Inventory.
          </p>

          {categories === null && !categoriesError && (
            <p className="mb-4 text-sm text-muted">Loading expense categories…</p>
          )}
          {categoriesError && <p className="mb-4 text-sm text-danger">{categoriesError}</p>}
          {catalogueMissing && (
            <div className="mb-4">
              <EmptyState
                icon={<Receipt size={20} aria-hidden="true" />}
                title="No expense categories"
                body="The platform catalogue has no active expense category. A platform admin has to add one before an expense can be recorded."
              />
            </div>
          )}
          {farms.length === 0 && (
            <div className="mb-4">
              <EmptyState
                icon={<Receipt size={20} aria-hidden="true" />}
                title="No farm yet"
                body="This expense has to belong to a farm, and this business has none set up."
              />
            </div>
          )}

          <div className="mb-3 flex flex-col gap-3">
            <Field label="Date *">
              <DateField max={todayIso} value={date} onChange={setDate} invalid={!!fieldErrors.date} />
              <FieldError message={fieldErrors.date} />
            </Field>
            <Field label="Farm *">
              <Select
                value={farmId}
                onChange={setFarmId}
                placeholder="Select a farm…"
                style={fieldErrorStyle(!!fieldErrors.farmId)}
                aria-invalid={!!fieldErrors.farmId}
              >
                <option value="" disabled>Select a farm…</option>
                {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
              <FieldError message={fieldErrors.farmId} />
            </Field>
            {farmId && units === null && !unitsError && (
              <p className="text-xs text-muted">Loading houses…</p>
            )}
            {unitsError && <p className="text-xs text-danger">{unitsError}</p>}
            {farmId && units !== null && units.length === 0 && !unitsError && (
              <p className="text-xs text-muted">No houses on this farm. The expense will be recorded against the farm only.</p>
            )}
            {units !== null && units.length > 0 && (
              <Field label="House (optional)">
                <Select value={unitId} onChange={setUnitId} placeholder="Whole farm">
                  <option value="">Whole farm — no specific house</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </Field>
            )}
            <div>
              <MasterPicker
                label="Payee *" listId="expense-payees" options={suppliers}
                name={payee} onNameChange={setPayee} onResolvedChange={setSupplierId}
                onCreate={createSupplier} creating={creatingSupplier} placeholder="A supplier, or a name with no record"
              />
              <FieldError message={fieldErrors.payee} />
            </div>
            {categories !== null && categories.length > 0 && (
              <Field label="Category *">
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="Choose a category…"
                  style={fieldErrorStyle(!!fieldErrors.categoryId)}
                  aria-invalid={!!fieldErrors.categoryId}
                >
                  <option value="" disabled>Choose a category…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <FieldError message={fieldErrors.categoryId} />
              </Field>
            )}
            <RequiredDimensionFields
              tenantId={tenantId} missing={requiredDims} picks={dimPicks} fieldErrors={fieldErrors} knownFarmId={farmId}
              onPick={(code, value) => setDimPicks((prev) => ({ ...prev, [code]: value }))}
            />
            <Field label="Amount (KSh) *">
              <Input
                className={inputClass} inputMode="decimal" placeholder="0.00" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.amount)}
                aria-invalid={!!fieldErrors.amount}
              />
              <FieldError message={fieldErrors.amount} />
              {amountCentsLive !== null && amountCentsLive > 0 && (
                <p className="text-xs text-muted">{formatMoney(amountCentsLive)}</p>
              )}
            </Field>
            <div>
              <PaymentMethodFields method={paymentMethod} onMethodChange={onMethodChange} reference={reference} onReferenceChange={setReference} />
              <FieldError message={fieldErrors.paymentMethod || fieldErrors.reference} />
            </div>
            <Field label="Paid now (KSh)">
              <Input
                className={inputClass} inputMode="decimal" placeholder="Leave blank if unpaid" value={amountPaid}
                disabled={paymentMethod === 'Credit'}
                onChange={(e) => setAmountPaid(e.target.value)}
                style={fieldErrorStyle(!!fieldErrors.amountPaid)}
                aria-invalid={!!fieldErrors.amountPaid}
              />
              <p className="text-[11px] leading-relaxed text-muted">Leave this blank if it has not been paid yet. The unpaid part is owed to the payee.</p>
              <FieldError message={fieldErrors.amountPaid} />
              {amountCentsLive !== null && paidCentsLive !== null && (
                <p className="text-xs text-muted">Still owed {formatMoney(Math.max(0, amountCentsLive - paidCentsLive))}</p>
              )}
            </Field>
            <Field label="Posting date (optional)">
              <DateField max={todayIso} value={postingDate} onChange={setPostingDate} />
              <p className="text-[11px] leading-relaxed text-muted">Which month this counts in. Defaults to the date above.</p>
            </Field>
            <Field label="Note (optional)">
              <textarea className={cn(controlClass, 'min-h-11 h-auto py-2')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering" />
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted">Receipt photo (optional)</span>
              {photo && <img src={photo} alt="Receipt" className="mb-2 max-h-40 w-full rounded-lg object-cover" />}
              <label className={cn(
                'flex min-h-11 w-full items-center justify-center rounded-md bg-primary-soft text-sm font-semibold text-primary',
                photoBusy ? 'opacity-60' : 'cursor-pointer',
              )}>
                {photoBusy ? 'Adding…' : photo ? 'Retake photo' : 'Add a photo'}
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" disabled={photoBusy} />
              </label>
              {photoError && <p className="mt-1 text-xs text-danger">{photoError}</p>}
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-border bg-surface px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {error && <SaveError message={error} onSetupDimensions={() => { onClose(); navigate('dimensions'); }} />}
          <Button size="lg" className="w-full justify-center" disabled={!canSave} onClick={save}>
            {saving ? 'Saving…' : 'Record expense'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export function ExpenseDetailSheet({ tenantId, expense, farms, onClose, onChanged }: {
  tenantId: string;
  expense: ApiExpense;
  farms: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [showReverse, setShowReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState('');
  const [houseName, setHouseName] = useState<string | null>(null);
  const [houseMissing, setHouseMissing] = useState(false);

  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payReason, setPayReason] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  const reversed = !!expense.reversedAt;
  const farmName = expense.farmId ? farms.find((f) => f.id === expense.farmId)?.name : null;

  useEffect(() => {
    if (!expense.unitId || !expense.farmId) { setHouseName(null); setHouseMissing(false); return; }
    let cancelled = false;
    apiClient.get<ApiUnit[]>(`/api/units?tenantId=${tenantId}&farmId=${expense.farmId}`).then((res) => {
      if (cancelled) return;
      if (!res.success) { setHouseMissing(true); return; }
      const match = res.data.find((u) => u.id === expense.unitId);
      if (match) setHouseName(match.name);
      else setHouseMissing(true);
    });
    return () => { cancelled = true; };
  }, [tenantId, expense.farmId, expense.unitId]);

  async function confirmReverse() {
    if (!reverseReason.trim()) return;
    setReversing(true); setReverseError('');
    const res = await apiClient.post(`/api/expenses/${expense.id}/reverse`, { tenantId, reason: reverseReason.trim() });
    setReversing(false);
    if (res.success) { showToast('Expense reversed', 'success'); setShowReverse(false); onChanged(); onClose(); }
    else setReverseError(res.error ?? 'Could not reverse this expense');
  }

  const owed = Math.max(0, expense.amountCents - expense.amountPaidCents);

  async function confirmPay() {
    const cents = parseMoneyToCents(payAmount);
    if (cents === null || cents <= 0) { setPayError('Enter the amount paid'); return; }
    if (cents > owed) { setPayError(`That is more than the ${formatMoney(owed)} still owed`); return; }
    if (!payMethod || payMethod === 'Credit') { setPayError('Choose how this was paid'); return; }
    const refLabel = referenceLabel(payMethod);
    if (refLabel && !payReference.trim()) { setPayError(`${refLabel} is required`); return; }
    if (!payReason.trim()) { setPayError('Say what this payment is for'); return; }
    setPaying(true); setPayError('');
    const res = await apiClient.post(`/api/expenses/${expense.id}/payments`, {
      tenantId, amountCents: cents, paymentMethod: payMethod,
      paymentReference: payReference.trim() || undefined, reason: payReason.trim(),
    });
    setPaying(false);
    if (res.success) { showToast('Payment recorded', 'success'); setShowPay(false); onChanged(); onClose(); }
    else setPayError(res.error ?? 'Could not record this payment');
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} side="bottom" className="rounded-t-2xl max-h-[85dvh]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <SheetTitle className="truncate">{expense.payee}</SheetTitle>
          {reversed && <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-semibold text-danger">Reversed</span>}
        </div>
        <p className="mb-4 text-sm text-muted">{expense.categoryName} · {fmtFarmDate(expense.postingDate ?? expense.transactionDate ?? expense.createdAt)}</p>
        <div className="mb-4 rounded-xl bg-surface-2 px-3.5">
          <Kv label="Amount" value={formatMoney(expense.amountCents)} />
          <Kv label="Paid" value={formatMoney(expense.amountPaidCents)} />
          <Kv label="Still owed" value={formatMoney(owed)} />
          <Kv label="Payment" value={expense.paymentMethod || '—'} />
          <Kv label="Reference" value={expense.paymentReference || '—'} />
          <Kv label="Account" value={expense.accountCode} />
          <Kv label="Farm" value={farmName ?? (expense.farmId ? 'This farm is not in your farm list' : '—')} />
          {expense.unitId && <Kv label="House" value={houseName ?? (houseMissing ? 'This house is not on the farm list anymore' : 'Loading…')} />}
          {!expense.unitId && <Kv label="House" value="No specific house" />}
          <Kv label="Note" value={expense.notes || '—'} />
        </div>
        {expense.photoUrl && <img src={expense.photoUrl} alt="Receipt" className="mb-4 max-h-48 w-full rounded-lg object-cover" />}
        <p className="mb-4 text-sm text-muted">This did not create inventory. The amount is not editable — reversing posts a contra entry and leaves the original figure as it was.</p>
        {!reversed && owed > 0 && (
          <Button size="lg" className="mb-2 w-full justify-center" onClick={() => setShowPay(true)}>Record payment</Button>
        )}
        {!reversed && (
          <Button variant="outline" size="lg" className="mb-4 w-full justify-center" onClick={() => setShowReverse(true)}>Reverse</Button>
        )}
        <StatusTimeline tenantId={tenantId} entity="expense" entityId={expense.id} />
      </div>
      <Dialog open={showPay} onOpenChange={(o) => { if (!o) setShowPay(false); }}>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>
          {formatMoney(owed)} is still owed on this expense. A payment is recorded as its own entry; the original expense is not changed.
        </DialogDescription>
        <div className="mt-2 space-y-3">
          <Field label="Amount paid (KSh) *">
            <Input className={inputClass} inputMode="decimal" placeholder="0.00" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus />
          </Field>
          <PaymentMethodFields method={payMethod} onMethodChange={setPayMethod} reference={payReference} onReferenceChange={setPayReference} />
          <Field label="What is this payment for? *">
            <Input className={inputClass} value={payReason} onChange={(e) => setPayReason(e.target.value)} placeholder="e.g. Settled the rider's weekly bill" />
          </Field>
        </div>
        {payError && <div className="mt-2 text-sm text-danger">{payError}</div>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setShowPay(false)} disabled={paying}>Cancel</Button>
          <Button size="lg" className="flex-1" disabled={paying} onClick={confirmPay}>{paying ? 'Saving…' : 'Record payment'}</Button>
        </div>
      </Dialog>
      <Dialog open={showReverse} onOpenChange={(o) => { if (!o) setShowReverse(false); }}>
        <DialogTitle>Reverse this expense?</DialogTitle>
        <DialogDescription>
          This posts a contra entry that cancels {formatMoney(expense.amountCents)} from the ledger. The expense stays on record, marked reversed. No stock changes, because none was created.
        </DialogDescription>
        <textarea
          className={cn(controlClass, 'mt-2 min-h-11 h-24 resize-none py-2 text-base')}
          value={reverseReason}
          onChange={(e) => setReverseReason(e.target.value)}
          placeholder="Why is this being reversed?"
          autoFocus
        />
        {reverseError && <div className="mt-2 text-sm text-danger">{reverseError}</div>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setShowReverse(false)} disabled={reversing}>Cancel</Button>
          <Button variant="outline" size="lg" className="flex-1" disabled={reversing || !reverseReason.trim()} onClick={confirmReverse}>
            {reversing ? 'Reversing…' : 'Reverse expense'}
          </Button>
        </div>
      </Dialog>
    </Sheet>
  );
}
