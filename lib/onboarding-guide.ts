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

// A stable key per step. The step LIST is the source of truth for order and
// copy; these ids are the source of truth for "which step is this" — they are
// what GET /api/setup-state keys its done/not-done derivation on
// (lib/setup-state.ts), so reordering or rewording a step below never silently
// re-points a progress check at the wrong thing. Renaming an id, on the other
// hand, is a breaking change: lib/setup-state.ts's SETUP_CHECKS must name the
// same ids, and tests/setup-state.test.ts asserts the two lists match exactly.
export type OnboardingStepId =
  | 'sign-in' | 'farm' | 'units' | 'batch' | 'products'
  | 'stock' | 'employees' | 'routines' | 'approvals'

export interface OnboardingGuideStep {
  id: OnboardingStepId
  title: string
  body: string
  // Where this lives in the app today, shown only in-app — a mail client has
  // no navigation to point at, so the email renders title+body only.
  // Omitted for the one step that isn't a screen at all (signing in via the
  // emailed link).
  screen?: string
  // The in-app destination `screen` describes, as a real navigation target:
  // a ScreenId, optionally with the params that screen needs to open on the
  // right tab (CropsScreen reads `params.tab`). This is what lets the setup
  // progress UI actually TAKE you to the next step instead of naming a menu
  // path and leaving you to find it. Typed as loose strings, not ScreenId:
  // this file is also imported by a server route (lib/email.ts) and must not
  // pull in components/farm/navigation.tsx, which is "use client".
  // Deliberately absent where there is nothing to open — signing in happens
  // before the app, and creating a farm is not self-serve (see that step's
  // body).
  goTo?: { screen: string; params?: Record<string, string> }
}

export const ONBOARDING_GUIDE_STEPS: OnboardingGuideStep[] = [
  {
    id: 'sign-in',
    title: 'Sign in with your set-password link',
    body: "The link in your approval email lets you set your own password once, and it expires in 48 hours. After that, sign in with your email and password from the Sign In screen — if it's already expired, or you forget your password later, use \"Forgot password\" there instead of asking for a new link.",
  },
  {
    id: 'farm',
    title: 'Your farm is already set up',
    body: "Approving your application created your first farm automatically, using the farm name and area you applied with. A farm is the top-level container everything else belongs to — production units, batches, stock, employees and finance all sit under one. Adding another farm today means asking your platform administrator; there's no self-serve way to create one yet.",
    screen: 'Farm switcher (sidebar)',
  },
  {
    id: 'units',
    title: 'Add your production units',
    body: 'A unit is a physical house, pen or field — the place a batch actually lives (e.g. "Layer House A"). Add one before anything else: a batch has to belong to a unit, and a product can only be attached to a unit that already exists.',
    screen: 'Farm → Units',
    goTo: { screen: 'crops', params: { tab: 'units' } }
  },
  {
    id: 'batch',
    title: 'Add a batch',
    body: 'A batch is one cohort of animals or a planted area, living in a single unit. Production records, feeding and costs all attach to a batch, so little else in the app works until one exists.',
    screen: 'Farm → Livestock / Crops',
    goTo: { screen: 'crops', params: { tab: 'livestock' } }
  },
  {
    id: 'products',
    title: 'Add products, and attach them to units',
    body: "Products are what you sell — eggs, milk, birds. Define each one once, then attach it to every unit that produces it so its batches inherit it automatically. Set each product's stock effect correctly when you create it: it can reduce a batch's head count, reduce only collected produce, or reduce nothing at all — get this wrong and a sale changes the wrong number.",
    screen: 'Farm → Products',
    goTo: { screen: 'crops', params: { tab: 'products' } }
  },
  {
    id: 'stock',
    title: 'Add stock items and record a purchase',
    body: 'Feed and other supplies live in Inventory. Record a purchase to bring real stock in — feeding a batch later draws down from exactly this, so there has to be real stock on hand first.',
    screen: 'Inventory',
    goTo: { screen: 'inventory' }
  },
  {
    id: 'employees',
    title: 'Add employees, then give each one a login',
    body: "Adding an employee does not give them a way to sign in — that's a separate step people miss. Open the employee's record and use its Sign-in card to set a phone number and a 4-digit PIN; that pair is their login.",
    screen: 'People',
    goTo: { screen: 'people' }
  },
  {
    id: 'routines',
    title: 'Set up daily routines',
    body: 'A routine is the checklist your workers see for a round — feed, water check, egg collection, whatever your mornings actually involve. Without one, a worker signing in has nothing to follow.',
    screen: 'Manage → Daily routines',
    goTo: { screen: 'routines' }
  },
  {
    id: 'approvals',
    title: 'Set who approves what',
    body: 'Governance is where approval decisions get made. A task can name a specific approver when you create it, instead of leaving it open to anyone who can approve — worth setting up once you have employees to name.',
    screen: 'Governance',
    goTo: { screen: 'governance' }
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
