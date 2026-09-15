// ── One definition of the forecast request ─────────────────────────────────
// Both GET /api/weather (the screen) and GET /api/weather/advice (the AI
// recommendations) need the same forecast for the same farm. Sharing the URL
// builder is not just DRY: Next's fetch cache keys on the full URL, so an
// identical query string means the advice route reuses the entry the weather
// route already populated instead of making a second upstream call for data
// it is about to be handed anyway.
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

// Forecasts don't need to be real-time; 10 minutes keeps this well under
// Open-Meteo's fair-use expectations without ever showing stale-by-hours data.
export const CACHE_REVALIDATE_SECONDS = 600
export const FETCH_TIMEOUT_MS = 8000

export function forecastParams(latitude: number, longitude: number): URLSearchParams {
  return new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    timezone: 'auto',
    forecast_days: '5',
  })
}
