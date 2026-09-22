'use client';
// ── Admin Overview — the operator's inbox (package H1) ───────────────────────
// Lead brief: "Overview hero = the operator's inbox: unassigned/urgent
// tickets, payments awaiting confirmation, onboarding requests, and trials
// ending within 7 days. Then platform stats (existing /api/admin/stats)."
//
// Every number here is a real read from an existing, already-tested route
// (docs/backoffice-api.md) — nothing is computed client-side beyond simple
// filters (unassigned = assignedTo === null, urgent = priority in
// {high,urgent}, trial-ending = trialing status with trialEndsAt within 7
// days). A caller missing the capability behind a section (support.handle,
// billing.manage, onboarding.review, analytics.view) simply doesn't fetch
// it — GET /api/admin/me gates what this screen even asks for, matching the
// "hide what the caller can't use" instruction; the backend would 403 it
// anyway.
import React, { useEffect, useState } from 'react';
import { useNav, TopNav } from '../farm/navigation';
import { apiClient } from '@/lib/request';
import { PageHeader, Kpi } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { useAdminCapabilities } from './capabilities';
import {
  type AdminTicket, type AdminPaymentRow, type AdminSubscriptionRow, type ApiStats,
  centsToDisplay, daysUntil, relativeTime,
} from './types';
import {
  Inbox, MessageSquare, CreditCard, ClipboardList, CalendarClock,
  Building2, Users as UsersIcon, AlertTriangle,
} from 'lucide-react';

interface OnboardRequestLite { id: string; farmName: string; farmerName: string; status: string; requestedAt: string; }

