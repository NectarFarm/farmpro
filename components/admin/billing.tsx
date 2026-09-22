'use client';
// ── Billing console (package H1, docs/backoffice-api.md §2) ─────────────────
// Payments review queue first (the actionable one), then Plans, Discounts,
// Subscriptions. All capability: billing.manage.
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from '../farm/navigation';
import { apiClient } from '@/lib/request';
import { useToast } from '../farm/ui-shared';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Segmented } from '@/components/ui-kit/segmented';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { useAdminCapabilities } from './capabilities';
import {
  type AdminPaymentRow, type AdminPlan, type AdminDiscount, type AdminSubscriptionRow,
  type PlanPeriod, type PlanLimits, type PlanPrices,
  centsToDisplay, fmtDate,
} from './types';
import { ShieldAlert, Check, X, CreditCard } from 'lucide-react';

type Tab = 'payments' | 'plans' | 'discounts' | 'subscriptions';

export function AdminBillingScreen() {
  const { params } = useNav();
  const { has } = useAdminCapabilities();
  const [tab, setTab] = useState<Tab>((params.tab as Tab) || 'payments');
  useEffect(() => { if (params.tab) setTab(params.tab as Tab); }, [params.tab]);

  if (!has('billing.manage')) {
    return (
      <div className="screen-content">
        <TopNav title="" />
        <div className="px-screen pt-3 pb-10">
          <PageHeader kicker="Billing" title="Billing" />
          <EmptyState icon={<ShieldAlert size={20} />} title="Not available" body="Your platform-staff account doesn't have the billing.manage capability." />
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader kicker="Billing" title="Billing" lede="Plans, discounts, subscriptions and the payments you still need to review." />
        <div className="mt-4">
          <Segmented
            value={tab}
            onChange={setTab}
            items={[
              { id: 'payments', label: 'Payments', hint: 'Review queue' },
              { id: 'plans', label: 'Plans', hint: 'What tenants can buy' },
              { id: 'discounts', label: 'Discounts', hint: 'Codes & targeted offers' },
              { id: 'subscriptions', label: 'Subscriptions', hint: 'Every tenant, by status' },
            ]}
          />
        </div>
        <div className="mt-5">
          {tab === 'payments' && <PaymentsTab />}
          {tab === 'plans' && <PlansTab />}
          {tab === 'discounts' && <DiscountsTab />}
          {tab === 'subscriptions' && <SubscriptionsTab />}
        </div>
      </div>
    </div>
  );
}

function PaymentsTab() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<AdminPaymentRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const res = await apiClient.get<AdminPaymentRow[]>(`/api/admin/payments?status=${status}`);
    if (res.success) setRows(res.data);
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function confirm(id: string) {
    setBusyId(id);
    const res = await apiClient.post(`/api/admin/payments/${id}/confirm`, {});
    setBusyId(null);
    if (!res.success) { showToast(res.error || 'Failed to confirm.', 'error'); return; }
    showToast('Payment confirmed', 'success'); void load();
  }
  async function reject(id: string) {
    if (!note.trim()) { showToast('A note is required to reject a payment', 'error'); return; }
    setBusyId(id);
    const res = await apiClient.post(`/api/admin/payments/${id}/reject`, { reviewNote: note.trim() });
    setBusyId(null);
    if (!res.success) { showToast(res.error || 'Failed to reject.', 'error'); return; }
    setRejectId(null); setNote(''); showToast('Payment rejected', 'warning'); void load();
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {(['pending', 'all'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)}
            className={`h-8 rounded-full px-3 text-xs font-medium uppercase tracking-wide ${status === s ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted'}`}>
            {s === 'pending' ? 'Pending' : 'All'}
          </button>
        ))}
      </div>
      {rows === null && <div className="py-8 text-center text-sm text-muted">Loading…</div>}
      {rows !== null && rows.length === 0 && <EmptyState icon={<CreditCard size={20} />} title="Nothing to review" body="No payments match this filter." />}
      <div className="flex flex-col gap-2">
        {(rows ?? []).map((p) => (
          <div key={p.id} className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{p.tenantName} — {centsToDisplay(p.amountCents, p.currency)}</div>
                <div className="text-xs text-muted">{p.method} · ref {p.reference || '—'} · {fmtDate(p.createdAt)}</div>
                {p.payerNote && <div className="mt-1 text-xs text-subtle">“{p.payerNote}”</div>}
              </div>
              <Badge variant={p.status === 'confirmed' ? 'success' : p.status === 'rejected' ? 'danger' : 'warning'}>{p.status}</Badge>
            </div>
            {p.status === 'pending' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busyId === p.id} onClick={() => confirm(p.id)}><Check size={13} /> Confirm</Button>
                {rejectId === p.id ? (
                  <>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" className="max-w-56" />
                    <Button size="sm" variant="danger" disabled={busyId === p.id} onClick={() => reject(p.id)}>Reject</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setRejectId(null); setNote(''); }}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setRejectId(p.id)}><X size={13} /> Reject</Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function emptyPlan(): AdminPlan {
  return {
    id: '', code: '', name: '', tagline: '', description: '', features: [],
    limits: { maxFarms: null, maxUsers: null, maxUnits: null }, prices: {},
    currency: 'UGX', trialDays: 14, isPublic: true, isActive: true, sortOrder: 0,
    createdAt: '', updatedAt: '',
  };
}

function PlansTab() {
  const { showToast } = useToast();
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [editing, setEditing] = useState<AdminPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await apiClient.get<AdminPlan[]>('/api/admin/plans');
    if (res.success) setPlans(res.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!editing) return;
    setSaving(true); setError('');
    const body = {
      code: editing.code, name: editing.name, tagline: editing.tagline, description: editing.description,
      features: editing.features, limits: editing.limits, prices: editing.prices, currency: editing.currency,
      trialDays: editing.trialDays, isPublic: editing.isPublic, isActive: editing.isActive, sortOrder: editing.sortOrder,
    };
    const res = editing.id
      ? await apiClient.patch<AdminPlan>(`/api/admin/plans/${editing.id}`, body)
      : await apiClient.post<AdminPlan>('/api/admin/plans', body);
    setSaving(false);
    if (!res.success) { setError(res.error || 'Failed to save plan.'); return; }
    setEditing(null); showToast('Plan saved', 'success'); void load();
  }
  async function archive(p: AdminPlan) {
    const res = await apiClient.delete(`/api/admin/plans/${p.id}`);
    if (!res.success) { showToast(res.error || 'Failed to archive.', 'error'); return; }
    showToast('Plan archived', 'warning'); void load();
  }

  return (
    <div>
      <Button size="sm" className="mb-3" onClick={() => setEditing(emptyPlan())}>+ New plan</Button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(plans ?? []).map((p) => (
          <div key={p.id} className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg font-medium">{p.name}</div>
              <div className="flex gap-1">{!p.isPublic && <Badge variant="default">hidden</Badge>}{!p.isActive && <Badge variant="danger">archived</Badge>}</div>
            </div>
            <div className="mt-1 text-xs text-subtle">{p.code} · {p.trialDays}d trial</div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {Object.entries(p.prices).map(([period, cents]) => <li key={period}>{period}: {centsToDisplay(cents as number, p.currency)}</li>)}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button>
              {p.isActive && <Button size="sm" variant="outline" onClick={() => archive(p)}>Archive</Button>}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-fg/40 p-0 lg:items-center" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface p-5 lg:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-display text-xl font-medium">{editing.id ? `Edit ${editing.name || editing.code}` : 'New plan'}</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Code<Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} disabled={!!editing.id} /></label>
              <label className="text-sm">Name<Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            </div>
            <label className="mt-2 block text-sm">Tagline<Input value={editing.tagline} onChange={(e) => setEditing({ ...editing, tagline: e.target.value })} /></label>
            <label className="mt-2 block text-sm">Features (one per line)
              <textarea className="mt-1 w-full rounded-md bg-surface-2 p-2 text-sm" rows={3} value={editing.features.join('\n')} onChange={(e) => setEditing({ ...editing, features: e.target.value.split('\n') })} />
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['maxFarms', 'maxUsers', 'maxUnits'] as (keyof PlanLimits)[]).map((k) => (
                <label key={k} className="text-xs">{k}
                  <Input inputMode="numeric" value={editing.limits[k] ?? ''} placeholder="∞" onChange={(e) => setEditing({ ...editing, limits: { ...editing.limits, [k]: e.target.value === '' ? null : Number(e.target.value) } })} />
                </label>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['monthly', 'quarterly', 'annual'] as PlanPeriod[]).map((period) => (
                <label key={period} className="text-xs">{period} (cents)
                  <Input inputMode="numeric" value={editing.prices[period] ?? ''} onChange={(e) => setEditing({ ...editing, prices: { ...editing.prices, [period]: e.target.value === '' ? undefined : Number(e.target.value) } as PlanPrices })} />
                </label>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="text-xs">Currency<Input value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></label>
              <label className="text-xs">Trial days<Input inputMode="numeric" value={editing.trialDays} onChange={(e) => setEditing({ ...editing, trialDays: Number(e.target.value) || 0 })} /></label>
              <label className="text-xs">Order<Input inputMode="numeric" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })} /></label>
            </div>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={editing.isPublic} onChange={(e) => setEditing({ ...editing, isPublic: e.target.checked })} /> Public</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Active</label>
            </div>
            {error && <div className="mt-2 text-sm text-danger">{error}</div>}
            <Button className="mt-4 w-full justify-center" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save plan'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function emptyDiscount(): AdminDiscount {
  return {
    id: '', code: '', kind: 'percent', value: 10, appliesToPlans: null, appliesToPeriods: null,
    tenantId: null, validFrom: null, validUntil: null, maxRedemptions: null, redemptions: 0,
    isActive: true, createdBy: '', note: '', createdAt: '', updatedAt: '',
  };
}

function DiscountsTab() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AdminDiscount[] | null>(null);
  const [editing, setEditing] = useState<AdminDiscount | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await apiClient.get<AdminDiscount[]>('/api/admin/discounts');
    if (res.success) setRows(res.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!editing) return;
    setSaving(true); setError('');
    const body = { code: editing.code, kind: editing.kind, value: editing.value, tenantId: editing.tenantId, maxRedemptions: editing.maxRedemptions, isActive: editing.isActive, note: editing.note };
    const res = editing.id
      ? await apiClient.patch<AdminDiscount>(`/api/admin/discounts/${editing.id}`, body)
      : await apiClient.post<AdminDiscount>('/api/admin/discounts', body);
    setSaving(false);
    if (!res.success) { setError(res.error || 'Failed to save discount.'); return; }
    setEditing(null); showToast('Discount saved', 'success'); void load();
  }
  async function archive(d: AdminDiscount) {
    const res = await apiClient.delete(`/api/admin/discounts/${d.id}`);
    if (!res.success) { showToast(res.error || 'Failed to archive.', 'error'); return; }
    showToast('Discount archived', 'warning'); void load();
  }

  return (
    <div>
      <Button size="sm" className="mb-3" onClick={() => setEditing(emptyDiscount())}>+ New discount</Button>
      <div className="flex flex-col gap-2">
        {(rows ?? []).map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-(--shadow-border)">
            <div>
              <span className="font-mono text-sm font-medium">{d.code}</span>{' '}
              <span className="text-xs text-muted">{d.kind === 'percent' ? `${d.value}%` : centsToDisplay(d.value, 'UGX')} · {d.redemptions}{d.maxRedemptions ? `/${d.maxRedemptions}` : ''} used{d.tenantId ? ' · targeted' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              {!d.isActive && <Badge variant="danger">archived</Badge>}
              <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>Edit</Button>
              {d.isActive && <Button size="sm" variant="outline" onClick={() => archive(d)}>Archive</Button>}
            </div>
          </div>
        ))}
        {rows !== null && rows.length === 0 && <EmptyState icon={<CreditCard size={20} />} title="No discounts yet" body="Create one to offer a percentage or fixed-amount discount." />}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-fg/40 lg:items-center" onClick={() => setEditing(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-surface p-5 lg:rounded-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 font-display text-xl font-medium">{editing.id ? `Edit ${editing.code}` : 'New discount'}</div>
            <label className="text-sm">Code<Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} disabled={!!editing.id} /></label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-sm">Kind
                <select className="mt-1 h-10 w-full rounded-md bg-surface-2 px-2 text-sm" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'percent' | 'fixed' })}>
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed (cents)</option>
                </select>
              </label>
              <label className="text-sm">Value<Input inputMode="numeric" value={editing.value} onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) || 0 })} /></label>
            </div>
            <label className="mt-2 block text-sm">Target a single tenant id (optional)<Input value={editing.tenantId ?? ''} onChange={(e) => setEditing({ ...editing, tenantId: e.target.value.trim() || null })} /></label>
            <label className="mt-2 block text-sm">Max redemptions (blank = unlimited)<Input inputMode="numeric" value={editing.maxRedemptions ?? ''} onChange={(e) => setEditing({ ...editing, maxRedemptions: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="mt-2 block text-sm">Note<Input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></label>
            <label className="mt-2 flex items-center gap-1.5 text-sm"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Active</label>
            {error && <div className="mt-2 text-sm text-danger">{error}</div>}
            <Button className="mt-4 w-full justify-center" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save discount'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SubscriptionsTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const [rows, setRows] = useState<AdminSubscriptionRow[] | null>(null);

  useEffect(() => {
    apiClient.get<AdminSubscriptionRow[]>(`/api/admin/subscriptions${statusFilter ? `?status=${statusFilter}` : ''}`).then((res) => {
      if (res.success) setRows(res.data);
    });
  }, [statusFilter]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {['', 'trialing', 'active', 'past_due', 'pending_payment', 'cancelled', 'expired'].map((s) => (
          <button key={s} type="button" onClick={() => setStatusFilter(s)}
            className={`h-8 rounded-full px-3 text-xs font-medium uppercase tracking-wide ${statusFilter === s ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-surface shadow-(--shadow-border)">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-border text-left text-xs text-subtle">
            <th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Due</th>
          </tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.tenantId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{r.tenantName}</td>
                <td className="px-3 py-2">{r.planName}</td>
                <td className="px-3 py-2">{r.period}</td>
                <td className="px-3 py-2"><Badge variant={r.status === 'active' || r.status === 'trialing' ? 'success' : r.status === 'past_due' ? 'warning' : 'default'}>{r.status}</Badge></td>
                <td className="px-3 py-2">{centsToDisplay(r.amountDueCents, 'UGX')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows !== null && rows.length === 0 && <div className="p-6 text-center text-sm text-muted">No subscriptions match this filter.</div>}
      </div>
    </div>
  );
}
