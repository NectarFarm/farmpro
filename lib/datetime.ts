// ── Shared date/time formatting (settings-reorg) ────────────────────────────
// Every timestamp this app stores is an ISO UTC string. Before this, every
// screen that displayed one (status-timeline.tsx, etc.) formatted it with a
// hardcoded locale/format ('en-KE', DD-first) baked into the component —
// there was no way for a tenant to say "this farm runs on EAT, and dates
// read day-first" and have that actually change what's on screen. These are
// the two functions that turn a stored instant into what a human reads,
// driven by tenant_settings.timezone / .dateFormat (db/schemas/settings.ts)
// instead of the viewer's own machine or a hardcoded locale.
//
// Deliberately NOT `server-only` — components format timestamps for display
// client-side, same reasoning as lib/money.ts.

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

// The only three orders the Settings screen offers — kept small and exact
// rather than a free-text pattern, so every value in the column is one this
// function actually knows how to render.
export const DATE_FORMATS: DateFormat[] = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']

export const DEFAULT_TIMEZONE = 'Africa/Nairobi'
export const DEFAULT_DATE_FORMAT: DateFormat = 'DD/MM/YYYY'

// Validated against the runtime's real IANA database (Node 20+, and every
// modern browser) rather than a hand-maintained list this file would own —
// that list would either be incomplete or drift from what Intl itself
// accepts. Falls back to `false` (never throws) if the runtime lacks the API
// at all, so an old/unusual JS engine fails a PATCH's validation instead of
// crashing it.
export function isValidTimezone(tz: string): boolean {
  if (typeof Intl.supportedValuesOf !== 'function') {
    // Best-effort fallback: a construction failure is still a reliable
    // signal that the zone name is bogus, even without the full list.
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz })
      return true
    } catch {
      return false
    }
  }
  return Intl.supportedValuesOf('timeZone').includes(tz)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Date-only, in the tenant's timezone and day-order — e.g. "22/08/2026".
export function formatDate(
  input: string | Date,
  opts: { timezone?: string; dateFormat?: DateFormat } = {},
): string {
  const timezone = opts.timezone || DEFAULT_TIMEZONE
  const dateFormat = opts.dateFormat || DEFAULT_DATE_FORMAT
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return '—'

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const yyyy = get('year')
  const mm = get('month')
  const dd = get('day')

  if (dateFormat === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`
  if (dateFormat === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`
  return `${dd}/${mm}/${yyyy}`
}

// Date + 24h time, in the tenant's timezone/day-order — e.g.
// "22/08/2026 14:05". Used where a full instant (not just a day) matters,
// such as an audit-log entry (components/farm/status-timeline.tsx).
export function formatDateTime(
  input: string | Date,
  opts: { timezone?: string; dateFormat?: DateFormat } = {},
): string {
  const timezone = opts.timezone || DEFAULT_TIMEZONE
  const d = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return '—'

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const min = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${formatDate(d, opts)} ${pad2(Number(hh))}:${min}`
}
