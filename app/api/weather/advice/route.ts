import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { farms, weatherAdvice } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { tenantEnterpriseList } from '@/lib/enterprises'
import { ADVICE_TTL_MS, generateAdvice, type Recommendation } from '@/lib/farm-advice'
import { DEFAULT_MODEL } from '@/lib/ai-advisor'

// ── GET /api/weather/advice?farmId=&refresh= ───────────────────────────────
// The recommendation cards on the weather screen. Cached in `weather_advice`
// and regenerated only when older than ADVICE_TTL_MS (6h) or when the caller
// asks for a refresh.
//
// The cache is the point, not an optimisation: each generation is a paid AI
// call WITH web search. Regenerating per page view would mean a farmer
// checking the weather five times before breakfast costs five searches. The
// response always says when the cards were made, so "these are from this
// morning" is visible rather than implied.
//
// Owner/manager only, matching the AI advisor — these cards read the farm's
// batches, stock and open work.
const ADVICE_ROLES = ['owner', 'manager'] as const

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({
    roles: ADVICE_ROLES,
    explicitTenantId: url.searchParams.get('tenantId') ?? undefined,
  })
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  // 'ALL' is the switcher's sentinel for the aggregate view, not a farm id.
  const rawFarmId = url.searchParams.get('farmId')?.trim() ?? ''
  const farmId = rawFarmId && rawFarmId !== 'ALL' ? rawFarmId : null
  const forceRefresh = url.searchParams.get('refresh') === 'true'

  let farmName: string | null = null
  let latitude: number | null = null
  let longitude: number | null = null
  if (farmId) {
    const rows = await db.select().from(farms)
      .where(and(eq(farms.id, farmId), eq(farms.tenantId, tenantId))).limit(1)
    if (!rows[0]) return NextResponse.json({ success: false, error: 'Farm not found' }, { status: 404 })
    farmName = rows[0].name
    latitude = rows[0].latitude
    longitude = rows[0].longitude
  } else {
    // Aggregate view: use the tenant's first farm that actually has a pin, so
    // the forecast half of the advice still means something instead of being
    // silently dropped.
    const rows = await db.select().from(farms).where(eq(farms.tenantId, tenantId))
    const pinned = rows.find((f) => f.latitude !== null && f.longitude !== null)
    farmName = pinned?.name ?? rows[0]?.name ?? null
    latitude = pinned?.latitude ?? null
    longitude = pinned?.longitude ?? null
  }

  const where = farmId
    ? and(eq(weatherAdvice.tenantId, tenantId), eq(weatherAdvice.farmId, farmId))
    : and(eq(weatherAdvice.tenantId, tenantId), isNull(weatherAdvice.farmId))
  const cachedRows = await db.select().from(weatherAdvice).where(where).limit(1)
  const cached = cachedRows[0]
  const ageMs = cached ? Date.now() - cached.generatedAt.getTime() : Infinity

  if (cached && !forceRefresh && ageMs < ADVICE_TTL_MS) {
    return NextResponse.json({
      success: true,
      data: {
        recommendations: cached.payload as Recommendation[],
        generatedAt: cached.generatedAt.toISOString(),
        model: cached.model,
        fromCache: true,
      },
    }, { status: 200 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    // Serve whatever is cached rather than nothing — stale advice with its
    // date shown beats an empty screen — but never pretend it is fresh.
    if (cached) {
      return NextResponse.json({
        success: true,
        data: {
          recommendations: cached.payload as Recommendation[],
          generatedAt: cached.generatedAt.toISOString(),
          model: cached.model,
          fromCache: true,
          stale: true,
        },
      }, { status: 200 })
    }
    return NextResponse.json({
      success: false,
      error: 'Recommendations are not configured on this deployment. An administrator needs to set OPENROUTER_API_KEY.',
    }, { status: 503 })
  }

  const enterprises = (await tenantEnterpriseList(tenantId)).map((e) => e.enterprise)

  const result = await generateAdvice({
    tenantId,
    farmId: farmId ?? undefined,
    farmName,
    latitude,
    longitude,
    enterprises,
    apiKey,
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  })

  if ('error' in result) {
    // A generation failure must not blank the screen if we already have cards.
    if (cached) {
      return NextResponse.json({
        success: true,
        data: {
          recommendations: cached.payload as Recommendation[],
          generatedAt: cached.generatedAt.toISOString(),
          model: cached.model,
          fromCache: true,
          stale: true,
        },
      }, { status: 200 })
    }
    return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  }

  // Only cache a generation that actually produced cards. Caching an empty
  // parse would freeze the screen blank for six hours over one bad reply.
  if (result.recommendations.length > 0) {
    const values = {
      tenantId,
      farmId,
      payload: result.recommendations as unknown[],
      model: result.model,
      generatedAt: new Date(result.generatedAt),
    }
    if (cached) {
      await db.update(weatherAdvice).set(values).where(eq(weatherAdvice.id, cached.id))
    } else {
      await db.insert(weatherAdvice).values({ id: randomUUID(), ...values })
    }
  }

  return NextResponse.json({ success: true, data: { ...result, fromCache: false } }, { status: 200 })
}
