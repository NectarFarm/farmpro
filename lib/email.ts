// ── The one place mail is sent (feat/email-notifications) ──────────────────
// Before this file there was no mail capability anywhere in this codebase —
// no nodemailer/resend/sendgrid/smtp (confirmed by grepping package.json and
// the repo), yet the UI and several server-side comments already talked
// about "an admin will be notified" / "contact your administrator" as if
// mail existed. This is that capability, built deliberately small:
//
//   - Brevo's REST API over plain `fetch` — three endpoints' worth of use
//     does not justify an SDK dependency.
//   - Fails safe: with no BREVO_API_KEY configured, every send is a
//     logged no-op that still reports success to its caller. The app is
//     already deployed and the key may land after this code does; a route
//     that emails as a side effect (an approval, a rejection, a
//     notification) must keep working exactly as it did before mail
//     existed, key or no key.
//   - Sending NEVER throws. Every failure — no key, a network error, a
//     non-2xx from Brevo — is caught here and reported back as a result
//     object the caller can log, never an exception the caller must
//     remember to catch. An approval that already provisioned a tenant, or
//     a notification that already exists in the DB, must not be rolled
//     back or fail just because a mailbox bounced.
//   - One render path (composeMessage below): plain-text plus a small,
//     inline-styled HTML wrapper, same sender and footer every time. No
//     template engine — three call sites don't need one.
import 'server-only'
import { renderGuideHtml, renderGuideText } from './onboarding-guide'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

// Brevo rather than Resend: Resend will only deliver to the account owner's
// own address until a DNS-verified sending domain exists, which is a cost this
// project cannot carry yet. Brevo verifies a SINGLE SENDER ADDRESS instead, so
// a plain Gmail sender can reach real recipients. Sender identity, not domain
// ownership, is the thing being proved.
//
// Note for whoever configures the account: Brevo enables an authorised-IP
// restriction by default. It must be DISABLED, not populated — Vercel's egress
// addresses are dynamic and cannot be allowlisted, so an IP list that works
// locally still refuses every send from production.

// Falls back to the verified single sender. Brevo proves sender identity
// matters here because BREVO_API_KEY may exist before any domain is
// verified. EMAIL_FROM overrides it once the user has a verified domain.
const DEFAULT_FROM = 'IFMS <marlon.gmx1@gmail.com>'

const APP_NAME = 'IFMS'
const FOOTER_TEXT = `This is an automated message from ${APP_NAME}. If you weren't expecting it, you can ignore it.`

export type EmailTemplate =
  | 'onboarding-info-needed'
  | 'onboarding-approved'
  | 'onboarding-rejected'
  | 'onboarding-guide'
  | 'notification'
  | 'farm-deleted'

// Every send — success, no-op, or failure — reports this shape so the
// caller can log it. `providerId` is Brevo's message id (useful for
// support/debugging); `error` is set on any failure, including the no-op
// case being logged as informational rather than an error. Never includes
// the API key, a password, or a token — see the rule this file is held to.
export interface EmailResult {
  ok: boolean
  recipient: string
  template: EmailTemplate
  providerId?: string
  error?: string
  /** Set when no BREVO_API_KEY is configured — the send was skipped, not failed. */
  skipped?: boolean
}

export interface ComposedMessage {
  subject: string
  text: string
  html: string
}

