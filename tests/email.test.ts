// ── lib/email.ts (feat/email-notifications) ─────────────────────────────────
// Unit tests against the real sendEmail/composeMessage functions, with the
// provider stubbed at the `fetch` boundary — never a real network call, per
// this task's own instruction. No DB needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('lib/email.ts', () => {
  const originalApiKey = process.env.RESEND_API_KEY
  const originalFrom = process.env.EMAIL_FROM
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalApiKey
    if (originalFrom === undefined) delete process.env.EMAIL_FROM
    else process.env.EMAIL_FROM = originalFrom
  })

  it('with no RESEND_API_KEY configured, sendEmail no-ops: no network call, ok:true, skipped:true', async () => {
    delete process.env.RESEND_API_KEY
    const { sendEmail, composeMessage } = await import('@/lib/email')
    const message = composeMessage({ subject: 'Test', paragraphs: ['Hello'] })
    const result = await sendEmail({ to: 'nobody@example.com', template: 'notification', message })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    expect(result.skipped).toBe(true)
  })

  it('with a key configured, sendEmail calls the Resend REST API and reports the provider id', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend-msg-123' }),
    })
    const { sendEmail, composeMessage } = await import('@/lib/email')
    const message = composeMessage({ subject: 'Approved', paragraphs: ['Welcome'], cta: { label: 'Go', url: 'https://example.com/x' } })
    const result = await sendEmail({ to: 'owner@example.com', template: 'onboarding-approved', message })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body)
    expect(body.to).toEqual(['owner@example.com'])
    expect(body.subject).toBe('Approved')
    expect(body.text).toContain('Welcome')
    expect(body.text).toContain('https://example.com/x')
    expect(body.html).toContain('https://example.com/x')

    expect(result.ok).toBe(true)
    expect(result.providerId).toBe('resend-msg-123')
    expect(result.skipped).toBeUndefined()
  })

  it('EMAIL_FROM overrides the default sender when set', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    process.env.EMAIL_FROM = 'IFMS <hello@myfarm.example>'
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'x' }) })
    const { sendEmail, composeMessage } = await import('@/lib/email')
    await sendEmail({ to: 'a@example.com', template: 'notification', message: composeMessage({ subject: 's', paragraphs: ['p'] }) })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.from).toBe('IFMS <hello@myfarm.example>')
  })

  it('a non-2xx response from the provider is reported as a failure, never thrown', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Invalid `to` field' }),
    })
    const { sendEmail, composeMessage } = await import('@/lib/email')
    const result = await sendEmail({ to: 'bad', template: 'notification', message: composeMessage({ subject: 's', paragraphs: ['p'] }) })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid `to` field')
  })

  it('a network error (fetch throws) is caught and reported, never re-thrown', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const { sendEmail, composeMessage } = await import('@/lib/email')
    await expect(
      sendEmail({ to: 'a@example.com', template: 'notification', message: composeMessage({ subject: 's', paragraphs: ['p'] }) })
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('ECONNRESET') })
  })

  it('never logs the API key, even on failure', async () => {
    process.env.RESEND_API_KEY = 'super-secret-key-value'
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendEmail, composeMessage } = await import('@/lib/email')
    await sendEmail({ to: 'a@example.com', template: 'notification', message: composeMessage({ subject: 's', paragraphs: ['p'] }) })

    const loggedText = errSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(loggedText).not.toContain('super-secret-key-value')
    errSpy.mockRestore()
  })

  it('composeMessage renders plain text and HTML with the CTA link in both', () => {
    return import('@/lib/email').then(({ composeMessage }) => {
      const msg = composeMessage({ subject: 'Hi', paragraphs: ['Line one', 'Line two'], cta: { label: 'Click me', url: 'https://x.test/y' } })
      expect(msg.text).toContain('Line one')
      expect(msg.text).toContain('Line two')
      expect(msg.text).toContain('Click me: https://x.test/y')
      expect(msg.html).toContain('Line one')
      expect(msg.html).toContain('href="https://x.test/y"')
      expect(msg.html).toContain('Click me')
    })
  })

  it('resolveAppBaseUrl derives the origin from the request when no override is configured', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.VERCEL_URL
    const { resolveAppBaseUrl } = await import('@/lib/email')
    const req = new Request('https://ifms-puce.vercel.app/api/whatever')
    expect(resolveAppBaseUrl(req)).toBe('https://ifms-puce.vercel.app')
  })
})
