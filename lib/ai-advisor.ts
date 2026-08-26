// ── AI farm advisor: real tenant context + OpenRouter call (issue #258) ─────
// Epic #258 states as a "confirmed fact" that `POST /api/ai/advise` already
// exists and "already does everything this screen needs — this is close to a
// pure rewire". That is not true of this branch: there was no app/api/ai
// directory at all, and nothing anywhere referenced `ai/advise`. #259's "no
// backend change expected" is wrong for the same reason. This module and the
// route beside it are that missing backend, built from scratch.
//
// Why a context builder rather than tool-calling: the failure mode this
// endpoint exists to prevent is the one components/farm/ai-chat.tsx shipped
// with — an assistant that cites `BRO-KMU-022`, an FCR of 1.82 and KSh
// 177,000 of profit for a tenant where none of those exist. A farmer who
// checks one fabricated number against reality distrusts every real number
// in the app. So the model never gets to choose what data it sees: we gather
// a bounded, tenant-scoped snapshot up front, put it in the system prompt as
// the ONLY admissible source of figures, and instruct it to say it doesn't
// know rather than fill a gap. Cheaper and far more predictable than letting
// it query, and there is no path by which it can reach another tenant's row.
import 'server-only'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  batches, employees, inventoryItems, inventoryLots, productionUnits, records, tasks,
} from '@/db/schemas'
import { batchIdsForFarm } from '@/lib/farm-scope'

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Mirrors the contract epic #258 documents for the UI to code against:
// { messages: [{ role, content }] }, last 10, each truncated to 2000 chars.
export const MAX_MESSAGES = 10
export const MAX_CONTENT_CHARS = 2000

export type ChatRole = 'user' | 'assistant'
export type ChatMessage = { role: ChatRole; content: string }

export function isChatRole(v: unknown): v is ChatRole {
  return v === 'user' || v === 'assistant'
}

// Trim to the contract's bounds. Keeps the LAST 10 (the tail is the live
// conversation; the head is the part safe to forget) and truncates each
// message, so a pasted wall of text can't blow the context window or the bill.
export function normalizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null
  const out: ChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown; content?: unknown }
    if (!isChatRole(role) || typeof content !== 'string') return null
    const text = content.trim()
    if (text === '') continue
    out.push({ role, content: text.slice(0, MAX_CONTENT_CHARS) })
  }
  if (out.length === 0) return null
  return out.slice(-MAX_MESSAGES)
}