export function AdminOverviewScreen() {
  const { navigate } = useNav();
  const { loading: capLoading, has } = useAdminCapabilities();

  const [stats, setStats] = useState<ApiStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
  const [payments, setPayments] = useState<AdminPaymentRow[] | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardRequestLite[] | null>(null);
  const [subs, setSubs] = useState<AdminSubscriptionRow[] | null>(null);

  useEffect(() => {
    if (capLoading) return;
    let cancelled = false;
    if (has('analytics.view')) {
      apiClient.get<ApiStats>('/api/admin/stats').then((res) => {
        if (cancelled) return;
        if (res.success) setStats(res.data); else setStatsError(res.error || 'Failed to load platform stats.');
      });
    }
    if (has('support.handle')) {
      apiClient.get<AdminTicket[]>('/api/admin/tickets').then((res) => {
        if (!cancelled && res.success) setTickets(res.data);
      });
    }
    if (has('billing.manage')) {
      apiClient.get<AdminPaymentRow[]>('/api/admin/payments?status=pending').then((res) => {
        if (!cancelled && res.success) setPayments(res.data);
      });
      apiClient.get<AdminSubscriptionRow[]>('/api/admin/subscriptions').then((res) => {
        if (!cancelled && res.success) setSubs(res.data);
      });
    }
    if (has('onboarding.review')) {
      apiClient.get<OnboardRequestLite[]>('/api/onboard-requests').then((res) => {
        if (!cancelled && res.success) setOnboarding(res.data.filter((r) => r.status === 'pending'));
      });
    }
    return () => { cancelled = true; };
  }, [capLoading, has]);

  const openTickets = (tickets ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'closed');
  const unassignedTickets = openTickets.filter((t) => !t.assignedTo);
  const urgentTickets = openTickets.filter((t) => t.priority === 'urgent' || t.priority === 'high');
  const trialsEndingSoon = (subs ?? []).filter((s) => s.status === 'trialing' && daysUntil(s.trialEndsAt) !== null && (daysUntil(s.trialEndsAt) as number) <= 7);

  const inboxEmpty = tickets !== null && payments !== null && onboarding !== null && subs !== null
    && unassignedTickets.length === 0 && urgentTickets.length === 0 && (payments ?? []).length === 0
    && (onboarding ?? []).length === 0 && trialsEndingSoon.length === 0;

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Platform"
          title="Overview"
          lede="What needs you first, then how the platform is doing overall."
        />

        {/* ── The inbox ── */}
        <section className="mt-5">
          <div className="mb-2.5 flex items-center gap-2 text-xs font-medium tracking-wide text-subtle uppercase">
            <Inbox size={13} /> Needs you
          </div>

          {inboxEmpty && (
            <EmptyState icon={<Inbox size={20} />} title="Inbox is clear" body="No unassigned tickets, pending payments, onboarding requests, or trials ending soon." />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tickets !== null && (unassignedTickets.length > 0 || urgentTickets.length > 0) && (
              <button type="button" onClick={() => navigate('admin-tickets')} className="rounded-xl bg-warning-soft p-4 text-left shadow-(--shadow-border) transition-shadow hover:shadow-(--shadow-border-hover)">
                <div className="flex items-center justify-between text-xs font-medium tracking-wide text-warning uppercase"><span>Tickets</span><MessageSquare size={14} /></div>
                <div className="font-display mt-2 text-3xl leading-none font-medium tabular-nums">{unassignedTickets.length}</div>
                <div className="mt-1 text-xs text-subtle">unassigned{urgentTickets.length > 0 ? ` · ${urgentTickets.length} urgent/high` : ''}</div>
              </button>
            )}
            {payments !== null && payments.length > 0 && (
              <div className="rounded-xl bg-warning-soft p-4 text-left shadow-(--shadow-border)">
                <div className="flex items-center justify-between text-xs font-medium tracking-wide text-warning uppercase"><span>Payments</span><CreditCard size={14} /></div>
                <div className="font-display mt-2 text-3xl leading-none font-medium tabular-nums">{payments.length}</div>
                <div className="mt-1 text-xs text-subtle">awaiting confirmation (Billing console: coming next)</div>
              </div>
            )}
            {onboarding !== null && onboarding.length > 0 && (
              <button type="button" onClick={() => navigate('admin-onboarding')} className="rounded-xl bg-warning-soft p-4 text-left shadow-(--shadow-border) transition-shadow hover:shadow-(--shadow-border-hover)">
                <div className="flex items-center justify-between text-xs font-medium tracking-wide text-warning uppercase"><span>Onboarding</span><ClipboardList size={14} /></div>
                <div className="font-display mt-2 text-3xl leading-none font-medium tabular-nums">{onboarding.length}</div>
                <div className="mt-1 text-xs text-subtle">requests pending review</div>
              </button>
            )}
            {trialsEndingSoon.length > 0 && (
              <div className="rounded-xl bg-warning-soft p-4 text-left shadow-(--shadow-border)">
                <div className="flex items-center justify-between text-xs font-medium tracking-wide text-warning uppercase"><span>Trials</span><CalendarClock size={14} /></div>
                <div className="font-display mt-2 text-3xl leading-none font-medium tabular-nums">{trialsEndingSoon.length}</div>
                <div className="mt-1 text-xs text-subtle">ending within 7 days</div>
              </div>
            )}
          </div>

          {trialsEndingSoon.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {trialsEndingSoon.slice(0, 5).map((s) => (
                <li key={s.tenantId}>
                  <button type="button" onClick={() => navigate('admin-farms', { tenantId: s.tenantId })}
                    className="flex w-full items-center justify-between rounded-lg bg-surface px-3 py-2.5 text-left text-sm shadow-(--shadow-border) hover:bg-surface-2">
                    <span className="min-w-0 truncate font-medium">{s.tenantName}</span>
                    <span className="shrink-0 text-xs text-subtle">{s.planName} · trial ends {relativeTime(s.trialEndsAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Platform stats ── */}
        {has('analytics.view') && (
          <section className="mt-8">
            <div className="mb-2.5 text-xs font-medium tracking-wide text-subtle uppercase">Platform</div>
            {statsError && (
              <div className="mb-3 flex items-center gap-1.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                <AlertTriangle size={13} /> {statsError}
              </div>
            )}
            {!statsError && !stats && <div className="py-8 text-center text-sm text-muted">Loading platform stats…</div>}
            {stats && (
              <>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Kpi label="Tenants" value={stats.totalTenants} hint={`${stats.activeTenants} active`} icon={<Building2 size={14} />} onClick={() => navigate('admin-farms')} />
                  <Kpi label="Users" value={stats.totalUsers} hint="active accounts" icon={<UsersIcon size={14} />} onClick={() => navigate('admin-users')} />
                  <Kpi label="Pending requests" value={stats.onboardRequestsByStatus.pending} hint="awaiting review" tone={stats.onboardRequestsByStatus.pending > 0 ? 'warn' : 'plain'} icon={<ClipboardList size={14} />} onClick={() => navigate('admin-onboarding')} />
                  <Kpi label="Onboarded" value={stats.onboardRequestsByStatus.approved} hint="requests approved" tone="ok" icon={<ClipboardList size={14} />} onClick={() => navigate('admin-onboarding')} />
                </div>

                <div className="mt-4 overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
                  <div className="border-b border-border px-4 py-2.5 text-xs font-medium tracking-wide text-subtle uppercase">Onboarding queue</div>
                  {(['pending', 'info-needed', 'approved', 'rejected'] as const).map((status, i, arr) => (
                    <div key={status} className={i < arr.length - 1 ? 'flex items-center justify-between border-b border-border px-4 py-2.5' : 'flex items-center justify-between px-4 py-2.5'}>
                      <span className="text-sm text-muted capitalize">{status.replace(/-/g, ' ')}</span>
                      <Badge variant={status === 'pending' ? 'warning' : status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'default'}>{stats.onboardRequestsByStatus[status]}</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          {has('onboarding.review') && <Button variant="secondary" onClick={() => navigate('admin-onboarding')}><ClipboardList size={14} /> Review requests</Button>}
          {has('tenants.manage') && <Button variant="secondary" onClick={() => navigate('admin-farms')}><Building2 size={14} /> View tenants</Button>}
          {has('onboarding.review') && <Button variant="secondary" onClick={() => navigate('admin-enterprise-requests')}>Enterprise requests</Button>}
        </div>
      </div>
    </div>
  );
}
