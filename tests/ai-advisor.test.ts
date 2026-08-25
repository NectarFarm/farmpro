// ── AI advisor: contract + live grounding smoke test (epic #258) ────────────
// The pure parts (message normalisation, prompt construction) always run. The
// live OpenRouter call runs ONLY when OPENROUTER_API_KEY is set, so CI without
// a key stays green instead of failing on a missing secret — the same
// DATABASE_URL-gating convention this repo's integration tests already use.
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/db', () => ({ db: {} }))

import {
  buildSystemPrompt, callAdvisor, DEFAULT_MODEL, MAX_CONTENT_CHARS, MAX_MESSAGES,
  normalizeMessages, renderContext, type FarmContext,
} from '@/lib/ai-advisor'

const CTX: FarmContext = {
  farmScope: 'all farms in this account',
  activeBatches: [
    { code: 'BRO-KMU-022', species: 'Broiler', stage: 'Finisher', current: 892, initial: 920 },
    { code: 'LAY-KMU-007', species: 'Layer', stage: 'Laying', current: 400, initial: 410 },
  ],
  deaths30d: [{ code: 'BRO-KMU-022', deaths: 28 }],
  production30d: [{ product: 'Eggs (trays)', qty: 214, unit: 'trays' }],
  lowStock: [{ name: 'Layer Mash', onHand: 320, unit: 'kg', threshold: 500 }],
  openTasks: [{ title: 'Morning feeding — House A01', status: 'PENDING', dueAt: '2026-08-25' }],
  overdueTaskCount: 1,
  workerCount: 4,
}

describe('normalizeMessages()', () => {
  it('rejects anything that is not a well-formed message array', () => {
    for (const bad of [null, undefined, {}, 'hi', [], [{ role: 'system', content: 'x' }], [{ role: 'user' }], [{ role: 'user', content: 5 }]]) {
      expect(normalizeMessages(bad)).toBeNull()
    }
  })

  it('keeps only the last MAX_MESSAGES turns', () => {
    const many = Array.from({ length: MAX_MESSAGES + 6 }, (_, i) => ({ role: 'user', content: `q${i}` }))
    const out = normalizeMessages(many)!
    expect(out).toHaveLength(MAX_MESSAGES)
    // The TAIL is the live conversation — the head is what's safe to forget.
    expect(out[out.length - 1].content).toBe(`q${MAX_MESSAGES + 5}`)
  })

  it('truncates each message so a pasted wall of text cannot blow the context window', () => {
    const out = normalizeMessages([{ role: 'user', content: 'x'.repeat(MAX_CONTENT_CHARS + 500) }])!
    expect(out[0].content).toHaveLength(MAX_CONTENT_CHARS)
  })

  it('drops whitespace-only turns rather than sending empty content upstream', () => {
    expect(normalizeMessages([{ role: 'user', content: '   ' }])).toBeNull()
    expect(normalizeMessages([{ role: 'user', content: ' real ' }, { role: 'assistant', content: '' }]))
      .toEqual([{ role: 'user', content: 'real' }])
  })
})

describe('renderContext() / buildSystemPrompt()', () => {
  it('renders an absent section as an explicit "none on record", never []', () => {
    const empty = renderContext({ ...CTX, lowStock: [], deaths30d: [] })
    expect(empty).toContain('(none on record)')
    expect(empty).not.toContain('[]')
  })

  it('carries every real figure into the prompt', () => {
    const p = buildSystemPrompt(CTX, 'Kamau Poultry Farm')
    expect(p).toContain('Kamau Poultry Farm')
    expect(p).toContain('BRO-KMU-022')
    expect(p).toContain('892 of 920 head remaining')
    expect(p).toContain('Layer Mash: 320 kg on hand (threshold 500)')
  })

  it('states the no-invented-figures rule and the withdrawal-period ban', () => {
    const p = buildSystemPrompt(CTX, null)
    expect(p).toContain('only source of facts')
    expect(p).toMatch(/withdrawal period/i)
    expect(p).toMatch(/not a vet/i)
  })
})

describe('callAdvisor() upstream error mapping', () => {
  const stub = (status: number) => vi.fn(async () => new Response('{"error":"x"}', { status }))

  it('never passes an upstream 401 through as a caller-facing 401', async () => {
    vi.stubGlobal('fetch', stub(401))
    const r = await callAdvisor('sys', [{ role: 'user', content: 'hi' }], { apiKey: 'bad' })
    expect(r.ok).toBe(false)
    // Our misconfiguration must not read to the farmer as "you are unauthorized".
    expect((r as { status: number }).status).toBe(503)
  })

  it('maps out-of-credit to a 503 that names the real cause', async () => {
    vi.stubGlobal('fetch', stub(402))
    const r = await callAdvisor('sys', [{ role: 'user', content: 'hi' }], { apiKey: 'k' })
    expect((r as { status: number; error: string }).status).toBe(503)
    expect((r as { error: string }).error).toMatch(/credit/i)
  })

  it('maps a rate limit to 429', async () => {
    vi.stubGlobal('fetch', stub(429))
    const r = await callAdvisor('sys', [{ role: 'user', content: 'hi' }], { apiKey: 'k' })
    expect((r as { status: number }).status).toBe(429)
  })

  it('treats an empty completion as a failure rather than an empty answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), { status: 200 })))
    const r = await callAdvisor('sys', [{ role: 'user', content: 'hi' }], { apiKey: 'k' })
    expect(r.ok).toBe(false)
  })
})

const KEY = process.env.OPENROUTER_API_KEY
describe.skipIf(!KEY)('live OpenRouter grounding (needs OPENROUTER_API_KEY)', () => {
  it('answers from the injected context and does not invent a batch', async () => {
    vi.unstubAllGlobals()
    const r = await callAdvisor(
      buildSystemPrompt(CTX, 'Kamau Poultry Farm'),
      [{ role: 'user', content: 'How many birds are left in my broiler batch, and what is my worst stock problem?' }],
      { apiKey: KEY!, model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL },
    )
    expect(r.ok).toBe(true)
    const answer = (r as { answer: string }).answer
    console.info('\n[live answer]\n' + answer + '\n')
    expect(answer).toMatch(/892/)
    expect(answer).toMatch(/layer mash/i)
  }, 60_000)

  it('refuses to invent a figure the context does not contain', async () => {
    vi.unstubAllGlobals()
    const r = await callAdvisor(
      buildSystemPrompt(CTX, 'Kamau Poultry Farm'),
      [{ role: 'user', content: 'What was my exact feed conversion ratio and net profit in KSh last month?' }],
      { apiKey: KEY!, model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL },
    )
    expect(r.ok).toBe(true)
    const answer = (r as { answer: string }).answer
    console.info('\n[live refusal]\n' + answer + '\n')
    // Two properties, and the second is the one that matters:
    //   1. it signals it cannot answer, and
    //   2. it emits NO money figure and NO ratio — the context carries zero
    //      financials and zero weight samples, so ANY such number would be
    //      fabricated. This is the assertion that would catch a regression in
    //      the grounding prompt; the refusal wording is free to vary.
    expect(answer).toMatch(/can'?t|cannot|don'?t have|do not have|not recorded|no feed|not captur|not track|unable/i)
    expect(answer).not.toMatch(/KSh\s*[\d,]/i)
    expect(answer).not.toMatch(/FCR (?:is|was|of)\s*[\d.]/i)
  }, 60_000)
})
