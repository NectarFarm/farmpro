// ── Weather-aware farm recommendations (AI) ────────────────────────────────
// "What should I do, and when" for the next few days, grounded in two real
// sources: the farm's OWN records (active batches, what it produces, what
// stock is low, what work is open — lib/ai-advisor.ts's buildFarmContext) and
// the actual 5-day forecast for its GPS pin.
//
// Two rules carried over from the advisor, for the same reasons:
//
//   1. Never invent a figure. Anything numeric about this farm must come from
//      the context block. A farmer who checks one fabricated number stops
//      trusting every real one.
//   2. No drug dosages and no withdrawal periods. This app stores no
//      withdrawal window, so a plausible number there could put produce into
//      a food chain early.
//
// Web search is on (`:online`), which is what makes seasonal and regional
// guidance possible — but anything sourced that way is general advice and the
// prompt requires it to be labelled as such. The farm's numbers and the
// internet's opinions must not blur together on a card a farmer acts on.
import 'server-only'
import { buildFarmContext, callAdvisor, renderContext, type FarmContext } from '@/lib/ai-advisor'
import { CACHE_REVALIDATE_SECONDS, FETCH_TIMEOUT_MS, OPEN_METEO_URL, forecastParams } from '@/lib/weather-request'

// Default model gets `:online` appended so recommendations can draw on
// current seasonal/regional guidance, not just the model's training data.
// Verified against OpenRouter: the suffix is accepted for this slug.
export const ADVICE_MODEL_SUFFIX = ':online'

// How long a set of cards stays fresh. A 5-day forecast does not meaningfully
// change hour to hour, and each regeneration is a paid web-search call — six
// hours means at most four per farm per day, with a manual refresh for when
// something actually changed.
export const ADVICE_TTL_MS = 6 * 60 * 60 * 1000

export type Urgency = 'today' | 'soon' | 'plan'

// What KIND of work a card is asking for. Drives the icon and lets a farmer
// scan for "what am I planting/harvesting this week" without reading every
// card. Deliberately the vocabulary a farmer uses, not the app's record types.
export type Activity =
  | 'plant' | 'harvest' | 'weed' | 'irrigate' | 'feed' | 'health'
  | 'stock' | 'shelter' | 'sell' | 'other'

export interface Recommendation {
  title: string
  action: string
  // When this should happen, as plain ISO dates the UI renders in the
  // tenant's own format. `to` may equal `from` for a single-day action.
  from: string
  to: string
  urgency: Urgency
  // Why — and crucially WHICH source. 'records' means it came from this
  // farm's own data; 'forecast' from the 5-day outlook; 'general' from
  // seasonal/agronomic guidance rather than anything about this farm. The UI
  // labels them differently because they carry different authority.
  basis: 'records' | 'forecast' | 'general'
  why: string
  activity: Activity
  // Which of the farm's enterprises this is about ("broiler", "maize"), or
  // null for whole-farm advice. Lets the screen group cards under the
  // enterprises the farmer actually runs instead of one undifferentiated list.
  enterprise: string | null
  // Something to read. Only ever populated from a real search result — the
  // prompt forbids inventing a URL, and the parser drops any card whose link
  // is not a plain http(s) URL, because a fabricated source is worse than
  // none on advice a farmer is being asked to trust.
  sourceUrl?: string
  sourceTitle?: string
}

export interface AdvicePayload {
  recommendations: Recommendation[]
  generatedAt: string
  model: string
}

interface ForecastDay {
  date: string
  tempMaxC: number
  tempMinC: number
  rainChancePct: number
  rainMm: number
}

