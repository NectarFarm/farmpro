'use client';
// Floating AI farm advisor. Answers are grounded in the farm's live data and the
// conversation is multi-turn + persisted to localStorage, so reloading keeps the
// thread (no lost context, no re-asking). Degrades gracefully with no API key.
import { useState, useEffect, useRef } from 'react';
import { Bot, X } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth';
import { useDraggableFab } from './useDraggableFab';

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean };

const SUGGESTIONS = [
  'Why might my mortality be high?',
  'How can I cut my feed cost?',
  'Which batch is most profitable?',
  'What should I record more of?',
];

export function AIAdvisor() {
  const { user } = useAuthStore();
  const storageKey = `ifms_ai_chat_${user?.id ?? 'anon'}`;
  const fab = useDraggableFab(`ifms_fab_pos_ai_advisor_${user?.id ?? 'anon'}`);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load persisted history once per user.
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) setMessages(JSON.parse(raw)); } catch { /* ignore */ }
    setHydrated(true);
  }, [storageKey]);

  // Persist (cap at last 50 turns so storage never bloats).
  useEffect(() => {
    if (hydrated) { try { localStorage.setItem(storageKey, JSON.stringify(messages.slice(-50))); } catch { /* ignore */ } }
  }, [messages, hydrated, storageKey]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy, open]);

  const ask = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setQ('');
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await fetch('/api/ai/advise', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setMessages((m) => [...m, { role: 'assistant', content: data.answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally { setBusy(false); }
  };

  const clear = () => { setMessages([]); try { localStorage.removeItem(storageKey); } catch { /* ignore */ } };

  return (
    <>
      <button
        ref={fab.ref}
        style={fab.style}
        onPointerDown={fab.onPointerDown}
        onPointerMove={fab.onPointerMove}
        onPointerUp={fab.onPointerUp}
        onClick={() => { if (!fab.wasDragged()) setOpen(true); }}
        aria-label="AI advisor"
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-5 z-40 flex items-center gap-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-full shadow-lg px-4 py-3 font-semibold text-sm cursor-grab active:cursor-grabbing">
        <Bot className="w-5 h-5" /><span className="hidden sm:inline">AI Advisor</span>
        {messages.length > 0 && <span className="w-2 h-2 rounded-full bg-emerald-400" title="Saved conversation" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-0 sm:left-4 sm:bottom-4 w-full sm:max-w-md h-[82vh] sm:h-[72vh] bg-white sm:rounded-2xl shadow-2xl flex flex-col">
            <div className="bg-indigo-700 text-white px-5 py-4 sm:rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                <div>
                  <h2 className="text-lg font-bold leading-tight">AI Farm Advisor</h2>
                  <p className="text-indigo-200 text-xs">Uses your live data · remembers this chat</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && <button onClick={clear} className="text-indigo-200 hover:text-white text-xs border border-indigo-400 rounded-lg px-2 py-1">Clear</button>}
                <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/80 hover:text-white"><X className="w-6 h-6" /></button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-gray-500">Ask anything about your farm. Try:</p>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => ask(s)} className="text-left text-sm bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-xl px-3 py-2 hover:bg-indigo-100">{s}</button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                m.role === 'user'
                  ? <div key={i} className="self-end bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-2 text-sm max-w-[85%]">{m.content}</div>
                  : <div key={i} className={`self-start rounded-2xl rounded-bl-sm px-4 py-2 text-sm max-w-[90%] whitespace-pre-wrap ${m.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-800'}`}>{m.content}</div>
              ))}
              {busy && <div className="self-start bg-gray-100 text-gray-400 rounded-2xl px-4 py-2 text-sm">Thinking…</div>}
            </div>

            <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="p-3 border-t border-gray-200 flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the advisor…"
                className="flex-1 border-2 border-gray-300 rounded-xl px-4 py-2 text-sm" />
              <button type="submit" disabled={busy || !q.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">Ask</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
