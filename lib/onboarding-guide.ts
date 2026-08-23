// ── The getting-started guide (feat/email-notifications follow-up) ─────────
// Written ONCE here so the approval email (lib/email.ts) and the in-app
// "Getting Started" page (components/farm/getting-started.tsx) can never
// drift apart — both render this same list, nothing else duplicates the
// copy. The order is the actual dependency chain a new owner hits, checked
// against the real screens/APIs while writing this (see each step below for
// the specific claim it makes): a unit before a batch, a batch before
// production/feed/costs, a product before it can be attached to a unit, an
// employee before a login can be issued for them.
//
// No 'server-only' import: this file is read by a server route (lib/email.ts)
// AND a client component (components/farm/getting-started.tsx), so it has to
// stay usable in both.

export interface OnboardingGuideStep {
  title: string
  body: string
  // Where this lives in the app today, shown only in-app — a mail client has
  // no navigation to point at, so the email renders title+body only.
  // Omitted for the one step that isn't a screen at all (signing in via the
  // emailed link).
  screen?: string
}

export const ONBOARDING_GUIDE_STEPS: OnboardingGuideStep[] = [
  {
    title: 'Sign in with your set-password link',
    body: "The link in your approval email lets you set your own password once, and it expires in 48 hours. After that, sign in with your email and password from the Sign In screen — if it's already expired, or you forget your password later, use \"Forgot password\" there instead of asking for a new link.",
  },
  {
    title: 'Your farm is already set up',
    body: "Approving your application created your first farm automatically, using the farm name and area you applied with. A farm is the top-level container everything else belongs to — production units, batches, stock, employees and finance all sit under one. Adding another farm today means asking your platform administrator; there's no self-serve way to create one yet.",
    screen: 'Farm switcher (sidebar)',
  },
  {
    title: 'Add your production units',
    body: 'A unit is a physical house, pen or field — the place a batch actually lives (e.g. "Layer House A"). Add one before anything else: a batch has to belong to a unit, and a product can only be attached to a unit that already exists.',
    screen: 'Farm → Units',
  },
  {
    title: 'Add a batch',
    body: 'A batch is one cohort of animals or a planted area, living in a single unit. Production records, feeding and costs all attach to a batch, so little else in the app works until one exists.',
    screen: 'Farm → Livestock / Crops',
  },
  {
    title: 'Add products, and attach them to units',
    body: "Products are what you sell — eggs, milk, birds. Define each one once, then attach it to every unit that produces it so its batches inherit it automatically. Set each product's stock effect correctly when you create it: it can reduce a batch's head count, reduce only collected produce, or reduce nothing at all — get this wrong and a sale changes the wrong number.",
    screen: 'Farm → Products',
  },
  {
    title: 'Add stock items and record a purchase',
    body: 'Feed and other supplies live in Inventory. Record a purchase to bring real stock in — feeding a batch later draws down from exactly this, so there has to be real stock on hand first.',
    screen: 'Inventory',
  },
  {
    title: 'Add employees, then give each one a login',
    body: "Adding an employee does not give them a way to sign in — that's a separate step people miss. Open the employee's record and use its Sign-in card to set a phone number and a 4-digit PIN; that pair is their login.",
    screen: 'People',
  },
  {
    title: 'Set up daily routines',
    body: 'A routine is the checklist your workers see for a round — feed, water check, egg collection, whatever your mornings actually involve. Without one, a worker signing in has nothing to follow.',
    screen: 'Settings → Daily routines',
  },
  {
    title: 'Set who approves what',
    body: 'Governance is where approval decisions get made. A task can name a specific approver when you create it, instead of leaving it open to anyone who can approve — worth setting up once you have employees to name.',
    screen: 'Governance',
  },
]

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// An ordered list, not a wall of text — the whole point of sending this
// alongside the set-password link instead of leaving a farmer to guess what
// comes next. Rendered once here so lib/email.ts never builds this markup
// by hand.
export function renderGuideHtml(steps: OnboardingGuideStep[] = ONBOARDING_GUIDE_STEPS): string {
  const items = steps
    .map(
      (s) =>
        `<li style="margin-bottom:12px;"><strong>${escapeHtml(s.title)}</strong><div style="color:#444444;margin-top:2px;">${escapeHtml(s.body)}</div></li>`
    )
    .join('')
  return `<ol style="margin:0;padding-left:20px;">${items}</ol>`
}

// Plain-text equivalent for the text part of the email (a plain-text-only
// mail client still needs to read this).
export function renderGuideText(steps: OnboardingGuideStep[] = ONBOARDING_GUIDE_STEPS): string {
  return steps.map((s, i) => `${i + 1}. ${s.title}\n   ${s.body}`).join('\n\n')
}
