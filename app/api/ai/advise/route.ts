import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { farms } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import {
  buildFarmContext, buildSystemPrompt, callAdvisor, DEFAULT_MODEL, normalizeMessages, timeoutSignal,
} from '@/lib/ai-advisor'

// ── POST /api/ai/advise (epic #258; the backend #259 assumed already existed) ─
// Body: { messages: [{ role: 'user'|'assistant', content: string }], farmId? }
// Returns: { success: true, data: { answer, model } }
//
// Epic #258 lists this route under "Confirmed facts — Real". It was not: there
// was no app/api/ai directory on this branch and nothing referenced
// `ai/advise`, so #259's "no backend change expected" was wrong too. Built
// here to the contract those issues describe, so the UI task (#260) can be
// exactly the rewire it was scoped as.
//
// Owner/manager only, matching what #260 task 3 tells the UI to expect. A
// worker/vet/auditor gets 403 and the chat screen is meant to hide itself
// rather than let them hit it — but the gate here is what actually enforces
// it, because a hidden screen is not a permission.
//
// Not on the public allowlist in tests/api-auth-coverage.test.ts: that sweep
// walks app/api and asserts every non-public handler 401s without a session,
// which requireTenantSession below does before this route touches the body.
const ADVISOR_ROLES = ['owner', 'manager'] as const

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

export async function POST(req: Request) {
  // Parsed before the auth check ONLY to pull the optional super_admin
  // tenantId, exactly as lib/api-auth.ts's explicitTenantId contract requires
  // (and as the coverage test's "well-formed empty body" note describes).
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const body = (raw ?? {}) as Record<string, unknown>

  const auth = await requireTenantSession({
    roles: ADVISOR_ROLES,
    explicitTenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined,
  })
  if ('error' in auth) return auth.error
  const { tenantId, session } = auth

  const messages = normalizeMessages(body.messages)
  if (!messages) {
    return bad('messages must be a non-empty array of { role: "user"|"assistant", content: string }.')
  }
  if (messages[messages.length - 1].role !== 'user') {
    return bad('The last message must be from the user.')
  }

  // Read the key at request time, not module load: a missing key must produce
  // this honest 503 rather than crashing the route or, worse, silently
  // returning a plausible answer from nowhere.
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'The AI advisor is not configured on this deployment. An administrator needs to set OPENROUTER_API_KEY.',
    }, { status: 503 })
  }

  // 'ALL' is the UI's sentinel for "every farm" (see components/farm/navigation.tsx's
  // activeFarmId) — treat it as no filter rather than a farm called ALL.
  const rawFarmId = typeof body.farmId === 'string' ? body.farmId.trim() : ''
  const farmId = rawFarmId && rawFarmId !== 'ALL' ? rawFarmId : undefined

  let farmName: string | null = null
  if (farmId) {
    // Confirm the farm belongs to THIS tenant before it reaches a query or the
    // prompt — a farmId from the body is caller-supplied input.
    const rows = await db.select({ id: farms.id, name: farms.name, tenantId: farms.tenantId })
      .from(farms).where(eq(farms.id, farmId)).limit(1)
    if (!rows[0] || rows[0].tenantId !== tenantId) {
      return bad('Farm not found.', 404)
    }
    farmName = rows[0].name
  }

  let context
  try {
    context = await buildFarmContext(tenantId, farmId)
  } catch (err) {
    console.error('[ai-advise] context build failed', { tenantId, farmId, err })
    return bad('Could not read this farm\'s data to answer against. Please try again.', 500)
  }

  const result = await callAdvisor(
    buildSystemPrompt(context, farmName),
    messages,
    {
      apiKey,
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      signal: timeoutSignal(60_000),
    },
  )

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  }

  console.info('[ai-advise] answered', {
    tenantId, role: session.role, model: result.model,
    turns: messages.length, batches: context.activeBatches.length,
  })

  return NextResponse.json({ success: true, data: { answer: result.answer, model: result.model } }, { status: 200 })
}
