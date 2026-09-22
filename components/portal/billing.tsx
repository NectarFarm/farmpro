'use client';
// ── Plan & billing (package H2, SaaS back-office) ───────────────────────────
// Owner: full control. Manager: read-only (status/plan/renewal/usage) — the
// backend itself keeps every mutation owner-only (docs/backoffice-api.md
// §2: "Billing is treated as an owner-level concern throughout"), so this
// screen just doesn't render the action buttons for a manager rather than
// rendering them and letting the API 403. GET /api/billing/subscription is
// the one route open to every tenant role.
import { useEffect, useState } from 'react';
import { useNav, TopNav } from '@/components/farm/navigation';
import { apiClient } from '@/lib/request';
import { useToast } from '@/components/farm/ui-shared';
import { useConfirm } from '@/components/farm/ui-shared';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Field, controlClass } from '@/components/ui-kit/field';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { cn } from '@/lib/utils';
import { CreditCard, Receipt } from 'lucide-react';

type Method = 'mobile_money' | 'bank' | 'card' | 'cash' | 'other';
type PayStatus = 'pending' | 'confirmed' | 'rejected';

interface SubscriptionData {
  subscription: {
    id: string; period: string; status: string; trialEndsAt: string | null;
    currentPeriodStart: string | null; currentPeriodEnd: string | null;
    listPriceCents: number; discountAmountCents: number; amountDueCents: number;
    cancelAtPeriodEnd: boolean;
  } | null;
  plan: { id: string; code: string; name: string; tagline: string; features: string[]; limits: { maxFarms: number | null; maxUsers: number | null; maxUnits: number | null }; currency: string } | null;
  usage: { farms: number; users: number; units: number };
  access: { status: string; needsPlan: boolean };
}

interface Payment {
  id: string; amountCents: number; currency: string; method: Method; reference: string;
  status: PayStatus; createdAt: string;
}