export interface FarmContext {
  farmScope: string
  activeBatches: { code: string; species: string; stage: string; current: number; initial: number }[]
  deaths30d: { code: string; deaths: number }[]
  production30d: { product: string; qty: number; unit: string }[]
  lowStock: { name: string; onHand: number; unit: string; threshold: number }[]
  openTasks: { title: string; status: string; dueAt: string | null }[]
  overdueTaskCount: number
  workerCount: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const ADVISOR_TIMEOUT_MS = 60_000 // 60s: AI calls can be slow; bound them.

/** Creates an AbortSignal that auto-fires after `ms` milliseconds. */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

// Everything here is scoped by tenantId (and optionally farmId) at the query
// level — there is no code path that widens it. `farmId` follows the same
// batches -> production_units -> farms chain the reports and KPI routes use,
// via the shared batchIdsForFarm helper rather than a second copy of it.
export async function buildFarmContext(tenantId: string, farmId?: string): Promise<FarmContext> {
  const since = new Date(Date.now() - 30 * DAY_MS)
  const scopedBatchIds = farmId ? await batchIdsForFarm(tenantId, farmId) : null
  // An empty scope must match NOTHING, not everything — inArray([]) is unsafe
  // shorthand for that, so use a sentinel the way lib/reports.ts already does.
  const batchScope = scopedBatchIds ? (scopedBatchIds.length ? scopedBatchIds : ['__none__']) : null

  const batchRows = await db
    .select({
      id: batches.id, code: batches.code, species: batches.species,
      stage: batches.stage, current: batches.currentQty, initial: batches.initialQty,
    })
    .from(batches)
    .innerJoin(productionUnits, eq(productionUnits.id, batches.unitId))
    .where(and(
      eq(batches.tenantId, tenantId),
      eq(batches.status, 'ACTIVE'),
      ...(farmId ? [eq(productionUnits.farmId, farmId)] : []),
    ))
    .orderBy(desc(batches.startDate))
    .limit(40)

  const codeById = new Map(batchRows.map((b) => [b.id, b.code]))

  // Mortality and production both live in `records`, keyed by `type` — the
  // same table and the same shape the mortality/production reports read, so
  // the advisor cannot disagree with a report the user exports.
  const recordRows = await db
    .select({ type: records.type, batchId: records.batchId, data: records.data })
    .from(records)
    .where(and(
      eq(records.tenantId, tenantId),
      inArray(records.type, ['mortality', 'production']),
      gte(records.createdAt, since),
      ...(batchScope ? [inArray(records.batchId, batchScope)] : []),
    ))
    .limit(1000)

  const deathsByBatch = new Map<string, number>()
  const producedByProduct = new Map<string, { qty: number; unit: string }>()
  for (const r of recordRows) {
    const data = (r.data ?? {}) as Record<string, unknown>
    if (r.type === 'mortality') {
      const n = Number(data.count ?? data.deaths ?? 0)
      if (Number.isFinite(n) && n > 0) {
        const code = codeById.get(r.batchId) ?? r.batchId
        deathsByBatch.set(code, (deathsByBatch.get(code) ?? 0) + n)
      }
    } else {
      const items = Array.isArray(data.items) ? data.items : []
      for (const line of items) {
        if (!line || typeof line !== 'object') continue
        const { productName, productId, qty, unit } = line as Record<string, unknown>
        const name = typeof productName === 'string' && productName ? productName : String(productId ?? 'Product')
        const n = Number(qty)
        if (!Number.isFinite(n) || n <= 0) continue
        const prev = producedByProduct.get(name)
        producedByProduct.set(name, { qty: (prev?.qty ?? 0) + n, unit: prev?.unit ?? (typeof unit === 'string' ? unit : '') })
      }
    }
  }

  // Low stock: lots summed per catalogue item, compared to the item's own
  // threshold. Lots carry the farm relationship, not the item (see
  // db/schemas/inventory.ts) — so the farm filter belongs on the lot.
  const stockRows = await db
    .select({
      name: inventoryItems.name, unit: inventoryItems.unit,
      threshold: inventoryItems.lowStockThreshold,
      onHand: sql<number>`coalesce(sum(${inventoryLots.qtyOnHand}), 0)`,
    })
    .from(inventoryItems)
    .leftJoin(inventoryLots, and(
      eq(inventoryLots.itemId, inventoryItems.id),
      ...(farmId ? [eq(inventoryLots.farmId, farmId)] : []),
    ))
    .where(eq(inventoryItems.tenantId, tenantId))
    .groupBy(inventoryItems.id, inventoryItems.name, inventoryItems.unit, inventoryItems.lowStockThreshold)
    .limit(200)

  const lowStock = stockRows
    .filter((s) => s.threshold > 0 && Number(s.onHand) <= s.threshold)
    .map((s) => ({ name: s.name, onHand: Number(s.onHand), unit: s.unit, threshold: s.threshold }))
    .slice(0, 15)

  const taskRows = await db
    .select({ title: tasks.title, status: tasks.status, dueAt: tasks.dueAt })
    .from(tasks)
    .where(and(
      eq(tasks.tenantId, tenantId),
      inArray(tasks.status, ['PENDING', 'IN_PROGRESS']),
      ...(farmId ? [eq(tasks.farmId, farmId)] : []),
    ))
    .orderBy(tasks.dueAt)
    .limit(25)

  const now = Date.now()
  const workerRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), ...(farmId ? [eq(employees.farmId, farmId)] : [])))

  return {
    farmScope: farmId ? 'the selected farm only' : 'all farms in this account',
    activeBatches: batchRows.map((b) => ({
      code: b.code, species: b.species || '—', stage: b.stage || '—',
      current: b.current, initial: b.initial,
    })),
    deaths30d: [...deathsByBatch.entries()].map(([code, deaths]) => ({ code, deaths })),
    production30d: [...producedByProduct.entries()].map(([product, v]) => ({ product, qty: v.qty, unit: v.unit })),
    lowStock,
    openTasks: taskRows.map((t) => ({
      title: t.title, status: t.status,
      dueAt: t.dueAt ? t.dueAt.toISOString().slice(0, 10) : null,
    })),
    overdueTaskCount: taskRows.filter((t) => t.dueAt && t.dueAt.getTime() < now).length,
    workerCount: Number(workerRows[0]?.n ?? 0),
  }
}

// The context is rendered as terse labelled lines rather than raw JSON: it
// costs fewer tokens, and an empty section reads as an explicit "none on
// record" instead of `[]`, which is what stops the model treating absence as
// an invitation to guess.
export function renderContext(ctx: FarmContext): string {
  const section = (title: string, lines: string[]) =>
    `${title}:\n${lines.length ? lines.map((l) => `  - ${l}`).join('\n') : '  (none on record)'}`

  return [
    `Data scope: ${ctx.farmScope}. Figures below cover the last 30 days unless stated.`,
    section('Active batches', ctx.activeBatches.map((b) =>
      `${b.code} — ${b.species}, stage ${b.stage}, ${b.current} of ${b.initial} head remaining`)),
    section('Deaths recorded (last 30d)', ctx.deaths30d.map((d) => `${d.code}: ${d.deaths}`)),
    section('Production recorded (last 30d)', ctx.production30d.map((p) =>
      `${p.product}: ${p.qty}${p.unit ? ` ${p.unit}` : ''}`)),
    section('Stock at or below its low-stock threshold', ctx.lowStock.map((s) =>
      `${s.name}: ${s.onHand} ${s.unit} on hand (threshold ${s.threshold})`)),
    section('Open tasks', ctx.openTasks.map((t) =>
      `${t.title} [${t.status}]${t.dueAt ? ` due ${t.dueAt}` : ''}`)),
    `Overdue open tasks: ${ctx.overdueTaskCount}`,
    `Employees on record: ${ctx.workerCount}`,
  ].join('\n\n')
}