interface ComposeOptions {
  subject: string
  // Plain paragraphs — rendered as blank-line-separated text and as <p> tags
  // in the HTML body. Keep these short; this is notification/transactional
  // copy, not marketing.
  paragraphs: string[]
  // A single call-to-action link, rendered as a button in HTML and as a
  // "label: url" line in plain text (a plain-text-only mail client still
  // needs the raw URL to click/copy).
  cta?: { label: string; url: string }
  // A pre-rendered block placed after the CTA — e.g. the onboarding guide's
  // ordered list (lib/onboarding-guide.ts). Kept generic here (this file
  // doesn't need to know what a "guide" is, matching the "one render path"
  // rule above) — the caller renders both the HTML and the text form and
  // this just places them.
  extra?: { heading?: string; html: string; text: string }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The single place a message is rendered — plain text plus a small inline-
// styled HTML document, same sender/footer every time. No template engine:
// three templates (below) all just call this with different copy.
export function composeMessage(opts: ComposeOptions): ComposedMessage {
  const textParts = [...opts.paragraphs]
  if (opts.cta) textParts.push(`${opts.cta.label}: ${opts.cta.url}`)
  if (opts.extra) {
    if (opts.extra.heading) textParts.push(opts.extra.heading)
    textParts.push(opts.extra.text)
  }
  textParts.push('—', FOOTER_TEXT)
  const text = textParts.join('\n\n')

  const htmlParagraphs = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;color:#1a1a1a;font-size:15px;line-height:1.5;">${escapeHtml(p)}</p>`)
    .join('\n')
  const htmlCta = opts.cta
    ? `<p style="margin:0 0 20px;"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(opts.cta.label)}</a></p>`
    : ''
  const htmlExtra = opts.extra
    ? `${opts.extra.heading ? `<div style="font-size:13px;font-weight:700;color:#1a1a1a;margin:4px 0 12px;">${escapeHtml(opts.extra.heading)}</div>` : ''}<div style="margin:0 0 20px;font-size:14px;line-height:1.5;">${opts.extra.html}</div>`
    : ''
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
<div style="font-size:13px;font-weight:700;letter-spacing:0.5px;color:#16a34a;text-transform:uppercase;margin-bottom:12px;">${APP_NAME}</div>
${htmlParagraphs}
${htmlCta}
${htmlExtra}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0;" />
<p style="margin:0;color:#888888;font-size:12px;line-height:1.5;">${escapeHtml(FOOTER_TEXT)}</p>
</div>`

  return { subject: opts.subject, text, html }
}

export interface SendEmailInput {
  to: string
  template: EmailTemplate
  message: ComposedMessage
}

// The only function that actually talks to the provider. Never throws — every
// failure path returns `{ ok: false, error }` instead. With no
// BREVO_API_KEY set, this is a logged no-op that still returns `ok: true`
// (the send was legitimately skipped, not a failure the caller should act
// on) so a caller that just does `const result = await sendEmail(...)` and
// logs it never has to special-case "email isn't configured yet".
export async function sendEmail({ to, template, message }: SendEmailInput): Promise<EmailResult> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.log('[email] BREVO_API_KEY not configured — skipping send', { to, template })
    return { ok: true, recipient: to, template, skipped: true }
  }

  // EMAIL_FROM is "Name <address>" for readability; Brevo wants them apart.
  const from = process.env.EMAIL_FROM || DEFAULT_FROM
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  const sender = match
    ? { name: match[1] || 'IFMS', email: match[2] }
    : { name: 'IFMS', email: from.trim() }

  try {
    // Bound external SMTP latency so a slow Brevo response can't exhaust the
    // limited DB connection pool while waiting. 15s is generous for a
    // transactional mail API; adjust if Brevo's SLA changes.
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15_000)
    let res: Response
    try {
      res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender,
          to: [{ email: to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // Brevo returns JSON on both success and error; an unparsable
      // body just means we can't extract a message/id from it below.
    }

    if (!res.ok) {
      const errBody = body as { message?: string } | null
      const error = errBody?.message || `Brevo responded ${res.status}`
      console.error('[email] send failed', { to, template, status: res.status, error })
      return { ok: false, recipient: to, template, error }
    }

    const okBody = body as { messageId?: string } | null
    return { ok: true, recipient: to, template, providerId: okBody?.messageId }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[email] send threw', { to, template, error })
    return { ok: false, recipient: to, template, error }
  }
}

/* ── The three onboarding templates (Task 2) ── */

// info-needed: the applicant has no account — this is the only way they
// hear that their request needs a correction, plus the one link (a
// tokenised public route, see lib/onboard-update.ts) that lets them fix it.
export async function sendOnboardingInfoNeededEmail(opts: {
  to: string
  farmerName: string
  farmName: string
  notes: string | null
  updateUrl: string
}): Promise<EmailResult> {
  const paragraphs = [
    `Hi ${opts.farmerName},`,
    `Thanks for applying to join ${APP_NAME} with ${opts.farmName}. We need a bit more information before we can approve your request.`,
    ...(opts.notes ? [`What's missing: ${opts.notes}`] : []),
    'Use the link below to review and update your request, then resubmit it for review.',
  ]
  const message = composeMessage({
    subject: `${APP_NAME}: more information needed for your application`,
    paragraphs,
    cta: { label: 'Update your request', url: opts.updateUrl },
  })
  return sendEmail({ to: opts.to, template: 'onboarding-info-needed', message })
}

// approved: NEVER emails the working temp password (that stays a one-time
// admin-side reveal, see PATCH /api/onboard-requests/[id]) — instead a
// one-time, expiring set-password link (lib/set-password.ts) that achieves
// the same outcome without leaving a reusable credential sitting in a
// mailbox forever.
export async function sendOnboardingApprovedEmail(opts: {
  to: string
  farmerName: string
  farmName: string
  setPasswordUrl: string
}): Promise<EmailResult> {
  const paragraphs = [
    `Hi ${opts.farmerName},`,
    `Good news — your application for ${opts.farmName} has been approved. Use the link below to set your password and sign in.`,
    'This link can only be used once and expires in 48 hours. If it expires before you use it, or if you ever forget your password later, use the "Forgot password" link on the sign-in screen — your farm administrator will be notified to help you reset it.',
  ]
  const message = composeMessage({
    subject: `${APP_NAME}: your application was approved — set your password`,
    paragraphs,
    cta: { label: 'Set your password', url: opts.setPasswordUrl },
    // lib/onboarding-guide.ts is the one place this list is written — see
    // that file's header for why the email and the in-app "Getting Started"
    // page both render it instead of keeping separate copy.
    extra: { heading: 'Getting started', html: renderGuideHtml(), text: renderGuideText() },
  })
  return sendEmail({ to: opts.to, template: 'onboarding-approved', message })
}

