'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useNav, TopNav } from './navigation';
import {
  Send, Bot, UserSingle as User, Sparkles,
  Wheat, BarChart3, ClipboardList, Package, Skull, Bird,
  type LucideIcon,
} from './icons';

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
        <TopNav title="AI Farm Assistant" subtitle="Not available for your role" />
        <div className="px-screen" style={{ paddingTop: 14 }}>
          <div className="farm-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <Bot size={20} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <div>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                The advisor is limited to owners and managers
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
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
    <div className="screen-content" style={{ display: 'flex', flexDirection: 'column' }}>
      <TopNav
        title="AI Farm Assistant"
        subtitle="Answers from your recorded data"
        rightEl={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 100, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)' }}>
            <Sparkles size={10} color="var(--primary-green)" aria-hidden="true" />
            <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--primary-green)' }}>
              {activeFarmId === 'ALL' ? 'All farms' : 'This farm'}
            </span>
          </div>
        }
      />

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {/* The context strip that used to sit here is deliberately gone.
            #259 task 2 asked whether it needed a new summary field on
            /api/dashboard/kpis or should be dropped: dropped. It claimed
            counts ("6 batches active", "1 low stock") with no endpoint
            behind them, and the advisor now states those figures properly
            from real records when asked — a decorative strip would be a
            second source of truth for the same numbers. */}

        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' && (
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 8, marginTop: 2 }}>
                <Bot size={14} color="var(--primary-green)" />
              </div>
            )}
            <div style={{ maxWidth: '78%' }}>
              <div style={{
                padding: '10px 14px', borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.role === 'user' ? 'rgba(74,222,128,0.2)' : 'var(--card)',
                border: msg.role === 'user' ? '1px solid rgba(74,222,128,0.35)' : '1px solid var(--border-subtle)',
                fontSize: 'var(--fs-base)', lineHeight: 1.55, color: 'var(--text-secondary)',
              }}>
                {renderText(msg.text)}
              </div>
              <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left' }}>{msg.time}</div>
            </div>
            {msg.role === 'user' && (
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
                <User size={14} color="var(--accent-blue)" />
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={14} color="var(--primary-green)" />
            </div>
            <div style={{ padding: '10px 14px', background: 'var(--card)', borderRadius: '18px 18px 18px 4px', border: '1px solid var(--border-subtle)', display: 'flex', gap: 4, alignItems: 'center' }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary-green)', opacity: 0.6, animation: `pulse 1.2s ease-in-out ${i * 0.3}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* Quick prompts (only when few messages) */}
        {messages.length <= 2 && (
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8, textAlign: 'center' }}>Ask about</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => sendMessage(p.question)}
                  style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border-subtle)', cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'center', textAlign: 'left' }}
                >
                  <p.icon size={16} color="var(--text-muted)" aria-hidden="true" />
                  <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div role="alert" style={{ padding: '10px 12px', marginBottom: 12, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 12 }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', lineHeight: 1.5 }}>{error}</div>
            <button
              onClick={() => {
                // Retry the last question the user actually asked.
                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                if (lastUser) { setMessages((m) => m.filter((x) => x.id !== lastUser.id)); sendMessage(lastUser.text); }
              }}
              style={{ marginTop: 7, padding: '5px 12px', borderRadius: 8, fontSize: 'var(--fs-xs)', fontWeight: 700, background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.3)', color: 'var(--status-critical)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            className="farm-input"
            style={{ flex: 1, resize: 'none', minHeight: 40, maxHeight: 100, lineHeight: 1.4 }}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder="Ask about your farm…"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isTyping}
            style={{
              width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: input.trim() && !isTyping ? 'var(--primary-green)' : 'var(--border-subtle)',
              border: 'none', cursor: input.trim() && !isTyping ? 'pointer' : 'default', flexShrink: 0, transition: 'background 0.2s',
            }}
          >
            <Send size={16} color={input.trim() && !isTyping ? '#0f1a0e' : 'var(--text-muted)'} />
          </button>
        </div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 5, textAlign: 'center' }}>
          Advisory only, and not a substitute for a vet. Figures come from your own records — verify anything before acting on it.
        </div>
      </div>
    </div>
  );
}
