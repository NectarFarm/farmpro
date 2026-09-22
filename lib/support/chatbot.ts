// ── Support chatbot: system prompt + escalation detection (pure) ───────────
// (SaaS back-office backend). No function-calling/tool-use plumbing exists
// in this codebase's OpenRouter client (lib/ai-advisor.ts's callAdvisor is a
// plain text-in/text-out call) — rather than build a second, bespoke tool-use
// integration for this one endpoint, the model is instructed to signal
// escalation with a single parseable marker line at the end of its reply,
// which is stripped before the text reaches the user. A keyword-based
// fallback (`detectEscalationIntent`) also runs on the user's own last
// message independently of the model's output, so "I need a human" still
// gets a ticket suggestion even if the model forgets the marker, and so the
// escalation path works AT ALL when no API key is configured (see
// app/api/support/chat/route.ts's canned-reply path).
import type { TicketCategory, TicketPriority } from '@/db/schemas'

export const TICKET_CATEGORIES: readonly TicketCategory[] = ['question', 'bug', 'billing', 'complaint', 'feature_request', 'account']
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high', 'urgent']

export const SUPPORT_SYSTEM_PROMPT = [
  'You are the IFMS support assistant. IFMS is an integrated farm-management app used by smallholder and mid-size farms — modules include Batches (livestock/crop cohorts), Inventory, Finance & Payroll, Tasks & Governance (approvals), Reports, and account/billing settings.',
  '',
  'FAQ you can answer directly, from what you already know about IFMS (never invent a feature that is not one of the modules above):',
  '- Trials: a new plan subscription starts a free trial when the plan offers one; otherwise it goes to "pending payment" until a payment is confirmed.',
  '- Payments: IFMS has no card/mobile-money gateway yet — a tenant submits a payment reference (e.g. a mobile money transaction id) and a platform admin confirms it, which activates the subscription.',
  '- Roles: owner, manager, worker, vet and auditor each see a different set of modules and permissions, configured per tenant.',
  '- Data: every tenant\'s farm data (batches, inventory, finance) is private to that tenant.',
  '',
  'Answer plainly and briefly (a few sentences, no headings) when you can genuinely help from the FAQ above.',
  '',
  'If the user explicitly asks to speak to a human/support agent, reports what sounds like a bug, a billing problem, or a complaint, or you cannot resolve their question from the FAQ above, end your reply with a new line starting with exactly `ESCALATE:` followed by compact JSON — nothing else on that line — with this shape: {"category":"question|bug|billing|complaint|feature_request|account","priority":"low|normal|high|urgent","subject":"a short subject line"}. Only add this line when escalation is genuinely warranted; never add it to a normal answered question.',
].join('\n')

export interface ParsedReply {
  reply: string
  escalation: { category: TicketCategory; priority: TicketPriority; subject: string } | null
}

const ESCALATE_PREFIX = 'ESCALATE:'

/** Strips a trailing `ESCALATE: {...}` marker line out of the model's raw
 * text, returning the clean user-facing reply plus the parsed escalation
 * (or null if there was none, or it didn't parse into something valid). */
export function parseEscalationMarker(raw: string): ParsedReply {
  const lines = raw.split('\n')
  const markerIdx = lines.findIndex((l) => l.trim().startsWith(ESCALATE_PREFIX))
  if (markerIdx === -1) return { reply: raw.trim(), escalation: null }

  const jsonPart = lines[markerIdx].trim().slice(ESCALATE_PREFIX.length).trim()
  const reply = lines.filter((_, i) => i !== markerIdx).join('\n').trim()

  try {
    const parsed = JSON.parse(jsonPart) as Record<string, unknown>
    const category = TICKET_CATEGORIES.includes(parsed.category as TicketCategory) ? (parsed.category as TicketCategory) : 'question'
    const priority = TICKET_PRIORITIES.includes(parsed.priority as TicketPriority) ? (parsed.priority as TicketPriority) : 'normal'
    const subject = typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim().slice(0, 200) : 'Support request from chat'
    return { reply, escalation: { category, priority, subject } }
  } catch {
    return { reply, escalation: null }
  }
}

const HUMAN_KEYWORDS = /\b(human|agent|representative|real person|talk to someone|speak to someone)\b/i
const BUG_KEYWORDS = /\b(bug|broken|crash(?:ed|ing)?|error|not working|doesn'?t work|glitch)\b/i
const BILLING_KEYWORDS = /\b(billing|invoice|charge(?:d)?|payment|refund|subscription|overcharged|cancel my (plan|subscription))\b/i
const COMPLAINT_KEYWORDS = /\b(complain(?:t)?|unhappy|frustrated|angry|terrible|awful|unacceptable)\b/i

/**
 * A keyword-based fallback that runs on the user's own last message,
 * independent of anything the model says — this is what keeps the
 * escalation path alive with no API key configured, and catches an obvious
 * "I need a human" even if the model forgets the marker.
 */
export function detectEscalationIntent(message: string): { category: TicketCategory; priority: TicketPriority } | null {
  if (BILLING_KEYWORDS.test(message)) return { category: 'billing', priority: 'high' }
  if (BUG_KEYWORDS.test(message)) return { category: 'bug', priority: 'normal' }
  if (COMPLAINT_KEYWORDS.test(message)) return { category: 'complaint', priority: 'high' }
  if (HUMAN_KEYWORDS.test(message)) return { category: 'question', priority: 'normal' }
  return null
}

/** The reply returned when no OPENROUTER_API_KEY is configured — the
 * escalation path (suggestTicket -> POST /api/support/chat/escalate) still
 * works with no AI backend at all. */
export function cannedReply(lastUserMessage: string): ParsedReply {
  const intent = detectEscalationIntent(lastUserMessage)
  return {
    reply: "I can't answer questions automatically right now, but I can open a support ticket so a team member can help you directly.",
    escalation: { category: intent?.category ?? 'question', priority: intent?.priority ?? 'normal', subject: lastUserMessage.slice(0, 200) || 'Support request from chat' },
  }
}
