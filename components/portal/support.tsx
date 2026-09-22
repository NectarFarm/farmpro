'use client';
// ── Support: chatbot, tickets, "My tickets" (package H2, SaaS back-office) ──
// Backend untouched — docs/backoffice-api.md §3. Two screens:
//   SupportScreen: ticket list + "New ticket" form + bot chat sheet that can
//     escalate straight into a ticket.
//   SupportTicketScreen: one ticket's progress tracker, conversation, reply,
//     rating (resolved/closed only) and reopen.
import React, { useEffect, useState } from 'react';
import { useNav, TopNav } from '@/components/farm/navigation';
import { apiClient } from '@/lib/request';
import { useToast } from '@/components/farm/ui-shared';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Field, controlClass } from '@/components/ui-kit/field';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { cn } from '@/lib/utils';
import { Bot, Send, Plus, ClipboardList, CheckCircle2, Hourglass, RotateCcw, Star, ChevronRight } from 'lucide-react';
import { SupportChatSheet, type Category, type Priority } from './support-chat';

type Status = 'open' | 'in_progress' | 'waiting_on_customer' | 'resolved' | 'closed';

interface TicketRow {
  id: string;
  number: string;
  subject: string;
  category: Category;
  priority: Priority;
  status: Status;
  createdAt: string;
}

const STATUS_LABEL: Record<Status, string> = {
  open: 'Open', in_progress: 'In progress', waiting_on_customer: 'Waiting on you',
  resolved: 'Resolved', closed: 'Closed',
};
const STATUS_BADGE: Record<Status, 'warning' | 'primary' | 'success' | 'default'> = {
  open: 'warning', in_progress: 'primary', waiting_on_customer: 'warning', resolved: 'success', closed: 'default',
};

// ── My tickets ───────────────────────────────────────────────────────────
export function SupportScreen() {
  const { navigate } = useNav();
  const { showToast } = useToast();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  function load() {
    apiClient.get<TicketRow[]>('/api/support/tickets').then((res) => {
      if (res.success && Array.isArray(res.data)) setTickets(res.data);
    });
  }
  useEffect(load, []);

  return (
    <div className="screen-content">
      <TopNav title="Help & support" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Company"
          title="Help & support"
          lede="Ask the assistant, or raise a ticket and track it here until it's done."
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setNewOpen(true)}><Plus size={14} /> New ticket</Button>
              <Button onClick={() => setChatOpen(true)}><Bot size={14} /> Ask the assistant</Button>
            </div>
          )}
        />

        <div className="mt-5">
          {tickets === null ? (
            <div className="py-10 text-center text-sm text-muted">Loading tickets…</div>
          ) : tickets.length === 0 ? (
            <EmptyState icon={<ClipboardList size={20} />} title="No tickets yet" body="Ask the assistant or raise a new ticket and it will show up here." />
          ) : (
            <ul className="flex flex-col gap-1">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => navigate('support-ticket', { id: t.id })}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-subtle">{t.number}</span>
                        <Badge variant={STATUS_BADGE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-medium">{t.subject}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SupportChatSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onEscalated={(id) => { setChatOpen(false); load(); navigate('support-ticket', { id }); }}
      />
      <NewTicketSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => { setNewOpen(false); load(); showToast('Ticket raised.', 'success'); }}
      />
    </div>
  );
}

function NewTicketSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { showToast } = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<Category>('question');
  const [priority, setPriority] = useState<Priority>('normal');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!subject.trim() || !body.trim()) { showToast('Subject and description are required.', 'error'); return; }
    setSubmitting(true);
    const res = await apiClient.post('/api/support/tickets', { subject: subject.trim(), body: body.trim(), category, priority });
    setSubmitting(false);
    if (!res.success) { showToast(res.error, 'error'); return; }
    setSubject(''); setBody('');
    onCreated();
  }

  return (
    <Sheet open={open} onOpenChange={onClose} side="bottom">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3"><SheetTitle>New ticket</SheetTitle></div>
      <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4">
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ fontSize: 16 }} /></Field>
        <Field label="Describe the issue">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={controlClass} style={{ fontSize: 16, height: 'auto', paddingTop: 8, paddingBottom: 8 }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={controlClass}>
              {(['question', 'bug', 'billing', 'complaint', 'feature_request', 'account'] as Category[]).map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={controlClass}>
              {(['low', 'normal', 'high', 'urgent'] as Priority[]).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button className="w-full" disabled={submitting} onClick={submit}>{submitting ? 'Sending…' : 'Raise ticket'}</Button>
      </div>
    </Sheet>
  );
}

// ── Ticket detail: progress tracker + conversation + rating + reopen ──────
const TRACKER_STEPS: { status: Status; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'waiting_on_customer', label: 'Waiting on you' },
  { status: 'resolved', label: 'Resolved' },
];

