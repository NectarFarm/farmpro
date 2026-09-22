'use client';
// ── Support bot chat sheet (package H2, SaaS back-office) ──────────────────
// Split out of support.tsx so components/farm/navigation.tsx's TopNav (the
// persistent Help launcher, every tenant role) can import this one component
// without importing the rest of support.tsx — support.tsx itself imports
// TopNav from navigation.tsx, and a navigation.tsx -> support.tsx import
// would be a real circular import (TopNav depends on the sheet; the sheet
// here depends on nothing from navigation.tsx). Backend: POST /api/support/
// chat, POST /api/support/chat/escalate — docs/backoffice-api.md §3.
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/request';
import { useToast } from '@/components/farm/ui-shared';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Sheet, SheetTitle } from '@/components/ui-kit/sheet';
import { cn } from '@/lib/utils';
import { Bot, Send } from 'lucide-react';

export type Category = 'question' | 'bug' | 'billing' | 'complaint' | 'feature_request' | 'account';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface SuggestTicket { subject: string; category: Category; priority: Priority; summary: string }

export function SupportChatSheet({ open, onClose, onEscalated }: { open: boolean; onClose: () => void; onEscalated: (ticketId: string) => void }) {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestTicket | null>(null);
  const [escalating, setEscalating] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, suggestion]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    const res = await apiClient.post<{ reply: string; suggestTicket?: SuggestTicket }>('/api/support/chat', { messages: next });
    setSending(false);
    if (!res.success) { showToast(res.error, 'error'); return; }
    setMessages((m) => [...m, { role: 'assistant', content: res.data.reply }]);
    if (res.data.suggestTicket) setSuggestion(res.data.suggestTicket);
  }

  async function escalate() {
    if (!suggestion) return;
    setEscalating(true);
    const res = await apiClient.post<{ ticketId: string; ticketNumber: string }>('/api/support/chat/escalate', {
      messages, subject: suggestion.subject, category: suggestion.category, priority: suggestion.priority,
    });
    setEscalating(false);
    if (!res.success) { showToast(res.error, 'error'); return; }
    showToast(`Ticket ${res.data.ticketNumber} raised.`, 'success');
    setMessages([]); setSuggestion(null);
    onEscalated(res.data.ticketId);
  }

  return (
    <Sheet open={open} onOpenChange={onClose} side="bottom" className="inset-x-0 bottom-0 h-[85vh] rounded-t-xl lg:inset-auto lg:top-[8%] lg:left-1/2 lg:h-[80vh] lg:w-[28rem] lg:-translate-x-1/2 lg:rounded-xl">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bot size={18} className="text-primary" />
        <SheetTitle>Ask the assistant</SheetTitle>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted">Describe what’s wrong — billing, a bug, or anything else. If it needs a human, I’ll offer to raise a ticket.</p>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <div key={i} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', m.role === 'user' ? 'self-end bg-primary text-primary-fg' : 'self-start bg-surface-2')}>
              {m.content}
            </div>
          ))}
        </div>
        {suggestion && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3 shadow-(--shadow-border)">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Send this to support?</p>
            <p className="mt-1 text-sm font-medium">{suggestion.subject}</p>
            <p className="mt-1 text-xs text-muted">{suggestion.category} · {suggestion.priority}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={escalating} onClick={escalate}>{escalating ? 'Sending…' : 'Send to support'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>Not now</Button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Type a message…"
          style={{ fontSize: 16 }}
        />
        <Button size="icon" disabled={sending || !input.trim()} onClick={send} aria-label="Send"><Send size={16} /></Button>
      </div>
    </Sheet>
  );
}