// Re-sends the getting-started guide on its own, with NO set-password link —
// that link is minted once and consumed the moment the applicant sets a
// password (or silently expires if they never do), so handing it out again
// here would either be dead or invalidate a link they still have. "Forgot
// password" is the real way back in for someone who already has an account,
// and this says so. See POST /api/onboard-requests/[id]/send-guide, the only
// caller — an admin resending the guide to an already-approved applicant.
export async function sendOnboardingGuideEmail(opts: {
  to: string
  farmerName: string
  farmName: string
}): Promise<EmailResult> {
  const paragraphs = [
    `Hi ${opts.farmerName},`,
    `Here's the getting-started guide for ${opts.farmName} again.`,
    'If you need to sign in and don\'t remember your password, use "Forgot password" on the sign-in screen — the one-time link from your approval email has already been used or has expired.',
  ]
  const message = composeMessage({
    subject: `${APP_NAME}: your getting-started guide`,
    paragraphs,
    extra: { heading: 'Getting started', html: renderGuideHtml(), text: renderGuideText() },
  })
  return sendEmail({ to: opts.to, template: 'onboarding-guide', message })
}

// rejected: short and plain, deliberately no credentials and no link.
export async function sendOnboardingRejectedEmail(opts: {
  to: string
  farmerName: string
  farmName: string
  notes: string | null
}): Promise<EmailResult> {
  const paragraphs = [
    `Hi ${opts.farmerName},`,
    `We're not able to approve your application for ${opts.farmName} at this time.`,
    ...(opts.notes ? [`Reason: ${opts.notes}`] : []),
  ]
  const message = composeMessage({
    subject: `${APP_NAME}: your application was not approved`,
    paragraphs,
  })
  return sendEmail({ to: opts.to, template: 'onboarding-rejected', message })
}

/* ── Notification template (Task 3) ── */

export async function sendNotificationEmail(opts: {
  to: string
  title: string
  message: string
}): Promise<EmailResult> {
  const paragraphs = [opts.title, ...(opts.message ? [opts.message] : [])]
  const message = composeMessage({
    subject: `${APP_NAME}: ${opts.title}`,
    paragraphs,
  })
  return sendEmail({ to: opts.to, template: 'notification', message })
}

/* ── Base URL for links embedded in mail ── */
// There is no dedicated APP_URL env var anywhere in this codebase (checked
// .env.example and every .env* file) — NEXT_PUBLIC_APP_URL is an opt-in
// override for when one is set; otherwise this derives the origin from the
// inbound request (works identically in local dev and on Vercel, where each
// deployment's real hostname is only known at request time), falling back to
// Vercel's own VERCEL_URL env var, then localhost for a route invoked with
// no Request at all (e.g. a background job).
export function resolveAppBaseUrl(req?: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  if (req) {
    try {
      const url = new URL(req.url)
      return `${url.protocol}//${url.host}`
    } catch {
      // fall through
    }
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:13001'
}


// ── A farm was removed from a farmer's account ─────────────────────────────
// Sent to the farm's owner when a platform admin deletes one of their farms.
// This is the one email in this file the recipient did not ask for and cannot
// undo, so it does two things carefully: it names WHICH farm (an account with
// several would otherwise have to guess), and it names a way to reach a human.
// No CTA button — there is nothing for them to click that helps, and a button
// on a destructive notice reads like a trap.
export async function sendFarmDeletedEmail(opts: {
  to: string
  farmerName: string
  farmName: string
  farmCode: string
  reason?: string
}): Promise<EmailResult> {
  const paragraphs = [
    `Hi ${opts.farmerName},`,
    `We are writing to let you know that the farm "${opts.farmName}" (${opts.farmCode}) has been removed from your ${APP_NAME} account by an administrator.`,
    ...(opts.reason ? [`Reason given: ${opts.reason}`] : []),
    'Your account and any other farms on it are unaffected, and you can continue signing in as normal.',
    'If you were not expecting this, reply to this message and an administrator will look into it.',
  ]
  const message = composeMessage({
    subject: `${APP_NAME}: the farm "${opts.farmName}" was removed from your account`,
    paragraphs,
  })
  return sendEmail({ to: opts.to, template: 'farm-deleted', message })
}
