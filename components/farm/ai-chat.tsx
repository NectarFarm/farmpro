'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Send, Bot, UserSingle as User, Sparkles,
  Wheat, BarChart3, ClipboardList, Package, Skull, Bird,
  type LucideIcon,
} from './icons';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';

/* ── AI farm advisor — real backend (issues #258/#259/#260) ────────────────
 * This screen used to keyword-match against a table of canned replies, with
 * a setTimeout for the typing delay, and cited a specific batch code, an FCR
 * of 1.82 and KSh 177,000 of profit as if they were live readings (#376
 * Gap 1). A farmer who checks one fabricated number against reality stops
 * trusting every real number in the app, so none of that survives here.
 *
 * It now calls POST /api/ai/advise, which grounds every answer in a bounded
 * snapshot of THIS tenant's real records and is instructed to say what it
 * doesn't have rather than fill the gap. See lib/ai-advisor.ts for the
 * grounding contract.
 *
 * Note for anyone comparing against epic #258: that epic lists the endpoint
 * under "Confirmed facts — Real". It did not exist; it was built alongside
 * this rewire. Don't trust that list without checking app/api.
 *
 * Wire protocol: the endpoint takes { role, content } and returns
 * { answer } — this screen's own Message type uses `text`, so sendMessage
 * maps between them. Only the last 10 turns are sent (the server truncates
 * to the same bound); role gating is enforced server-side too, because a
 * hidden screen is not a permission. */
interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
}

// Quick prompts are real questions now, not labels that mapped to a canned
// blob. Each one is a question the grounded context can actually answer from
// records — feed, mortality, stock, tasks — or honestly decline.
const QUICK_PROMPTS: { icon: LucideIcon; label: string; question: string }[] = [
  { icon: Bird, label: 'Batch health', question: 'How are my active batches doing, and has any of them lost an unusual number of birds this month?' },
  { icon: Package, label: 'Stock to reorder', question: 'What stock is at or below its low-stock threshold, and what should I reorder first?' },
  { icon: ClipboardList, label: "What's overdue", question: 'What tasks are open or overdue right now, and which should be done first?' },
  { icon: Wheat, label: 'Feeding check', question: 'Based on what my workers have recorded, is my feeding on track for the batches I have?' },
  { icon: BarChart3, label: 'Production so far', question: 'What have we collected or produced in the last 30 days?' },
  { icon: Skull, label: 'Mortality review', question: 'Walk me through the deaths recorded recently and whether I should be worried.' },
];

// Roles the backend allows (app/api/ai/advise/route.ts's ADVISOR_ROLES). The
// server is the enforcement point; this list only decides whether we render a
// chat the caller would be 403'd out of anyway (#260 task 3).
const ADVISOR_ROLES = ['owner', 'manager'];

const now = () => new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

// Greeting built from the REAL session user's name (#376 Gap 1) — the old
// hardcoded "Hello James!" greeted everybody as someone else, alongside a
// claim about "live data on 6 active batches" that was never true. The
// capability claim here is now accurate: the endpoint really does read this
// tenant's batches, records, stock and tasks.
function initialMessages(userName?: string): Message[] {
  const name = userName?.trim() ? ` ${userName.trim().split(/\s+/)[0]}` : '';
  return [
    {
      id: 'init',
      role: 'assistant',
      text: `Hello${name}! 👋\n\nI can see your farm's recorded data — active batches, what your workers have logged, stock levels and open tasks — and I'll answer from that. If something isn't recorded yet, I'll say so rather than guess.\n\nWhat would you like to know?`,
      time: now(),
    },
  ];
}