export function buildSystemPrompt(ctx: FarmContext, farmName: string | null): string {
  return [
    `You are the farm advisor built into IFMS, an integrated farm-management app used by smallholder and mid-size farms in Kenya. You are speaking to the owner or manager of ${farmName ? `"${farmName}"` : 'this farm'}.`,
    '',
    'ABSOLUTE RULE ON FIGURES. The FARM DATA block below is the only source of facts about this farm. Never state a batch code, headcount, mortality figure, feed quantity, stock level, price, cost, revenue, profit or FCR that is not derivable from it. If the answer needs a number that is not there, say plainly which record type the farm is not capturing yet and what they would need to start recording to get it. An invented figure is worse than no answer: this app is the farm\'s system of record, and one number the owner can disprove costs them their trust in every real number in it.',
    '',
    'Say "I don\'t have that recorded" rather than estimating, extrapolating, or reasoning from typical industry values. Do not present a general benchmark as if it were this farm\'s figure. You may cite a general agronomic or veterinary benchmark for comparison, but label it as a general benchmark, not as their data.',
    '',
    'You are not a vet. For a suspected disease, describe what to observe and record, and recommend a qualified vet where the situation warrants it. Never give a drug dosage, and never suggest a withdrawal period — this app does not track withdrawal windows, so a number here could put contaminated product into a food chain.',
    '',
    'Style: answer the question first, in plain language a busy farmer reads on a phone between jobs. Short paragraphs or a few bullets, no headings, under 200 words unless genuinely asked for detail. Amounts in KSh. Metric units. No emoji.',
    '',
    '=== FARM DATA (the only admissible source of figures) ===',
    renderContext(ctx),
    '=== END FARM DATA ===',
  ].join('\n')
}

export type AdviseResult =
  | { ok: true; answer: string; model: string }
  | { ok: false; status: number; error: string }

// Non-streaming on purpose: the UI contract epic #258 documents is a single
// `{ answer }` string, and a farm phone on a weak connection is better served
// by one small response than by a stream that stalls half-rendered.
export async function callAdvisor(
  system: string,
  messages: ChatMessage[],
  opts: { apiKey: string; model?: string; signal?: AbortSignal } = { apiKey: '' },
): Promise<AdviseResult> {
  const model = opts.model || DEFAULT_MODEL
  let res: Response
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter attribution headers — optional, and deliberately not the
        // farm's own domain: nothing tenant-identifying leaves this app.
        'HTTP-Referer': 'https://ifms.app',
        'X-Title': 'IFMS Farm Advisor',
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        temperature: 0.3,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal: opts.signal,
    })
  } catch (err) {
    // Network-level failure. The key must never appear in a log line.
    console.error('[ai-advise] upstream request failed', { model, err: err instanceof Error ? err.message : 'unknown' })
    return { ok: false, status: 502, error: 'The advisor is unreachable right now. Please try again shortly.' }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[ai-advise] upstream error', { model, status: res.status, detail: detail.slice(0, 400) })
    // Upstream auth/credit problems are OUR misconfiguration, not the
    // caller's — never pass a 401/402 through as if the user were unauthorized.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 503, error: 'The advisor is not configured correctly. Ask an administrator to check the AI credentials.' }
    }
    if (res.status === 402) {
      return { ok: false, status: 503, error: 'The advisor has run out of credit. Ask an administrator to top up the AI account.' }
    }
    if (res.status === 429) {
      return { ok: false, status: 429, error: 'The advisor is busy. Please wait a moment and ask again.' }
    }
    return { ok: false, status: 502, error: 'The advisor could not answer that. Please try again.' }
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return { ok: false, status: 502, error: 'The advisor returned an unreadable response.' }
  }

  const answer = (payload as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0]?.message?.content
  if (typeof answer !== 'string' || answer.trim() === '') {
    console.error('[ai-advise] empty completion', { model })
    return { ok: false, status: 502, error: 'The advisor returned an empty answer. Please try again.' }
  }
  return { ok: true, answer: answer.trim(), model }
}