interface TicketMessage { id: string; authorKind: 'customer' | 'staff' | 'bot' | 'system'; body: string; createdAt: string }
interface TicketEvent { id: string; kind: string; fromValue: string | null; toValue: string | null; createdAt: string }
interface TicketDetail {
  ticket: TicketRow & { rating: number | null; ratingComment: string };
  messages: TicketMessage[];
  events: TicketEvent[];
}

export type TicketTimelineItem =
  | { id: string; createdAt: string; kind: 'message'; message: TicketMessage }
  | { id: string; createdAt: string; kind: 'system'; text: string };

// ── What the CUSTOMER's conversation folds an event into, and what it drops ─
// The 4-step tracker already shows the STATUS itself; a raw append-only event
// log underneath it (kind + fromValue/toValue, one line per row) is an
// internal audit trail, not something a farmer reads — an assignment change
// or a priority bump names nothing they asked about, and "status_changed:
// waiting_on_customer" only repeats the badge two inches above it. Only the
// three transitions that actually tell them something new become a quiet
// inline line in the conversation, timestamped like a message: moved to "in
// progress", marked "resolved", or reopened (a status_changed row FROM
// resolved/closed back TO open — reopenTicket has no event kind of its own,
// it's plain updateTicket({status:'open'}), so this is the only way to tell a
// real reopen apart from the ticket's initial "open" state, which never
// appears as an event at all). The STAFF side (components/admin/tickets.tsx)
// keeps every event, unfiltered — that IS their audit trail; this function is
// customer-side only.
export function customerSystemLineFor(e: Pick<TicketEvent, 'kind' | 'fromValue' | 'toValue'>): string | null {
  if (e.kind !== 'status_changed') return null;
  if (e.toValue === 'in_progress') return 'Marked in progress';
  if (e.toValue === 'resolved') return 'Resolved';
  if (e.toValue === 'open' && (e.fromValue === 'resolved' || e.fromValue === 'closed')) return 'Reopened';
  return null;
}

