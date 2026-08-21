// ── parseApiResponse: field-level validation errors (issues #251/#252) ──────
// Server-side validation returns { success: false, error, fields } so a form
// can mark every offending input at once. parseApiResponse used to rebuild a
// fresh { success, error } object on the failure path, silently dropping the
// map — field errors could never reach the UI. These tests pin the map's
// survival, and pin that failures WITHOUT fields stay shaped exactly as before
// so existing callers are unaffected.
import { describe, it, expect } from 'vitest'
import { parseApiResponse } from '@/lib/request'

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('parseApiResponse field-level errors', () => {
  it('preserves the fields map on a validated 400', async () => {
    const r = await parseApiResponse(
      res({ success: false, error: 'A valid email is required', fields: { email: 'A valid email is required', phone: 'Enter a valid phone number' } }, 400)
    )
    expect(r.success).toBe(false)
    if (r.success) throw new Error('expected failure')
    expect(r.error).toBe('A valid email is required')
    expect(r.fields).toEqual({ email: 'A valid email is required', phone: 'Enter a valid phone number' })
  })

  it('omits fields entirely when the route sends none', async () => {
    const r = await parseApiResponse(res({ success: false, error: 'Forbidden' }, 403))
    if (r.success) throw new Error('expected failure')
    expect(r.error).toBe('Forbidden')
    expect(r.fields).toBeUndefined()
  })

  it('drops non-string field values rather than passing junk to the UI', async () => {
    const r = await parseApiResponse(
      res({ success: false, error: 'bad', fields: { email: 'ok', phone: 42, farmName: null, location: '' } }, 400)
    )
    if (r.success) throw new Error('expected failure')
    expect(r.fields).toEqual({ email: 'ok' })
  })

  it('omits fields when the map has no usable entries', async () => {
    const r = await parseApiResponse(res({ success: false, error: 'bad', fields: { a: 1, b: null } }, 400))
    if (r.success) throw new Error('expected failure')
    expect(r.fields).toBeUndefined()
  })

  it('ignores a non-object fields value', async () => {
    const r = await parseApiResponse(res({ success: false, error: 'bad', fields: 'nope' }, 400))
    if (r.success) throw new Error('expected failure')
    expect(r.fields).toBeUndefined()
  })

  it('still unwraps a successful envelope unchanged', async () => {
    const r = await parseApiResponse<{ id: string }>(res({ success: true, data: { id: 'abc' } }, 201))
    expect(r.success).toBe(true)
    if (!r.success) throw new Error('expected success')
    expect(r.data).toEqual({ id: 'abc' })
  })
})
