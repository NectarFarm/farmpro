import { NextResponse } from 'next/server'
import { requireTenantSession } from '@/lib/api-auth'
import { callAdvisor, DEFAULT_MODEL, normalizeMessages, timeoutSignal } from '@/lib/ai-advisor'
import { cannedReply, detectEscalationIntent, parseEscalationMarker, SUPPORT_SYSTEM_PROMPT } from '@/lib/support/chatbot'
import { checkAndConsumeChatThrottle } from '@/lib/support/chat-throttle'

// ── POST /api/support/chat (any authenticated tenant user) ─────────────────
// Body: { messages: [{ role: 'user'|'assistant', content }] }. Reuses the
// existing OpenRouter client (lib/ai-advisor.ts's callAdvisor) with a support
// system prompt instead of the farm-advisor one — see
// lib/support/chatbot.ts's header for why escalation is signalled with a
// parseable marker line rather than real tool-calling, which this codebase's
// client doesn't have.
//
// With no OPENROUTER_API_KEY configured, this still returns 200 with a
// canned reply AND a suggestTicket, so the escalation path
// (POST /api/support/chat/escalate) works even with no AI backend at all.
const bad = (msg: string, status = 400) => NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request) {
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { session } = auth

  const throttle = await checkAndConsumeChatThrottle(session.id)
  if (!throttle.allowed) {
    return NextResponse.json(
      { success: false, error: 'You are sending messages too quickly. Please wait a bit and try again.', retryAfterSeconds: throttle.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds ?? 60) } }
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>

  const messages = normalizeMessages(body.messages)
  if (!messages) return bad('messages must be a non-empty array of { role: "user"|"assistant", content: string }.')

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const apiKey = process.env.OPENROUTER_API_KEY

  let parsed: { reply: string; escalation: { category: string; priority: string; subject: string } | null }

  if (!apiKey) {
    parsed = cannedReply(lastUserMessage)
  } else {
    const result = await callAdvisor(SUPPORT_SYSTEM_PROMPT, messages, {
      apiKey,
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      signal: timeoutSignal(30_000),
      maxTokens: 500,
    })
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    parsed = parseEscalationMarker(result.answer)
    // The model's own signal wins; the keyword fallback only fills in when
    // it forgot to signal escalation at all.
    if (!parsed.escalation) {
      const fallback = detectEscalationIntent(lastUserMessage)
      if (fallback) parsed = { reply: parsed.reply, escalation: { ...fallback, subject: lastUserMessage.slice(0, 200) || 'Support request from chat' } }
    }
  }

  const suggestTicket = parsed.escalation
    ? { subject: parsed.escalation.subject, category: parsed.escalation.category, priority: parsed.escalation.priority, summary: lastUserMessage.slice(0, 300) }
    : undefined

  return NextResponse.json({ success: true, data: { reply: parsed.reply, suggestTicket } }, { status: 200 })
}
