// ── Shared GET /api/weather response shapes (ui-polish-theme-weather) ──────
// Imported by both app/api/weather/route.ts (server) and
// components/farm/weather.tsx (client) so the two never drift — a plain
// types-only module, safe to import from client code (no 'server-only', no
// DB import).
import type { WeatherIconKey } from './weather-codes'

export type WeatherIconKeyLike = WeatherIconKey

export interface WeatherCurrent {
  temperatureC: number
  apparentTemperatureC: number
  humidityPct: number
  windKph: number
  precipitationMm: number
  isDay: boolean
  code: number
  label: string
  icon: WeatherIconKey
  rainy: boolean
}

export interface WeatherDay {
  date: string
  code: number
  label: string
  icon: WeatherIconKey
  rainy: boolean
  tempMaxC: number
  tempMinC: number
  precipitationProbabilityPct: number
  precipitationSumMm: number
}

export interface WeatherData {
  farmName: string
  // The farm's free-text location ("Nanyuki", "Nakuru, Kenya") as someone
  // typed it at signup. It is a LABEL, not the thing the forecast was fetched
  // for — see latitude/longitude below.
  location: string
  hasCoordinates: boolean
  // The coordinates this forecast is actually for, echoed back so the screen
  // can show them. Without these the header showed only the free-text
  // location, which can disagree with the pin — a farm whose GPS sits one
  // valley over from the town somebody typed reads as a forecast for the
  // wrong place, with nothing on screen to reveal it. Present only when
  // hasCoordinates is true.
  latitude?: number
  longitude?: number
  current?: WeatherCurrent
  daily?: WeatherDay[]
  updatedAt?: string
}