// Messages and the handful of customer-relevant events, merged into one
// chronological timeline so a status change renders in the conversation at
// the moment it actually happened, not bolted on as a separate list below it.
export function mergeTicketTimeline(messages: TicketMessage[], events: TicketEvent[]): TicketTimelineItem[] {
  return [
    ...messages.map((m): TicketTimelineItem => ({ id: m.id, createdAt: m.createdAt, kind: 'message', message: m })),
    ...events.flatMap((e): TicketTimelineItem[] => {
      const text = customerSystemLineFor(e);
      return text ? [{ id: e.id, createdAt: e.createdAt, kind: 'system' as const, text }] : [];
    }),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function SupportTicketScreen() {
  const { params, goBack } = useNav();
  const { showToast } = useToast();
  const id = params.id;
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  function load() {
    if (!id) return;
    apiClient.get<TicketDetail>(`/api/support/tickets/${id}`).then((res) => {
      if (res.success && res.data) setDetail(res.data);
    });
  }
  useEffect(load, [id]);

  if (!id) {
    return (
      <div className="screen-content">
        <TopNav title="Ticket" showBack />
        <div className="px-screen pt-6"><EmptyState icon={<ClipboardList size={20} />} title="No ticket selected" body="Go back to My tickets and pick one." /></div>
      </div>
    );
  }
  if (!detail) {
    return (<div className="screen-content"><TopNav title="Ticket" showBack /><div className="px-screen pt-10 text-center text-sm text-muted">Loading…</div></div>);
  }

  const { ticket, messages, events } = detail;
  const stepIdx = TRACKER_STEPS.findIndex((s) => s.status === ticket.status);
  const done = ticket.status === 'resolved' || ticket.status === 'closed';
  const timeline = mergeTicketTimeline(messages, events);
  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    const res = await apiClient.post(`/api/support/tickets/${id}/messages`, { body: reply.trim() });
    setSending(false);
    if (!res.success) { showToast(res.error, 'error'); return; }
    setReply('');
    load();
  }

  async function submitRating() {
    if (!rating) { showToast('Pick a rating first.', 'error'); return; }
    const res = await apiClient.post(`/api/support/tickets/${id}/rate`, { rating, comment: comment.trim() || undefined });
    if (!res.success) { showToast(res.error, 'error'); return; }
    showToast('Thanks for the feedback.', 'success');
    load();
  }

  async function reopen() {
    const res = await apiClient.post(`/api/support/tickets/${id}/reopen`, {});
    if (!res.success) { showToast(res.error, 'error'); return; }
    showToast('Ticket reopened.', 'success');
    load();
  }

  return (
    <div className="screen-content">
      <TopNav title={ticket.number} subtitle={ticket.subject} showBack />
      <div className="px-screen pt-3 pb-10">
        {/* Progress tracker */}
        <div className="flex items-center gap-1 rounded-xl bg-surface p-3 shadow-(--shadow-border)">
          {TRACKER_STEPS.map((s, i) => {
            const reached = ticket.status === 'closed' ? true : i <= stepIdx;
            return (
              <React.Fragment key={s.status}>
                {i > 0 && <div className={cn('h-0.5 flex-1', reached ? 'bg-primary' : 'bg-border')} />}
                <div className="flex flex-col items-center gap-1">
                  <div className={cn('flex size-6 items-center justify-center rounded-full text-xs', reached ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-subtle')}>
                    {reached ? <CheckCircle2 size={13} /> : i + 1}
                  </div>
                  <span className={cn('text-[10px]', reached ? 'text-fg' : 'text-subtle')}>{s.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Badge variant={STATUS_BADGE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
          <span className="text-xs text-subtle">{ticket.category} · {ticket.priority}</span>
        </div>

        {/* Conversation — messages and the handful of status changes worth
           telling a customer about, interleaved in the order they happened. */}
        <div className="mt-5 flex flex-col gap-2">
          {timeline.map((item) => item.kind === 'message' ? (
            <div key={item.id} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', item.message.authorKind === 'customer' ? 'self-end bg-primary text-primary-fg' : 'self-start bg-surface-2')}>
              <p>{item.message.body}</p>
              <p className="mt-0.5 text-[10px] opacity-70">{item.message.authorKind}</p>
            </div>
          ) : (
            <div key={item.id} className="my-1 flex items-center justify-center gap-1.5 self-center text-[11px] text-subtle">
              <Hourglass size={10} /> {item.text} · {fmtTime(item.createdAt)}
            </div>
          ))}
        </div>

        {!done ? (
          <div className="mt-5 flex items-center gap-2">
            <Input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }} placeholder="Write a reply…" style={{ fontSize: 16 }} />
            <Button size="icon" disabled={sending || !reply.trim()} onClick={sendReply} aria-label="Send"><Send size={16} /></Button>
          </div>
        ) : (
          <div className="mt-6 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            {ticket.rating ? (
              <p className="text-sm text-muted">You rated this {ticket.rating}/5. {ticket.ratingComment}</p>
            ) : (
              <>
                <p className="text-sm font-medium">How did we do?</p>
                <div className="mt-2 flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                      <Star size={22} className={n <= rating ? 'fill-warning text-warning' : 'text-subtle'} />
                    </button>
                  ))}
                </div>
                <Input className="mt-2" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" style={{ fontSize: 16 }} />
                <Button className="mt-2" size="sm" onClick={submitRating}>Submit rating</Button>
              </>
            )}
            <Button className="mt-3" size="sm" variant="ghost" onClick={reopen}><RotateCcw size={13} /> Reopen</Button>
          </div>
        )}
      </div>
    </div>
  );
}
