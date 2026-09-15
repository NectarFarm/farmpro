// ── Weather recommendations: parsing is the safety layer ───────────────────
// A card is an instruction a farmer acts on, so a malformed or fabricated one
// must produce NO card rather than a half-parsed one. The live case at the
// bottom runs the real prompt through the real model and asserts the output
// survives the real parser — skipped without a key so CI stays green.
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/db', () => ({ db: {} }))

import { buildAdvicePrompt, parseAdvice, ADVICE_MODEL_SUFFIX } from '@/lib/farm-advice'
import { callAdvisor, DEFAULT_MODEL, type FarmContext } from '@/lib/ai-advisor'

const CTX: FarmContext = {
  farmScope: 'all farms in this account',
  activeBatches: [{ code: 'BRO-KMU-022', species: 'Broiler', stage: 'Finisher', current: 892, initial: 920 }],
  deaths30d: [{ code: 'BRO-KMU-022', deaths: 28 }],
  production30d: [{ product: 'Eggs (trays)', qty: 214, unit: 'trays' }],
  lowStock: [{ name: 'Layer Mash', onHand: 320, unit: 'kg', threshold: 500 }],
  openTasks: [{ title: 'Weed maize block F01', status: 'PENDING', dueAt: '2026-09-16' }],
  overdueTaskCount: 1,
  workerCount: 4,
}
const DAYS = [
  { date: '2026-09-15', tempMaxC: 26, tempMinC: 14, rainChancePct: 10, rainMm: 0 },
  { date: '2026-09-16', tempMaxC: 24, tempMinC: 13, rainChancePct: 80, rainMm: 18.4 },
  { date: '2026-09-17', tempMaxC: 23, tempMinC: 13, rainChancePct: 65, rainMm: 9.1 },
]

const card = (over: Record<string, unknown> = {}) => ({
  title: 'Move feed under cover', action: 'Shift the Layer Mash indoors before Wednesday.',
  from: '2026-09-15', to: '2026-09-16', urgency: 'today', basis: 'forecast',
  activity: 'stock', enterprise: 'layer', why: 'Heavy rain expected.', ...over,
})
const wrap = (cards: unknown[]) => JSON.stringify({ recommendations: cards })

describe('parseAdvice()', () => {
  it('accepts a well-formed card', () => {
    const out = parseAdvice(wrap([card()]))
    expect(out).toHaveLength(1)
    expect(out[0].activity).toBe('stock')
  })

  it('survives a code fence and leading prose the prompt asked it not to add', () => {
    expect(parseAdvice('Here you go:\n```json\n' + wrap([card()]) + '\n```')).toHaveLength(1)
  })

  it('returns nothing at all for unparseable output', () => {
    for (const bad of ['', 'no json here', '{', '{"recommendations":"nope"}']) {
      expect(parseAdvice(bad)).toEqual([])
    }
  })

  it('drops a card with a malformed or missing date rather than guessing one', () => {
    expect(parseAdvice(wrap([card({ from: 'next week' })]))).toEqual([])
    expect(parseAdvice(wrap([card({ to: undefined })]))).toEqual([])
  })

  it('drops a card whose urgency or basis is not one we defined', () => {
    expect(parseAdvice(wrap([card({ urgency: 'URGENT!!' })]))).toEqual([])
    expect(parseAdvice(wrap([card({ basis: 'vibes' })]))).toEqual([])
  })

  it('repairs a backwards date range to a single day', () => {
    expect(parseAdvice(wrap([card({ from: '2026-09-16', to: '2026-09-15' })]))[0].to).toBe('2026-09-16')
  })

  it('falls back to "other" for an unknown activity instead of dropping the card', () => {
    // Unknown activity only costs an icon; unknown urgency changes what the
    // farmer thinks is due today, which is why that one is fatal and this is not.
    expect(parseAdvice(wrap([card({ activity: 'interpretive-dance' })]))[0].activity).toBe('other')
  })

  it('strips a fabricated source link, keeping the card', () => {
    // A made-up "read more" on farming advice is worse than no link.
    expect(parseAdvice(wrap([card({ sourceUrl: 'not a url' })]))[0].sourceUrl).toBeUndefined()
    expect(parseAdvice(wrap([card({ sourceUrl: 'javascript:alert(1)' })]))[0].sourceUrl).toBeUndefined()
    expect(parseAdvice(wrap([card({ sourceUrl: 'https://example.org/guide' })]))[0].sourceUrl).toBe('https://example.org/guide')
  })

  it('caps the list so the screen cannot be flooded', () => {
    expect(parseAdvice(wrap(Array.from({ length: 20 }, () => card())))).toHaveLength(6)
  })
})

describe('buildAdvicePrompt()', () => {
  it('names only the enterprises the farm actually runs', () => {
    const p = buildAdvicePrompt(CTX, DAYS, 'Kamau Poultry', '2026-09-15', ['broiler', 'layer'])
    expect(p).toMatch(/This farm runs: broiler, layer/)
    expect(p).toMatch(/do not advise on an enterprise they do not have/)
  })

  it('carries the real forecast and the real farm figures', () => {
    const p = buildAdvicePrompt(CTX, DAYS, 'Kamau Poultry', '2026-09-15', ['layer'])
    expect(p).toMatch(/80% chance of rain/)
    expect(p).toMatch(/892 of 920 head remaining/)
  })

  it('keeps the no-invented-figures and no-withdrawal-period rules', () => {
    const p = buildAdvicePrompt(CTX, DAYS, null, '2026-09-15', [])
    expect(p).toMatch(/Never state a number about THIS farm that is not in the FARM DATA/)
    expect(p).toMatch(/Never give a withdrawal period/)
    expect(p).toMatch(/Never construct or guess a URL/)
  })

  it('says so when the forecast is unavailable rather than letting one be invented', () => {
    expect(buildAdvicePrompt(CTX, [], null, '2026-09-15', [])).toMatch(/do not invent one/)
  })
})

const KEY = process.env.OPENROUTER_API_KEY
describe.skipIf(!KEY)('live generation (needs OPENROUTER_API_KEY)', () => {
  it('returns cards that survive the real parser', async () => {
    const model = `${process.env.OPENROUTER_MODEL || DEFAULT_MODEL}${ADVICE_MODEL_SUFFIX}`
    const res = await callAdvisor(
      buildAdvicePrompt(CTX, DAYS, 'Kamau Poultry Farm', '2026-09-15', ['broiler', 'layer', 'maize']),
      [{ role: 'user', content: 'Give me my recommendations for the next five days.' }],
      { apiKey: KEY!, model, maxTokens: 2600 },
    )
    if (!res.ok) {
      // Out of credit / rate limited / provider down is an ACCOUNT condition,
      // not a code regression — the mapping of those to a farmer-readable
      // message is covered by tests/ai-advisor.test.ts. Anything else is a
      // real failure and still fails here.
      const status = (res as { status: number }).status
      if (status === 503 || status === 429 || status === 502) {
        console.warn(`[live] skipped — upstream said: ${(res as { error: string }).error}`)
        return
      }
      expect(res.ok).toBe(true)
    }
    const cards = parseAdvice((res as { answer: string }).answer)
    console.info('\n[live cards]\n' + JSON.stringify(cards, null, 2) + '\n')
    expect(cards.length).toBeGreaterThan(0)
    // Every card must be actionable and honestly attributed.
    for (const c of cards) {
      expect(c.from <= c.to).toBe(true)
      expect(['records', 'forecast', 'general']).toContain(c.basis)
      if (c.enterprise) expect(['broiler', 'layer', 'maize']).toContain(c.enterprise)
    }
  }, 120_000)
})
