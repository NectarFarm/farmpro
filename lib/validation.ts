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
// Four accepted shapes, all of them the same Kenyan mobile number spelled
// differently: E.164 international ("+254712345678"), a bare-254 number with
// no leading "+" ("254712345678" — easy to type/paste and easy to confuse
// with E.164 if this form isn't handled explicitly), and the two local forms
// ("0712345678" / "0112345678"). Anything else that looks E.164-ish ("+" then
// 7-15 digits) is also accepted for the occasional non-Kenyan number. No
// libphonenumber; this project doesn't have it and the applicant pool is
// Kenya-first with occasional international numbers.
//
// All four Kenyan forms MUST normalize to the exact same stored string
// (toStoredPhone below) — users.phone carries a unique index and worker PIN
// sign-in resolves the login candidate by looking up that normalized value
// (see app/api/auth/login/route.ts), so a human typing "0712345678" one time
// and "+254712345678" the next must resolve to the same row, not two.
const E164_RE = /^\+\d{7,15}$/
const KENYA_LOCAL_RE = /^0[17]\d{8}$/
const KENYA_BARE_254_RE = /^254[17]\d{8}$/

export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\s\-().]/g, '')
}

export function isValidPhone(phone: string): boolean {
  return E164_RE.test(phone) || KENYA_LOCAL_RE.test(phone) || KENYA_BARE_254_RE.test(phone)
}

// Every accepted Kenyan shape is folded to the same "+254…" international
// form so the column has one consistent representation regardless of how the
// applicant typed it. Only call this on a phone that already passed
// isValidPhone.
export function toStoredPhone(phone: string): string {
  if (KENYA_LOCAL_RE.test(phone)) return `+254${phone.slice(1)}`
  if (KENYA_BARE_254_RE.test(phone)) return `+${phone}`
  return phone
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