export function AIChatScreen({ userName }: { userName?: string }) {
  const { role, activeFarmId } = useNav();
  const [messages, setMessages] = useState<Message[]>(() => initialMessages(userName));
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  // Surfaced as a retryable banner rather than a fake assistant turn: an
  // error dressed up as an answer is exactly the confusion this screen's
  // rewrite exists to remove (#260 task 2).
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const allowed = ADVISOR_ROLES.includes(role);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, error]);

  // Abort any in-flight request when the screen unmounts, so a reply can't
  // land in a component that's gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function sendMessage(text: string) {
    const question = text.trim();
    if (!question || isTyping) return;

    const userMsg: Message = { id: `${Date.now()}-u`, role: 'user', text: question, time: now() };
    // Build the wire history from the turns the model should see: the local
    // greeting is ours, not the model's, so it never goes upstream.
    const history = [...messages.filter((m) => m.id !== 'init'), userMsg]
      .map((m) => ({ role: m.role, content: m.text }));

    setMessages((m) => [...m, userMsg]);
    setInput('');
    setError('');
    setIsTyping(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/advise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // farmId mirrors the active farm switcher, so the answer is scoped to
        // whatever farm the rest of the app is currently showing.
        body: JSON.stringify({ messages: history.slice(-10), farmId: activeFarmId }),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        // The endpoint's own message is written for a farmer to read (out of
        // credit, not configured, busy, unauthorized) — show it verbatim
        // rather than replacing it with a generic string.
        setError(json?.error || `The advisor could not answer that (error ${res.status}).`);
        return;
      }
      setMessages((m) => [...m, { id: `${Date.now()}-a`, role: 'assistant', text: String(json.data.answer), time: now() }]);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setError('Could not reach the advisor. Check your connection and try again.');
    } finally {
      if (!controller.signal.aborted) setIsTyping(false);
    }
  }

  function renderText(text: string) {
    // Render **bold** and newlines
    return text.split('\n').map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={i}>
          {parts.map((p, j) =>
            p.startsWith('**') && p.endsWith('**')
              ? <strong key={j} style={{ color: 'var(--text-primary)' }}>{p.slice(2, -2)}</strong>
              : p
          )}
          {i < text.split('\n').length - 1 && <br />}
        </span>
      );
    });
  }

  // Role gate (#260 task 3). The server 403s these roles anyway; showing a
  // chat box that always errors would be worse than saying why up front.
  if (!allowed) {
    return (
      <div className="screen-content">
        <TopNav title="" />
        <div className="px-screen pt-3">
          <PageHeader kicker="Daily" title="Advisor" lede="Not available for your role" />
          <div className="mt-5 flex items-start gap-3 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            <Bot size={20} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div>
              <div className="mb-1 text-sm font-semibold text-fg">The advisor is limited to owners and managers</div>
              <div className="text-sm leading-relaxed text-muted">
                It answers using the whole farm&apos;s financial and production records, which your role
                doesn&apos;t have access to. Everything you can see in your own tabs is live and up to date —
                ask your farm owner or manager if you need something from the wider records.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content flex flex-col">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-2">
        <PageHeader
          kicker="Daily"
          title="Advisor"
          lede="Answers from your recorded data — batches, stock, feeding and tasks."
          actions={<Badge variant="primary"><Sparkles size={10} className="mr-1" aria-hidden="true" />{activeFarmId === 'ALL' ? 'All farms' : 'This farm'}</Badge>}
        />
      </div>

      {/* Chat messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-screen py-3">
        {/* The context strip that used to sit here is deliberately gone.
            #259 task 2 asked whether it needed a new summary field on
            /api/dashboard/kpis or should be dropped: dropped. It claimed
            counts ("6 batches active", "1 low stock") with no endpoint
            behind them, and the advisor now states those figures properly
            from real records when asked — a decorative strip would be a
            second source of truth for the same numbers. */}

        {messages.map((msg, i) => (
          <div key={msg.id} className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="mt-0.5 mr-2 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
                <Bot size={14} className="text-primary" />
              </div>
            )}
            <div className="max-w-[78%]">
              {msg.role === 'assistant' && i === 0 ? (
                <p className="font-display text-xl leading-snug font-medium text-fg">{renderText(msg.text)}</p>
              ) : (
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed text-fg ${
                    msg.role === 'user' ? 'rounded-br-md bg-primary-soft' : 'rounded-bl-md bg-surface shadow-(--shadow-border)'
                  }`}
                >
                  {renderText(msg.text)}
                </div>
              )}
              <div className={`mt-1 text-[11px] text-subtle ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>{msg.time}</div>
            </div>
            {msg.role === 'user' && (
              <div className="mt-0.5 ml-2 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                <User size={14} className="text-muted" />
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div className="mb-3 flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
              <Bot size={14} className="text-primary" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 shadow-(--shadow-border)">
              {[0, 1, 2].map((i) => (
                <div key={i} className="size-1.5 rounded-full bg-primary/60" style={{ animation: `pulse 1.2s ease-in-out ${i * 0.3}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* Suggested prompts (only while the conversation hasn't started) — real
            questions the grounded context can answer from records, not canned
            advice (see QUICK_PROMPTS' own header comment). */}
        {messages.length <= 2 && (
          <div className="mt-1">
            <div className="mb-2 text-center text-xs font-medium text-subtle">Ask about</div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => sendMessage(p.question)}
                  className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-left shadow-(--shadow-border) transition-colors hover:bg-surface-2"
                >
                  <p.icon size={16} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="text-xs leading-snug font-medium text-fg">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger-soft p-3">
            <div className="text-sm leading-relaxed text-danger">{error}</div>
            <button
              type="button"
              onClick={() => {
                // Retry the last question the user actually asked.
                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                if (lastUser) { setMessages((m) => m.filter((x) => x.id !== lastUser.id)); sendMessage(lastUser.text); }
              }}
              className="mt-2 rounded-md bg-danger/15 px-3 py-1.5 text-xs font-semibold text-danger"
            >
              Try again
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer — pinned above the mobile tab bar (a flex-shrink-0 sibling
          inside .screen-content, which is itself the scroll container; see
          app/global.css's ".screen-content"/".bottom-nav" comments), with the
          safe-area inset honoured for phones that lack a bottom bar here
          (desktop/tablet, where the sidebar replaces it). */}
      <div className="shrink-0 border-t border-border bg-surface px-screen pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-10 max-h-24 flex-1 resize-none rounded-md bg-surface-2 px-3 py-2.5 text-[16px] leading-snug text-fg outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring/30"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="Ask about your farm…"
          />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
              input.trim() && !isTyping ? 'bg-primary' : 'bg-surface-2'
            }`}
            aria-label="Send"
          >
            <Send size={16} className={input.trim() && !isTyping ? 'text-primary-fg' : 'text-subtle'} />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-subtle">
          Advisory only, and not a substitute for a vet. Figures come from your own records — verify anything before acting on it.
        </p>
      </div>
    </div>
  );
}
