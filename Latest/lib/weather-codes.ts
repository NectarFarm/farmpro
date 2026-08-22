// ── Open-Meteo WMO weather-code mapping (ui-polish-theme-weather) ──────────
// Open-Meteo returns a bare WMO "weather code" integer, not a description —
// this is the one place that turns it into something a farmer reads at a
// glance: a short label, an icon key components/farm/weather.tsx maps onto a
// real icon, and whether it counts as "rain" for the one thing a farmer
// actually plans around (issue brief: "rain expectation matters more than a
// pretty icon"). Pure and table-driven so it's testable without a network
// call or a component render.
export type WeatherIconKey = 'sun' | 'cloud-sun' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export interface WeatherCodeInfo {
  label: string
  icon: WeatherIconKey
  // True for anything a farmer should plan around getting wet from —
  // drizzle, rain, rain showers and thunderstorms. False for fog/snow (a
  // real condition, just not "rain") and clear/cloudy.
  rainy: boolean
}

const CODES: Record<number, WeatherCodeInfo> = {
  0: { label: 'Clear sky', icon: 'sun', rainy: false },
  1: { label: 'Mainly clear', icon: 'sun', rainy: false },
  2: { label: 'Partly cloudy', icon: 'cloud-sun', rainy: false },
  3: { label: 'Overcast', icon: 'cloud', rainy: false },
  45: { label: 'Fog', icon: 'fog', rainy: false },
  48: { label: 'Depositing rime fog', icon: 'fog', rainy: false },
  51: { label: 'Light drizzle', icon: 'rain', rainy: true },
  53: { label: 'Moderate drizzle', icon: 'rain', rainy: true },
  55: { label: 'Dense drizzle', icon: 'rain', rainy: true },
  56: { label: 'Light freezing drizzle', icon: 'rain', rainy: true },
  57: { label: 'Dense freezing drizzle', icon: 'rain', rainy: true },
  61: { label: 'Slight rain', icon: 'rain', rainy: true },
  63: { label: 'Moderate rain', icon: 'rain', rainy: true },
  65: { label: 'Heavy rain', icon: 'rain', rainy: true },
  66: { label: 'Light freezing rain', icon: 'rain', rainy: true },
  67: { label: 'Heavy freezing rain', icon: 'rain', rainy: true },
  71: { label: 'Slight snow fall', icon: 'snow', rainy: false },
  73: { label: 'Moderate snow fall', icon: 'snow', rainy: false },
  75: { label: 'Heavy snow fall', icon: 'snow', rainy: false },
  77: { label: 'Snow grains', icon: 'snow', rainy: false },
  80: { label: 'Slight rain showers', icon: 'rain', rainy: true },
  81: { label: 'Moderate rain showers', icon: 'rain', rainy: true },
  82: { label: 'Violent rain showers', icon: 'rain', rainy: true },
  85: { label: 'Slight snow showers', icon: 'snow', rainy: false },
  86: { label: 'Heavy snow showers', icon: 'snow', rainy: false },
  95: { label: 'Thunderstorm', icon: 'storm', rainy: true },
  96: { label: 'Thunderstorm with slight hail', icon: 'storm', rainy: true },
  99: { label: 'Thunderstorm with heavy hail', icon: 'storm', rainy: true },
}

const UNKNOWN: WeatherCodeInfo = { label: 'Unknown', icon: 'cloud', rainy: false }

export function describeWeatherCode(code: number): WeatherCodeInfo {
  return CODES[code] ?? UNKNOWN
}
