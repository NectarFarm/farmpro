import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { farms } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'
import { describeWeatherCode } from '@/lib/weather-codes'
import type { WeatherCurrent, WeatherDay, WeatherData } from '@/lib/weather-types'

// ── GET /api/weather (ui-polish-theme-weather) ──────────────────────────────
// components/farm/weather.tsx used to make zero network calls and honestly
// render "No weather provider is connected". This is that provider:
// Open-Meteo (https://open-meteo.com) — free, keyless, no signup, no
// attribution requirement, which matters because the user has no API key to
// give this app.
//
// Fetched server-side (not from the browser) so the app keeps ONE auth story
// — the client never talks to a third-party host directly — and so this
// route can cache the upstream response (Next's fetch cache, keyed by the
// full URL including lat/lon, `revalidate: 600`) instead of hitting
// Open-Meteo on every screen open.
//
// Coordinates come from `farms.latitude/longitude`, NOT the tenant or a
// default — onboarding captures a GPS pin on the onboard_requests row, but
// provisionTenant never carried it onto the farm it creates, so most
// existing farms have neither. A farm with no pin gets an honest
// `hasCoordinates: false` (not an error, not a fake location) so the screen
// can render its own empty state and offer a way to set one via
// PATCH /api/farms/[id].
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 8000
const CACHE_REVALIDATE_SECONDS = 600

export async function GET(req: Request) {
  const url = new URL(req.url)
  const auth = await requireTenantSession()
  if ('error' in auth) return auth.error
  const { tenantId } = auth

  const farmId = url.searchParams.get('farmId')?.trim()
  if (!farmId || farmId === 'ALL') {
    return NextResponse.json({ success: false, error: 'farmId is required' }, { status: 400 })
  }

  const rows = await db
    .select()
    .from(farms)
    .where(and(eq(farms.id, farmId), eq(farms.tenantId, tenantId)))
    .limit(1)
  const farm = rows[0]
  if (!farm) {
    return NextResponse.json({ success: false, error: 'Farm not found for this tenant' }, { status: 404 })
  }

  if (farm.latitude === null || farm.longitude === null) {
    const data: WeatherData = { farmName: farm.name, location: farm.location, hasCoordinates: false }
    return NextResponse.json({ success: true, data }, { status: 200 })
  }

  const params = new URLSearchParams({
    latitude: String(farm.latitude),
    longitude: String(farm.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    timezone: 'auto',
    forecast_days: '5',
  })

  let upstream: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      upstream = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
        signal: controller.signal,
        // Next's fetch cache — one entry per distinct lat/lon (query string
        // is part of the cache key), so farms sharing a location share a
        // cache entry too. Forecasts don't need to be real-time: 10 minutes
        // keeps this well under Open-Meteo's fair-use expectations without
        // ever showing stale-by-hours data.
        next: { revalidate: CACHE_REVALIDATE_SECONDS },
      })
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    // Open-Meteo unreachable/timed out — this must not break the screen.
    // A clear, honest failure the client already knows how to render
    // (apiClient's error path), not a 500 with a stack trace.
    return NextResponse.json(
      { success: false, error: 'Weather service is temporarily unavailable. Try again shortly.' },
      { status: 502 }
    )
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { success: false, error: 'Weather service is temporarily unavailable. Try again shortly.' },
      { status: 502 }
    )
  }

  let payload: OpenMeteoResponse
  try {
    payload = (await upstream.json()) as OpenMeteoResponse
  } catch {
    return NextResponse.json(
      { success: false, error: 'Weather service returned an unreadable response.' },
      { status: 502 }
    )
  }

  if (!payload.current || !payload.daily) {
    return NextResponse.json(
      { success: false, error: 'Weather service returned incomplete data.' },
      { status: 502 }
    )
  }

  const currentInfo = describeWeatherCode(payload.current.weather_code)
  const current: WeatherCurrent = {
    temperatureC: payload.current.temperature_2m,
    apparentTemperatureC: payload.current.apparent_temperature,
    humidityPct: payload.current.relative_humidity_2m,
    windKph: payload.current.wind_speed_10m,
    precipitationMm: payload.current.precipitation,
    isDay: payload.current.is_day === 1,
    code: payload.current.weather_code,
    label: currentInfo.label,
    icon: currentInfo.icon,
    rainy: currentInfo.rainy,
  }

  const dailyPayload = payload.daily
  const daily: WeatherDay[] = dailyPayload.time.map((date, i) => {
    const info = describeWeatherCode(dailyPayload.weather_code[i])
    return {
      date,
      code: dailyPayload.weather_code[i],
      label: info.label,
      icon: info.icon,
      rainy: info.rainy,
      tempMaxC: dailyPayload.temperature_2m_max[i],
      tempMinC: dailyPayload.temperature_2m_min[i],
      precipitationProbabilityPct: dailyPayload.precipitation_probability_max[i] ?? 0,
      precipitationSumMm: dailyPayload.precipitation_sum[i] ?? 0,
    }
  })

  const data: WeatherData = {
    farmName: farm.name,
    location: farm.location,
    hasCoordinates: true,
    current,
    daily,
    updatedAt: new Date().toISOString(),
  }
  return NextResponse.json({ success: true, data }, { status: 200 })
}

// Shape of the subset of Open-Meteo's response this route reads. Open-Meteo
// returns considerably more (hourly, units, etc.) — untyped/ignored here.
interface OpenMeteoResponse {
  current?: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    precipitation: number
    weather_code: number
    is_day: number
    wind_speed_10m: number
  }
  daily?: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
    precipitation_sum: number[]
  }
}
