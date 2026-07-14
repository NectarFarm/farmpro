// Kenyan phone number normalization — shared between client and server (no
// 'server-only' marker). Numbers were previously stored exactly as typed with
// no normalization, and login compared with exact-string equality, so an
// account created with "0712345678" could only ever log in with that exact
// string — "254712345678" or "+254712345678" for the SAME number would fail.
//
// Only handles Kenyan MSISDNs (07.../01... local, 2547.../2541... national,
// +254 international) since that's the only format seen in this app's data.
// A number that isn't recognized falls through untouched at call sites (see
// callers' `?? input.trim()` fallback) rather than being rejected — this
// stays permissive for non-Kenyan test/demo data instead of hard-failing it.

const KE_LOCAL = /^0([17]\d{8})$/; // 07XXXXXXXX / 01XXXXXXXX
const KE_NATIONAL = /^254([17]\d{8})$/; // 254 7XXXXXXXX / 254 1XXXXXXXX
const KE_INTERNATIONAL = /^\+254([17]\d{8})$/; // +254 7XXXXXXXX / +254 1XXXXXXXX

/** Canonical form: "2547XXXXXXXX" / "2541XXXXXXXX", no "+". Null if unrecognized. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s-]/g, '');
  const m = s.match(KE_LOCAL) ?? s.match(KE_NATIONAL) ?? s.match(KE_INTERNATIONAL);
  return m ? `254${m[1]}` : null;
}

/**
 * Every format a human might have typed or a record might already have
 * stored for the same number — used for backward-compatible DB lookups
 * (`inArray(users.phone, phoneLookupVariants(input))`) so login and duplicate
 * checks match regardless of which format an existing row was saved in.
 * Always includes the raw trimmed input, so an unrecognized (non-Kenyan)
 * number still matches itself exactly, same as before this fix.
 */
export function phoneLookupVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const canonical = normalizePhone(trimmed);
  if (!canonical) return [trimmed];
  const local = `0${canonical.slice(3)}`;
  return [...new Set([trimmed, canonical, `+${canonical}`, local])];
}
