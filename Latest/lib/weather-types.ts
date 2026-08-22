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
  location: string
  hasCoordinates: boolean
  current?: WeatherCurrent
  daily?: WeatherDay[]
  updatedAt?: string
}
