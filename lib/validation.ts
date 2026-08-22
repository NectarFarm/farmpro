// ── Shared field validators (issues #251/#252) ──────────────────────────────
// Small, dependency-free, pure functions used by app/api/onboard-requests'
// POST and PATCH handlers. This project has no zod/yup — validation is
// hand-rolled in the routes; these are the pieces worth sharing so both
// routes (public POST, admin PATCH) enforce the exact same rules instead of
// two regexes drifting apart over time.

/* ── email ── */

// No nested/overlapping quantifiers over the same character class, so this
// can't backtrack catastrophically. Requires: no whitespace, exactly one "@"
// with a non-empty local part, and a domain containing a literal dot.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function isValidEmail(email: string): boolean {
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email)
}

/* ── phone ── */
// Two accepted shapes: E.164 international ("+" then 7-15 digits) or a local
// Kenyan mobile number (10 digits starting 07 or 01 — "07XXXXXXXX" /
// "01XXXXXXXX"). No libphonenumber; this project doesn't have it and the
// applicant pool is Kenya-first with occasional international numbers.
const E164_RE = /^\+\d{7,15}$/
const KENYA_LOCAL_RE = /^0[17]\d{8}$/

export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\s\-().]/g, '')
}

export function isValidPhone(phone: string): boolean {
  return E164_RE.test(phone) || KENYA_LOCAL_RE.test(phone)
}

// Local Kenyan numbers are stored normalized to +254 so the column has one
// consistent international shape regardless of how the applicant typed it.
// Only call this on a phone that already passed isValidPhone.
export function toStoredPhone(phone: string): string {
  return KENYA_LOCAL_RE.test(phone) ? `+254${phone.slice(1)}` : phone
}

/* ── GPS coordinates ── */
// The RegisterScreen form sends these as strings; the admin LocationEditor
// may send real numbers. Accept either; anything else (or a non-finite
// result, e.g. "abc" or Infinity) is treated as absent/invalid.
export function parseCoordinate(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/* ── address + coordinates, composed ── */
// Shared by POST (applicant-supplied) and PATCH (admin-supplied) so the
// all-or-nothing coordinate rule and range checks can't drift between the
// two call sites.

export interface LocationInput {
  address?: unknown
  latitude?: unknown
  longitude?: unknown
}

export interface LocationResult {
  address: string | null
  latitude: number | null
  longitude: number | null
  fields: Record<string, string>
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== ''
}

export function validateLocation(input: LocationInput): LocationResult {
  const fields: Record<string, string> = {}

  let address: string | null = null
  if (hasValue(input.address)) {
    const trimmed = typeof input.address === 'string' ? input.address.trim() : ''
    if (!trimmed) {
      fields.address = 'address must be a non-empty string'
    } else if (trimmed.length > 300) {
      fields.address = 'address must be at most 300 characters'
    } else {
      address = trimmed
    }
  }

  const latProvided = hasValue(input.latitude)
  const lngProvided = hasValue(input.longitude)

  let latitude: number | null = null
  let longitude: number | null = null

  if (latProvided) {
    const n = parseCoordinate(input.latitude)
    if (n === null || n < -90 || n > 90) {
      fields.latitude = 'latitude must be a number between -90 and 90'
    } else {
      latitude = n
    }
  }
  if (lngProvided) {
    const n = parseCoordinate(input.longitude)
    if (n === null || n < -180 || n > 180) {
      fields.longitude = 'longitude must be a number between -180 and 180'
    } else {
      longitude = n
    }
  }

  // GPS is all-or-nothing: a lone coordinate is worse than none (issue #252).
  if (latProvided && !lngProvided) {
    fields.longitude = 'longitude is required when latitude is provided'
  } else if (lngProvided && !latProvided) {
    fields.latitude = 'latitude is required when longitude is provided'
  }

  return { address, latitude, longitude, fields }
}
