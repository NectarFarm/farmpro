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
    title: 'Add your houses and fields',
    body: 'A house, pen, paddock or field is the place a batch actually lives — a pig pen, a dairy paddock, a poultry house, a maize plot. Add one before anything else: a batch has to belong to a place, and a product can only be attached to a place that already exists.',
    screen: 'Farm → Houses & fields',
    goTo: { screen: 'crops', params: { tab: 'units' } }
  },
  {
    id: 'batch',
    title: 'Start a batch',
    body: 'A batch is one group you track together — a herd, a house of birds, a pond, a planted field — living in a single place. Production records, feeding and costs all attach to a batch, so little else in the app works until one exists.',
    screen: 'Farm → Livestock / Crops',
    goTo: { screen: 'crops', params: { tab: 'livestock' } }
  },
  {
    id: 'products',
    title: 'Add products, and attach them to units',
    body: "Products are what you sell — milk, eggs, grain, live animals. Define each one once, then attach it to every house or field that produces it so its batches inherit it automatically. Set each product's stock effect correctly when you create it: it can reduce a batch's head count, reduce only collected produce, or reduce nothing at all — get this wrong and a sale changes the wrong number.",
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
    title: 'Add people, then give each worker a login',
    body: "Adding a person does not give them a way to sign in — that's a separate step people miss. Open the person, then use the Sign-in card to set a phone number and a 4-digit PIN. That pair is how they sign in. You can add someone before any batch exists; assign batches later.",
    screen: 'People',
    goTo: { screen: 'people' }
  },
  {
    id: 'routines',
    title: 'Set up daily routines',
    body: 'A routine is the checklist your workers see for a round — feed, water check, egg collection, whatever your mornings actually involve. Without one, a worker signing in has nothing to follow.',
    screen: 'Manage → Routines',
    goTo: { screen: 'routines' }
  },
  {
    id: 'approvals',
    title: 'Set who approves what',
    body: 'Approvals is where decisions get signed. A task can name a specific person when you create it, instead of leaving it open to anyone who can approve — worth setting up once you have people to name.',
    screen: 'Manage → Approvals',
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
      (s, i) =>
        `<li style="margin:0 0 16px;padding:0 0 16px 0;border-bottom:1px solid #eee6d8;list-style:none;">
<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border:1px solid #1c1914;border-radius:50%;font-size:12px;font-weight:700;margin-right:8px;vertical-align:top;">${i + 1}</span>
<div style="display:inline-block;width:calc(100% - 36px);vertical-align:top;">
<strong style="display:block;font-size:15px;color:#1c1914;">${escapeHtml(s.title)}</strong>
<div style="color:#5c564c;margin-top:4px;font-size:14px;line-height:1.5;">${escapeHtml(s.body)}</div>
</div>
</li>`
    )
    .join('')
  return `<ol style="margin:0;padding:0;">${items}</ol>`
}

// Plain-text equivalent for the text part of the email (a plain-text-only
// mail client still needs to read this).
export function renderGuideText(steps: OnboardingGuideStep[] = ONBOARDING_GUIDE_STEPS): string {
  return steps.map((s, i) => `${i + 1}. ${s.title}\n   ${s.body}`).join('\n\n')
}