export async function fetchForecastDays(latitude: number, longitude: number): Promise<ForecastDay[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${OPEN_METEO_URL}?${forecastParams(latitude, longitude).toString()}`, {
      signal: controller.signal,
      next: { revalidate: CACHE_REVALIDATE_SECONDS },
    })
    if (!res.ok) return []
    const p = (await res.json()) as {
      daily?: {
        time?: string[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]
        precipitation_probability_max?: number[]; precipitation_sum?: number[]
      }
    }
    const d = p.daily
    if (!d?.time) return []
    return d.time.map((date, i) => ({
      date,
      tempMaxC: d.temperature_2m_max?.[i] ?? 0,
      tempMinC: d.temperature_2m_min?.[i] ?? 0,
      rainChancePct: d.precipitation_probability_max?.[i] ?? 0,
      rainMm: d.precipitation_sum?.[i] ?? 0,
    }))
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

function renderForecast(days: ForecastDay[]): string {
  if (days.length === 0) return 'FORECAST: unavailable right now — do not invent one, and say so if a recommendation would have depended on it.'
  return [
    'FORECAST (next days, for this farm\'s own coordinates):',
    ...days.map((d) => `  - ${d.date}: ${Math.round(d.tempMinC)}–${Math.round(d.tempMaxC)}°C, ${d.rainChancePct}% chance of rain, ${d.rainMm.toFixed(1)}mm expected`),
  ].join('\n')
}

export function buildAdvicePrompt(
  ctx: FarmContext, days: ForecastDay[], farmName: string | null, today: string, enterprises: string[],
): string {
  return [
    `You advise ${farmName ? `"${farmName}"` : 'a farm'}, a smallholder/mid-size farm in Kenya, inside its farm-management app. Today is ${today}.`,
    '',
    enterprises.length > 0
      ? `This farm runs: ${enterprises.join(', ')}. Every recommendation must be relevant to at least one of those — do not advise on an enterprise they do not have.`
      : 'This farm has not recorded which enterprises it runs, so keep advice general to mixed smallholder farming.',
    '',
    'Produce a short list of concrete actions the farmer should take over the next five days, each tied to a date range.',
    'Think about the work that is actually timing-sensitive on a farm: when to plant, when to harvest, when to weed, when to irrigate or hold off because rain is coming, when to move or shelter animals, when to restock feed before a price or supply problem, when to sell.',
    '',
    'ABSOLUTE RULES.',
    '1. Never state a number about THIS farm that is not in the FARM DATA block — no batch codes, headcounts, stock levels, costs or revenues you cannot read there. If an action needs a figure you do not have, describe the action without it.',
    '2. Never give a drug dosage. Never give a withdrawal period: this system does not record them, and a wrong one puts contaminated produce into a food chain.',
    '3. You are not a vet. Recommend observing and recording, and calling a qualified vet where it is warranted.',
    '',
    'EVERY recommendation must set `basis` honestly:',
    '  "records"  — it follows from this farm\'s own data (low stock, an open task, a batch at a given stage).',
    '  "forecast" — it follows from the forecast above.',
    '  "general"  — seasonal or agronomic guidance, including anything you found by searching. Do NOT dress general advice up as being about this farm.',
    '',
    'Prioritise what is actionable now over what is merely interesting. Prefer fewer, better cards: 3 to 6. If the farm has nothing urgent, say so with fewer cards rather than padding.',
    '',
    'Where a good, real article or guide would genuinely help the farmer do the task better, include its URL in `sourceUrl` and its title in `sourceTitle` — but ONLY a link you actually found by searching. Never construct or guess a URL. Omit both fields rather than invent one.',
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"recommendations":[{"title":"short imperative, max 8 words","action":"what to actually do, 1-2 sentences, plain language for a phone screen","from":"YYYY-MM-DD","to":"YYYY-MM-DD","urgency":"today|soon|plan","basis":"records|forecast|general","activity":"plant|harvest|weed|irrigate|feed|health|stock|shelter|sell|other","enterprise":"one of this farm\'s enterprises, or null for whole-farm advice","why":"one sentence","sourceUrl":"https://… (omit if you did not find one)","sourceTitle":"the page title (omit with sourceUrl)"}]}',
    '',
    renderForecast(days),
    '',
    '=== FARM DATA (the only admissible source of figures about this farm) ===',
    renderContext(ctx),
    '=== END FARM DATA ===',
  ].join('\n')
}

const URGENCIES = new Set<Urgency>(['today', 'soon', 'plan'])
const BASES = new Set(['records', 'forecast', 'general'])
const ACTIVITIES = new Set<Activity>(['plant', 'harvest', 'weed', 'irrigate', 'feed', 'health', 'stock', 'shelter', 'sell', 'other'])

// Only a plain http(s) URL survives. A model asked to cite a source will
// sometimes produce a plausible-looking one it never visited, and a
// fabricated "read more" on farming advice is worse than no link at all —
// so anything that isn't an absolute http(s) URL is dropped, not repaired.
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!v) return undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return u.toString()
  } catch {
    return undefined
  }
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Defensive on purpose: a model returning something unexpected must produce
// NO cards, never half-parsed ones. A card is an instruction a farmer acts on.
export function parseAdvice(raw: string): Recommendation[] {
  let text = raw.trim()
  // Strip a code fence if the model added one despite being asked not to.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) text = fence[1].trim()
  // Tolerate leading prose by taking the outermost object.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const list = (parsed as { recommendations?: unknown })?.recommendations
  if (!Array.isArray(list)) return []

  const out: Recommendation[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const action = typeof r.action === 'string' ? r.action.trim() : ''
    const from = typeof r.from === 'string' ? r.from.trim() : ''
    const to = typeof r.to === 'string' ? r.to.trim() : ''
    const urgency = r.urgency as Urgency
    const basis = typeof r.basis === 'string' ? r.basis : ''
    if (!title || !action) continue
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) continue
    if (!URGENCIES.has(urgency) || !BASES.has(basis)) continue
    const activity = ACTIVITIES.has(r.activity as Activity) ? (r.activity as Activity) : 'other'
    const sourceUrl = safeUrl(r.sourceUrl)
    out.push({
      title: title.slice(0, 80),
      action: action.slice(0, 400),
      from,
      // A range that runs backwards is a parse failure, not a card.
      to: to >= from ? to : from,
      urgency,
      basis: basis as Recommendation['basis'],
      why: typeof r.why === 'string' ? r.why.trim().slice(0, 240) : '',
      activity,
      enterprise: typeof r.enterprise === 'string' && r.enterprise.trim() && r.enterprise !== 'null'
        ? r.enterprise.trim().toLowerCase()
        : null,
      ...(sourceUrl ? { sourceUrl, sourceTitle: typeof r.sourceTitle === 'string' ? r.sourceTitle.trim().slice(0, 120) : sourceUrl } : {}),
    })
    if (out.length >= 6) break
  }
  return out
}

export async function generateAdvice(opts: {
  tenantId: string
  farmId?: string
  farmName: string | null
  latitude: number | null
  longitude: number | null
  // What this tenant was approved to farm (tenant_enterprises, added with
  // enterprise scoping). Advising a broiler farm on its coffee is how an
  // assistant loses a farmer's attention.
  enterprises: string[]
  apiKey: string
  model: string
}): Promise<AdvicePayload | { error: string; status: number }> {
  const ctx = await buildFarmContext(opts.tenantId, opts.farmId)
  const days = opts.latitude != null && opts.longitude != null
    ? await fetchForecastDays(opts.latitude, opts.longitude)
    : []
  const today = new Date().toISOString().slice(0, 10)
  const model = opts.model.endsWith(ADVICE_MODEL_SUFFIX) ? opts.model : `${opts.model}${ADVICE_MODEL_SUFFIX}`

  const result = await callAdvisor(
    buildAdvicePrompt(ctx, days, opts.farmName, today, opts.enterprises),
    [{ role: 'user', content: 'Give me my recommendations for the next five days.' }],
    // Six cards with an action, a reason and a source URL each, from a model
    // that also spends budget on search results. 900 left this empty.
    { apiKey: opts.apiKey, model, maxTokens: 2600 },
  )
  if (!result.ok) return { error: result.error, status: result.status }

  const recommendations = parseAdvice(result.answer)
  return { recommendations, generatedAt: new Date().toISOString(), model: result.model }
}
