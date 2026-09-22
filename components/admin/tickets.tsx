'use client';
// ── Support: ticket queue + workspace (package H1, docs/backoffice-api.md §3) ─
// GET/PATCH /api/admin/tickets(/[id]), POST .../messages. Queue on the left
// (filters: status/priority/assignee me-unassigned-anyone/category/tenant),
// workspace on the right: conversation + internal-note composer + status/
// priority/assignee controls + event timeline.
import React, { useCallback, useEffect, useState } from 'react';
import { useNav, TopNav } from '../farm/navigation';
import { apiClient } from '@/lib/request';
import { useToast } from '../farm/ui-shared';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Kv } from '@/components/ui-kit/inspector';
import { useAdminCapabilities } from './capabilities';
import {
  type AdminTicket, type AdminTicketDetail, type TicketMessage, type TicketPriority, type TicketStatus,
  TICKET_STATUSES, TICKET_PRIORITIES, fmtDateTime, relativeTime,
} from './types';
import { MessageSquare, Send, ShieldAlert, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRIORITY_VARIANT: Record<TicketPriority, 'default' | 'warning' | 'danger'> = {
  low: 'default', normal: 'default', high: 'warning', urgent: 'danger',
};
const STATUS_VARIANT: Record<TicketStatus, 'default' | 'warning' | 'success'> = {
  open: 'warning', in_progress: 'warning', waiting_on_customer: 'default', resolved: 'success', closed: 'default',
};

// Module-scope (not recreated per render) so the deep-link effect below can
// reference it without upsetting react-hooks/exhaustive-deps.
const OPEN_STATUSES = new Set<TicketStatus>(['open', 'in_progress', 'waiting_on_customer']);

export function AdminTicketsScreen() {
  const { params } = useNav();
  const { showToast } = useToast();
  const { has } = useAdminCapabilities();

  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [assigneeFilter, setAssigneeFilter] = useState<'anyone' | 'me' | 'unassigned'>('anyone');
  const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (assigneeFilter !== 'anyone') p.set('assignee', assigneeFilter);
    const res = await apiClient.get<AdminTicket[]>(`/api/admin/tickets?${p.toString()}`);
    if (res.success) { setTickets(res.data); setLoadError(''); } else setLoadError(res.error || 'Failed to load tickets.');
  }, [assigneeFilter]);

  useEffect(() => { load(); }, [load]);

  // Deep link from a staff notification (dashboard.tsx's handleNotifTap,
  // navigate('admin-tickets', { id })) — e2e finding: this screen previously
  // ignored `params.id` entirely, so tapping "New ticket T-1042" (or a
  // customer reply) always landed on the plain, unfiltered queue instead of
  // that ticket. A resolved/closed ticket (e.g. a customer reopening one) is
  // surfaced even though the default filter is "Open", the same way TasksScreen's
  // taskId deep link works.
  useEffect(() => {
    if (!params.id || !tickets) return;
    const match = tickets.find((t) => t.id === params.id);
    if (!match) return;
    setSelectedId(match.id);
    if (!OPEN_STATUSES.has(match.status)) setStatusFilter('all');
  }, [params.id, tickets]);

  const visible = (tickets ?? []).filter((t) => statusFilter === 'all' || OPEN_STATUSES.has(t.status));
  const selected = visible.find((t) => t.id === selectedId) ?? null;

  if (!has('support.handle')) {
    return (
      <div className="screen-content">
        <TopNav title="" />
        <div className="px-screen pt-3 pb-10">
          <PageHeader kicker="Support" title="Tickets" />
          <EmptyState icon={<ShieldAlert size={20} />} title="Not available" body="Your platform-staff account doesn't have the support.handle capability." />
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader kicker="Support" title="Tickets" lede="Complaints, questions and bugs raised by tenants — respond, assign, and keep the loop closed." />

        {loadError && (
          <div className="mt-4 flex items-center gap-1.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            <AlertTriangle size={13} /> {loadError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {(['open', 'all'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={cn('h-8 rounded-full px-3 text-xs font-medium tracking-wide uppercase', statusFilter === s ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
              {s === 'open' ? 'Open' : 'All'}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" />
          {(['anyone', 'me', 'unassigned'] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAssigneeFilter(a)}
              className={cn('h-8 rounded-full px-3 text-xs font-medium tracking-wide uppercase', assigneeFilter === a ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
              {a === 'anyone' ? 'Anyone' : a === 'me' ? 'Assigned to me' : 'Unassigned'}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="rounded-xl bg-surface p-2 shadow-(--shadow-border)">
            {tickets === null ? (
              <div className="py-10 text-center text-sm text-muted">Loading tickets…</div>
            ) : visible.length === 0 ? (
              <EmptyState icon={<MessageSquare size={20} />} title="Queue is clear" body="No tickets match these filters." />
            ) : (
              <ul className="flex flex-col gap-1">
                {visible.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setSelectedId(t.id)}
                      className={cn('flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left', selected?.id === t.id ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{t.subject}</span>
                        <Badge variant={PRIORITY_VARIANT[t.priority]}>{t.priority}</Badge>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="font-mono text-subtle">{t.number}</span>
                        <span>{t.tenantName}</span>
                        <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace(/_/g, ' ')}</Badge>
                        {!t.assignedTo && <span className="text-warning">unassigned</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected ? (
            <TicketWorkspace key={selected.id} ticketLite={selected} canAssignOthers={has('support.assign')} onChanged={load} />
          ) : (
            <EmptyState icon={<MessageSquare size={20} />} title="Nothing selected" body="Pick a ticket on the left to see the conversation." />
          )}
        </div>
      </div>
    </div>
  );
}

function TicketWorkspace({ ticketLite, canAssignOthers, onChanged }: { ticketLite: AdminTicket; canAssignOthers: boolean; onChanged: () => void }) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<AdminTicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiClient.get<AdminTicketDetail>(`/api/admin/tickets/${ticketLite.id}`);
    if (res.success) setDetail(res.data);
  }, [ticketLite.id]);

  useEffect(() => { load(); }, [load]);

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    const res = await apiClient.post<TicketMessage>(`/api/admin/tickets/${ticketLite.id}/messages`, { body: reply.trim(), internal });
    setSending(false);
    if (!res.success) { showToast(res.error || 'Failed to send.', 'error'); return; }
    setReply('');
    load();
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    const res = await apiClient.patch(`/api/admin/tickets/${ticketLite.id}`, body);
    setBusy(false);
    if (!res.success) { showToast(res.error || 'Failed to update ticket.', 'error'); return; }
    load(); onChanged();
  }

  if (!detail) return <div className="rounded-xl bg-surface p-5 text-sm text-muted shadow-(--shadow-border)">Loading ticket…</div>;
  const { ticket, messages, events } = detail;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(220px,0.8fr)]">
      <article className="flex min-h-0 flex-col rounded-xl bg-surface shadow-(--shadow-border)">
        <header className="border-b border-border px-5 py-4">
          <p className="font-mono text-xs text-subtle">{ticket.number} · {detail.tenant?.name ?? 'Unknown tenant'}</p>
          <h2 className="font-display mt-1 text-xl leading-tight font-medium">{ticket.subject}</h2>
          <p className="mt-1 text-xs text-muted">Raised by {detail.raiser?.name ?? 'unknown'} ({detail.raiser?.email ?? '—'}) · {relativeTime(ticket.createdAt)}</p>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((m) => (
            <div key={m.id} className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm',
              m.isInternal ? 'ml-0 border border-warning/40 bg-warning-soft text-fg' :
                m.authorKind === 'customer' ? 'mr-auto bg-surface-2' : 'ml-auto bg-primary-soft',
            )}>
              {m.isInternal && <div className="mb-0.5 text-[10px] font-bold tracking-wide text-warning uppercase">Internal note — staff only</div>}
              <div className="whitespace-pre-wrap">{m.body}</div>
              <div className="mt-1 text-[10px] text-subtle">{fmtDateTime(m.createdAt)}</div>
            </div>
          ))}
          {messages.length === 0 && <div className="text-sm text-muted">No messages yet.</div>}
        </div>
        <footer className="border-t border-border p-3">
          <label className={cn('mb-2 flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium', internal ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted')}>
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (staff only)
          </label>
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              placeholder={internal ? 'Note for other staff…' : 'Reply to the customer…'}
              className="min-h-11 flex-1 resize-none rounded-md bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <Button onClick={send} disabled={sending || !reply.trim()}><Send size={14} /></Button>
          </div>
        </footer>
      </article>

      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
          <dl>
            <Kv label="Status" value={
              <select value={ticket.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })} className="rounded-md bg-surface-2 px-2 py-1 text-sm">
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            } />
            <Kv label="Priority" value={
              <select value={ticket.priority} disabled={busy} onChange={(e) => patch({ priority: e.target.value })} className="rounded-md bg-surface-2 px-2 py-1 text-sm">
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            } />
            <Kv label="Category" value={ticket.category.replace(/_/g, ' ')} />
            <Kv label="Assignee" value={ticket.assignedTo ?? 'Unassigned'} />
          </dl>
          {!ticket.assignedTo && (
            <Button size="sm" variant="secondary" className="mt-2 w-full justify-center" disabled={busy} onClick={() => patch({ assignedTo: 'me' })}>Claim it</Button>
          )}
          {ticket.assignedTo && !canAssignOthers && (
            <p className="mt-2 text-xs text-subtle">Assigning to someone else needs support.assign.</p>
          )}
          {ticket.assignedTo && (
            <Button size="sm" variant="outline" className="mt-2 w-full justify-center" disabled={busy} onClick={() => patch({ assignedTo: null })}>Unassign</Button>
          )}
        </div>

        <div className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
          <div className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">Timeline</div>
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id} className="text-xs text-muted">
                <span className="font-medium text-fg">{e.kind.replace(/_/g, ' ')}</span>
                {e.fromValue && e.toValue ? ` — ${e.fromValue} → ${e.toValue}` : ''}
                <span className="ml-1 text-subtle">· {fmtDateTime(e.createdAt)}</span>
              </li>
            ))}
            {events.length === 0 && <li className="text-xs text-subtle">No events yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
