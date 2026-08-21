'use client';
import React, { useState, useRef, useEffect } from 'react';
import { useNav, TopNav } from './navigation';
import { Send, Bot, UserSingle as User, Sparkles, Leaf, DollarSign, AlertTriangle, RefreshCw } from './icons';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
}

/* ── Canned AI responses ── */
const AI_RESPONSES: Record<string, string> = {
  feed: 'Based on BRO-KMU-022 (920 birds at 35 days), the recommended feed rate is **85–90g/bird/day** (Finisher phase). Your current FCR is 1.82, which is within target. Consider switching to ad libitum feeding if temperatures drop below 18°C this weekend. 🌾',
  mortality: "The 8% cumulative mortality in BRO-KMU-022 is above the 5% benchmark for this age group. I'd recommend:\n1. Check ventilation in House A01 — temperatures may be spiking mid-day.\n2. Ensure coccidiosis prevention is current.\n3. Request a vet inspection if 2+ birds die today.\n\nWould you like me to draft a vet task? 🐔",
  weather: "Saturday's heavy rain (82% probability) poses risk to your Layer House B. Key actions:\n• Check roof drainage channels — clogged gutters flood bedding.\n• Reduce stocking density if humidity exceeds 75%.\n• Stock up on Layer Mash (currently only 320kg; I'd order 500kg before Friday).\n\nYour Field F01 maize is at 75% growth — hold off on fertiliser application until Sunday. 🌧️",
  profit: 'For BRO-KMU-022 so far:\n- Revenue (projected): KSh 322,000 (920 birds @ KSh 350)\n- COGS to date: KSh 145,000\n- Estimated gross profit: **KSh 177,000** (55% margin)\n\nThis is tracking 8% above your October target. Main cost driver: feed at 62% of COGS. Want a full batch P&L breakdown? 💰',
  task: "Here are today's priority tasks:\n🔴 Overdue: Morning Feeding – House A01 (John Kamau, due 08:00)\n🟡 Pending: Egg Collection – Pen B01 (awaiting approval)\n🟡 Pending: Maize Field Weed Inspection (Ann Wambui)\n✅ Done: Milking – Morning Round (Sarah Mwangi)\n\nShall I send John a reminder about the overdue feeding? 📋",
  inventory: 'Low stock alerts:\n⚠️ **Layer Mash**: 320kg remaining (reorder point: 500kg). At 120kg/day, you have ~2.7 days left.\n⚠️ **Oxymav B**: 400g remaining — check with Dr. Ken if treatment is still needed.\n\nAll other feeds are adequate. Want me to generate a purchase order for Layer Mash? 📦',
  default: "I'm your IFMS farm assistant! 🌾 I can help you with:\n\n• **Feed & nutrition** — optimal rates, FCR analysis\n• **Health & mortality** — alerts, vet recommendations\n• **Weather advice** — task adjustments for upcoming conditions\n• **Financials** — batch P&L, cost analysis\n• **Tasks** — what needs doing today\n• **Inventory** — stock alerts and purchase orders\n\nWhat would you like to know about your farm?",
};

function getAIResponse(input: string): string {
  const lower = input.toLowerCase();
  if (lower.includes('feed') || lower.includes('fcr') || lower.includes('mash')) return AI_RESPONSES.feed;
  if (lower.includes('mortality') || lower.includes('dead') || lower.includes('death')) return AI_RESPONSES.mortality;
  if (lower.includes('weather') || lower.includes('rain') || lower.includes('rain')) return AI_RESPONSES.weather;
  if (lower.includes('profit') || lower.includes('revenue') || lower.includes('cost') || lower.includes('finance')) return AI_RESPONSES.profit;
  if (lower.includes('task') || lower.includes('overdue') || lower.includes('todo')) return AI_RESPONSES.task;
  if (lower.includes('stock') || lower.includes('inventory') || lower.includes('order')) return AI_RESPONSES.inventory;
  return AI_RESPONSES.default;
}

const QUICK_PROMPTS = [
  { icon: '🌾', label: 'Feed rates today' },
  { icon: '📊', label: 'Batch profit summary' },
  { icon: '🌧️', label: 'Weather impact advice' },
  { icon: '📋', label: "Today's priority tasks" },
  { icon: '📦', label: 'Low stock alerts' },
  { icon: '💀', label: 'Mortality analysis' },
];

const now = () => new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

const INITIAL_MESSAGES: Message[] = [
  {
    id: 'init',
    role: 'assistant',
    text: "Hello James! 👋 I'm your IFMS farm assistant.\n\nI have live data on your 6 active batches, today's tasks, inventory levels, and the weekend weather forecast. How can I help you right now?",
    time: '09:00',
  },
];

export function AIChatScreen() {
  const { navigate } = useNav();
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  function sendMessage(text: string) {
    if (!text.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: text.trim(), time: now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setIsTyping(true);
    setTimeout(() => {
      const reply = getAIResponse(text);
      setMessages((m) => [...m, { id: (Date.now() + 1).toString(), role: 'assistant', text: reply, time: now() }]);
      setIsTyping(false);
    }, 900 + Math.random() * 600);
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

  return (
    <div className="screen-content" style={{ display: 'flex', flexDirection: 'column' }}>
      <TopNav
        title="AI Farm Assistant"
        subtitle="Powered by IFMS Intelligence"
        rightEl={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 100, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary-green)' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary-green)' }}>Online</span>
          </div>
        }
      />

      {/* Chat messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {/* Context strip */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            { icon: '🐔', label: '6 batches active' },
            { icon: '📋', label: '2 overdue tasks' },
            { icon: '☁️', label: 'Rain Saturday' },
            { icon: '⚠️', label: '1 low stock' },
          ].map((c) => (
            <div
              key={c.label}
              style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '5px 10px', background: 'var(--card)', borderRadius: 100, border: '1px solid var(--border-subtle)', flexShrink: 0 }}
            >
              <span style={{ fontSize: 12 }}>{c.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{c.label}</span>
            </div>
          ))}
        </div>

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
                fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)',
              }}>
                {renderText(msg.text)}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left' }}>{msg.time}</div>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 8, textAlign: 'center' }}>Quick questions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => sendMessage(p.label)}
                  style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border-subtle)', cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'center', textAlign: 'left' }}
                >
                  <span style={{ fontSize: 16 }}>{p.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3 }}>{p.label}</span>
                </button>
              ))}
            </div>
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
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 5, textAlign: 'center' }}>
          AI responses are advisory only. Always verify with farm professionals.
        </div>
      </div>
    </div>
  );
}
