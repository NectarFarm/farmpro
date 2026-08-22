// ── Session cookie `Secure` flag (regression) ───────────────────────────────
// The flag used to be `NODE_ENV === 'production'`. The Docker runner stage sets
// NODE_ENV=production, so running that image over plain HTTP — `make up`, or a
// LAN IP from a phone — stamped Secure on the cookie. Browsers refuse to store
// a Secure cookie delivered over http://, so login returned 200, the browser
// dropped the cookie, and the next request was anonymous: a super_admin who had
// just signed in got "Unauthorized" from the admin queue.
//
// It is now derived from how the request actually arrived. These tests pin both
// directions: a real HTTPS deployment must still get Secure, and a plain-HTTP
// local run must not lock itself out.
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { isSecureRequest } from '@/lib/auth'

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

describe('isSecureRequest', () => {
  it('is false for a plain-HTTP request (the make-up / LAN-phone case)', () => {
    expect(isSecureRequest(req('http://localhost:13001/api/auth/login'))).toBe(false)
    expect(isSecureRequest(req('http://192.168.100.14:13001/api/auth/login'))).toBe(false)
  })

  it('is true for a direct HTTPS request', () => {
    expect(isSecureRequest(req('https://ifms.example.com/api/auth/login'))).toBe(true)
  })

  it('trusts x-forwarded-proto from a TLS-terminating proxy', () => {
    expect(isSecureRequest(req('http://internal:13001/api/auth/login', { 'x-forwarded-proto': 'https' }))).toBe(true)
    expect(isSecureRequest(req('https://internal/api/auth/login', { 'x-forwarded-proto': 'http' }))).toBe(false)
  })

  it('reads only the first entry of a comma-separated forwarded chain', () => {
    expect(isSecureRequest(req('http://internal/api/auth/login', { 'x-forwarded-proto': 'https, http' }))).toBe(true)
    expect(isSecureRequest(req('http://internal/api/auth/login', { 'x-forwarded-proto': 'http, https' }))).toBe(false)
  })

  it('is case-insensitive about the forwarded scheme', () => {
    expect(isSecureRequest(req('http://internal/api/auth/login', { 'x-forwarded-proto': 'HTTPS' }))).toBe(true)
  })

  it('falls back to NODE_ENV when there is no request to inspect', () => {
    // vi.stubEnv restores the original on unstubAllEnvs, so no manual
    // save/restore — and NODE_ENV is a read-only property to TypeScript.
    try {
      vi.stubEnv('NODE_ENV', 'production')
      expect(isSecureRequest(undefined)).toBe(true)
      vi.stubEnv('NODE_ENV', 'development')
      expect(isSecureRequest(undefined)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