const STATUS_BADGE: Record<string, 'warning' | 'primary' | 'success' | 'danger' | 'default'> = {
  trialing: 'primary', pending_payment: 'warning', active: 'success',
  past_due: 'warning', cancelled: 'default', expired: 'danger',
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-subtle">{used} {limit === null ? '(unlimited)' : `/ ${limit}`}</span>
      </div>
      {limit !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function BillingScreen() {
  const { role, navigate, refreshSubscription } = useNav();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const isOwner = role === 'owner';
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  function load() {
    apiClient.get<SubscriptionData>('/api/billing/subscription').then((res) => {
      if (res.success && res.data) setData(res.data);
    });
    if (isOwner) {
      apiClient.get<Payment[]>('/api/billing/payments').then((res) => {
        if (res.success && Array.isArray(res.data)) setPayments(res.data);
      });
    }
  }
  useEffect(load, [isOwner]);

  async function handleCancel() {
    const ok = await confirm({
      message: 'Cancel this subscription?',
      detail: data?.subscription?.currentPeriodEnd
        ? `Access continues until ${fmtDate(data.subscription.currentPeriodEnd)}, then stops.`
        : 'This takes effect immediately.',
      variant: 'danger', confirmLabel: 'Cancel plan',
    });
    if (!ok) return;
    const res = await apiClient.post('/api/billing/cancel', {});
    if (!res.success) { showToast(res.error, 'error'); return; }
    showToast('Subscription cancelled.', 'success');
    refreshSubscription();
    load();
  }

  if (!data) {
    return (<div className="screen-content"><TopNav title="Plan & billing" /><div className="px-screen pt-10 text-center text-sm text-muted">Loading…</div></div>);
  }

  const { subscription: sub, plan, usage, access } = data;

  return (
    <div className="screen-content">
      <TopNav title="Plan & billing" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader kicker="Company" title="Plan & billing" lede={isOwner ? 'Your plan, usage and payments.' : 'Your farm’s plan and usage — the owner manages billing.'} />

        {!plan ? (
          <div className="mt-5"><EmptyState icon={<CreditCard size={20} />} title="No plan yet" body="This farm has no subscription on record." /></div>
        ) : (
          <div className="mt-5 rounded-xl bg-surface p-5 shadow-(--shadow-border)">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-display text-2xl font-medium">{plan.name}</div>
                <div className="text-sm text-muted">{plan.tagline}</div>
              </div>
              <Badge variant={STATUS_BADGE[access.status] ?? 'default'}>{access.status.replace('_', ' ')}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {sub?.trialEndsAt && access.status === 'trialing' && (
                <div><dt className="text-xs text-subtle">Trial ends</dt><dd>{fmtDate(sub.trialEndsAt)}</dd></div>
              )}
              {sub?.currentPeriodEnd && (
                <div><dt className="text-xs text-subtle">{sub.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}</dt><dd>{fmtDate(sub.currentPeriodEnd)}</dd></div>
              )}
              {sub && (
                <div><dt className="text-xs text-subtle">Amount due</dt><dd>{formatMoney(sub.amountDueCents, plan.currency)} / {sub.period}</dd></div>
              )}
              {sub?.cancelAtPeriodEnd && (
                <div className="col-span-2 text-xs text-warning">Cancels at period end — no further charges.</div>
              )}
            </dl>

            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
              <Meter label="Farms" used={usage.farms} limit={plan.limits.maxFarms} />
              <Meter label="Users" used={usage.users} limit={plan.limits.maxUsers} />
              <Meter label="Production units" used={usage.units} limit={plan.limits.maxUnits} />
            </div>

            {isOwner && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
                <Button variant="secondary" onClick={() => navigate('plan-select')}>Change plan / period</Button>
                {sub && !sub.cancelAtPeriodEnd && access.status !== 'cancelled' && access.status !== 'expired' && (
                  <Button variant="outline" onClick={handleCancel}>Cancel at period end</Button>
                )}
              </div>
            )}
          </div>
        )}

        {isOwner && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-medium">Payments</h2>
              <Button size="sm" onClick={() => setPayOpen(true)}><Receipt size={14} /> Record a payment</Button>
            </div>
            <div className="mt-3">
              {payments === null ? (
                <div className="py-6 text-center text-sm text-muted">Loading…</div>
              ) : payments.length === 0 ? (
                <EmptyState icon={<Receipt size={20} />} title="No payments yet" body="Recorded payments will appear here, awaiting confirmation by IFMS." />
              ) : (
                <ul className="flex flex-col gap-1">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-lg px-3 py-2.5 shadow-(--shadow-border)">
                      <div>
                        <div className="text-sm font-medium">{formatMoney(p.amountCents, p.currency)}</div>
                        <div className="text-xs text-subtle">{p.method.replace('_', ' ')} · {p.reference || 'no reference'} · {fmtDate(p.createdAt)}</div>
                      </div>
                      <Badge variant={p.status === 'confirmed' ? 'success' : p.status === 'rejected' ? 'danger' : 'warning'}>
                        {p.status === 'pending' ? 'Awaiting confirmation' : p.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {isOwner && (
        <RecordPaymentSheet open={payOpen} onClose={() => setPayOpen(false)} onRecorded={() => { setPayOpen(false); load(); showToast('Payment submitted — awaiting confirmation by IFMS.', 'success'); }} />
      )}
    </div>
  );
}

function RecordPaymentSheet({ open, onClose, onRecorded }: { open: boolean; onClose: () => void; onRecorded: () => void }) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('mobile_money');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!amount.trim()) { showToast('Enter the amount paid.', 'error'); return; }
    setSubmitting(true);
    const res = await apiClient.post('/api/billing/payments', { amount, method, reference: reference.trim(), note: note.trim() || undefined });
    setSubmitting(false);
    if (!res.success) { showToast(res.error, 'error'); return; }
    setAmount(''); setReference(''); setNote('');
    onRecorded();
  }

  return (
    <Sheet open={open} onOpenChange={onClose} side="bottom">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3"><SheetTitle>Record a payment</SheetTitle></div>
      <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4">
        <Field label="Amount paid">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={{ fontSize: 16 }} />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)} className={controlClass}>
            <option value="mobile_money">Mobile money</option>
            <option value="bank">Bank</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Reference (transaction id, slip number)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} style={{ fontSize: 16 }} />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} style={{ fontSize: 16 }} />
        </Field>
        <p className="text-xs text-subtle">Submitting doesn't activate the plan immediately — IFMS confirms each payment before it takes effect.</p>
      </div>
      <div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button className="w-full" disabled={submitting} onClick={submit}>{submitting ? 'Submitting…' : 'Submit payment'}</Button>
      </div>
    </Sheet>
  );
}
