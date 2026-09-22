// ── Support chatbot escalation parsing (pure-function unit tests) ──────────
import { describe, it, expect } from 'vitest'
import { cannedReply, detectEscalationIntent, parseEscalationMarker } from '@/lib/support/chatbot'

describe('parseEscalationMarker', () => {
  it('a plain answer with no marker passes through unchanged, no escalation', () => {
    const result = parseEscalationMarker('You can find that under Reports > P&L.')
    expect(result).toEqual({ reply: 'You can find that under Reports > P&L.', escalation: null })
  })

  it('strips a valid ESCALATE marker line and parses the JSON', () => {
    const raw = 'I could not find that in the FAQ.\nESCALATE: {"category":"bug","priority":"high","subject":"Login fails on Android"}'
    const result = parseEscalationMarker(raw)
    expect(result.reply).toBe('I could not find that in the FAQ.')
    expect(result.escalation).toEqual({ category: 'bug', priority: 'high', subject: 'Login fails on Android' })
  })

  it('falls back to safe defaults for an unrecognized category/priority', () => {
    const raw = 'Hmm.\nESCALATE: {"category":"nonsense","priority":"nonsense","subject":"Something"}'
    const result = parseEscalationMarker(raw)
    expect(result.escalation).toEqual({ category: 'question', priority: 'normal', subject: 'Something' })
  })

  it('malformed JSON after the marker is treated as no escalation, reply still cleaned', () => {
    const raw = 'Sorry, I cannot help.\nESCALATE: not-json-at-all'
    const result = parseEscalationMarker(raw)
    expect(result.escalation).toBeNull()
    expect(result.reply).toBe('Sorry, I cannot help.')
  })

  it('a missing subject gets a sensible default rather than an empty string', () => {
    const raw = 'ESCALATE: {"category":"billing","priority":"urgent"}'
    const result = parseEscalationMarker(raw)
    expect(result.escalation?.subject).toBe('Support request from chat')
  })
})

describe('detectEscalationIntent', () => {
  it('detects a request for a human', () => {
    expect(detectEscalationIntent('Can I talk to a human please')).toEqual({ category: 'question', priority: 'normal' })
  })
  it('detects a billing complaint with high priority', () => {
    expect(detectEscalationIntent('I was overcharged on my subscription')).toEqual({ category: 'billing', priority: 'high' })
  })
  it('detects a bug report', () => {
    expect(detectEscalationIntent('The app crashed when I tried to save')).toEqual({ category: 'bug', priority: 'normal' })
  })
  it('detects a general complaint', () => {
    expect(detectEscalationIntent('This is unacceptable, I am so frustrated')).toEqual({ category: 'complaint', priority: 'high' })
  })
  it('returns null for an ordinary question', () => {
    expect(detectEscalationIntent('How do I add a new batch?')).toBeNull()
  })
})

describe('cannedReply (no API key configured)', () => {
  it('always returns a suggestTicket so the escalation path still works with no AI backend', () => {
    const result = cannedReply('My invoice is wrong, please refund me')
    expect(result.escalation).not.toBeNull()
    expect(result.escalation?.category).toBe('billing')
    expect(result.reply.length).toBeGreaterThan(0)
  })

  it('falls back to a generic question category when no keyword matches', () => {
    const result = cannedReply('hello there')
    expect(result.escalation).toEqual({ category: 'question', priority: 'normal', subject: 'hello there' })
  })
})
