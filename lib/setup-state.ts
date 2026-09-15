// ── Setup progress: is each getting-started step actually done? ─────────────
// The owner's complaint that started this: "that navigation does not show the
// sequential process in the app — a new user gets confused before they even
// get the guide". The SEQUENCE was never the missing piece; it has been
// written down, once, in lib/onboarding-guide.ts since the email-notifications
// follow-up, and both the approval email and the Getting Started screen render
// it from there. What was missing is whether each step is DONE — so every
// destination in the app looked equally like a starting point.
//
// This module answers that, and only that. It is deliberately a PURE function
// over a plain counts object, with no database import at all:
//
//   - GET /api/setup-state does the counting (one round trip, real SQL
//     COUNT(*) over the tenant's own rows) and calls deriveSetupSteps().
//   - tests/setup-state.test.ts exercises every branch below without a
//     Postgres anywhere near it.
//
// That split matters more here than in most places. This is the one thing in
// the feature that can start LYING — a wrong count, an optimistic default, a
// step quietly assumed done — and a farmer who is told "setup complete" while
// their workers have no logins has been misled by the app, not helped by it.
// So: no defaults, no assumptions, no "probably". Every check below names the
// exact table(s) it counts and what a zero there means.
//
// No 'server-only' import, for the same reason lib/onboarding-guide.ts has
// none: the client reads these types (components/farm/setup-progress.tsx) and
// the route runs the derivation.
import { ONBOARDING_GUIDE_STEPS, type OnboardingStepId, type OnboardingGuideStep } from './onboarding-guide'

// Real row counts for one tenant. Every field is a COUNT(*) the route actually
// ran — there is no "unknown" or "assume 0" member on purpose: a count that
// could not be read must fail the request, not quietly render as "not done
// yet", because "not done" is itself a claim about the farmer's data.
export interface SetupCounts {
  farms: number
  units: number
  batches: number
  products: number
  // Rows in `product_units` — a product ATTACHED to a unit, which is the half
  // of the products step people miss (a catalogue nothing produces yields
  // nothing). Counted separately from `products` for exactly that reason.
  productsAttachedToUnits: number
  stockItems: number
  purchases: number
  employees: number
  // Employees whose `userId` is set — i.e. a login has actually been issued.
  // The guide calls this out as "the separate step people miss", so the check
  // below refuses to treat an employee list as a done step without it.
  employeeLogins: number
  routines: number
  // Rows in `role_permissions`. The table is empty until someone saves the
  // matrix from Governance (PUT /api/role-permissions replaces it wholesale),
  // so "has any row" is a truthful "has this tenant ever decided who approves
  // what", not a proxy for it.
  approvalRules: number
}

export interface SetupStepState {
  id: OnboardingStepId
  title: string
  body: string
  /** Human-readable location, e.g. "Farm → Units" (from the guide). */
  screen?: string
  /** In-app destination for a "take me there" button (from the guide). */
  goTo?: { screen: string; params?: Record<string, string> }
  done: boolean
  /**
   * What the app can see, in the farmer's terms — "3 units added", "No units
   * yet", "5 employees, 2 with a login". Always states the REAL number, never
   * a percentage or a "step 3 of 7" that is computed from position rather than
   * from data. This string is the audit trail for `done`: if it disagrees with
   * what the farmer sees on the screen itself, the bug is visible immediately
   * instead of hiding behind a tick.
   */
  detail: string
}

export interface SetupState {
  counts: SetupCounts
  steps: SetupStepState[]
  completed: number
  total: number
  complete: boolean
  /** The first not-done step, or null once every step is done. */
  nextStepId: OnboardingStepId | null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// One check per guide step, keyed by the guide's own stable id. Adding a step
// to the guide without adding it here is a test failure, not a silent
// "always incomplete" (see tests/setup-state.test.ts) — which is the whole
// point of keying on ids rather than array position.
const SETUP_CHECKS: Record<OnboardingStepId, (c: SetupCounts) => { done: boolean; detail: string }> = {
  // Done by construction: this state is only ever derived for an authenticated
  // session, so the person reading it has signed in. That is a fact about the
  // request, not an optimistic assumption — an unauthenticated caller never
  // gets a response at all (lib/api-auth.ts).
  'sign-in': () => ({ done: true, detail: "You're signed in" }),

  // A farm is created for the owner when their application is approved, so
  // this is normally already true on first load. It is still CHECKED rather
  // than hardcoded true: a super_admin inspecting a freshly provisioned tenant
  // that has no farm yet should see that, not a tick.
  farm: (c) => ({
    done: c.farms > 0,
    detail: c.farms > 0 ? plural(c.farms, 'farm') : 'No farm on this account yet',
  }),

  units: (c) => ({
    done: c.units > 0,
    detail: c.units > 0 ? plural(c.units, 'production unit') : 'No production units yet',
  }),

  batch: (c) => ({
    done: c.batches > 0,
    detail: c.batches > 0 ? plural(c.batches, 'batch', 'batches') : 'No batches yet',
  }),

  // Both halves required. A product nothing produces is a catalogue entry, not
  // a working setup — and the guide's own copy is explicit that attaching it
  // to a unit is what makes batches inherit it.
  products: (c) => {
    if (c.products === 0) return { done: false, detail: 'No products yet' }
    if (c.productsAttachedToUnits === 0) {
      return { done: false, detail: `${plural(c.products, 'product')}, none attached to a unit` }
    }
    return {
      done: true,
      detail: `${plural(c.products, 'product')}, ${plural(c.productsAttachedToUnits, 'unit attachment')}`,
    }
  },

  // Both halves again, and for the same reason the guide gives: feeding a
  // batch draws down from real stock, so an item with no purchase behind it
  // has nothing to draw from.
  stock: (c) => {
    if (c.stockItems === 0) return { done: false, detail: 'No stock items yet' }
    if (c.purchases === 0) {
      return { done: false, detail: `${plural(c.stockItems, 'stock item')}, no purchases recorded` }
    }
    return { done: true, detail: `${plural(c.stockItems, 'stock item')}, ${plural(c.purchases, 'purchase')}` }
  },

  // The step people miss, per the guide: an employee record is not a login.
  // Counting employees alone here would tick this step for a farm whose
  // workers still cannot open the app.
  employees: (c) => {
    if (c.employees === 0) return { done: false, detail: 'No employees yet' }
    if (c.employeeLogins === 0) {
      return { done: false, detail: `${plural(c.employees, 'employee')}, none with a login yet` }
    }
    return { done: true, detail: `${plural(c.employees, 'employee')}, ${c.employeeLogins} with a login` }
  },

  routines: (c) => ({
    done: c.routines > 0,
    detail: c.routines > 0 ? plural(c.routines, 'routine') : 'No daily routines yet',
  }),

  approvals: (c) => ({
    done: c.approvalRules > 0,
    detail: c.approvalRules > 0 ? plural(c.approvalRules, 'permission rule') : 'Approval rules not set yet',
  }),
}

/**
 * Turn real counts into per-step done/not-done, in the guide's own order.
 *
 * Pure: same counts in, same steps out, no clock, no network, no database.
 * `steps` defaults to the shared guide so callers cannot accidentally derive
 * progress against a second, drifting copy of the list — which is the thing
 * lib/onboarding-guide.ts's header exists to prevent.
 */
export function deriveSetupSteps(
  counts: SetupCounts,
  steps: readonly OnboardingGuideStep[] = ONBOARDING_GUIDE_STEPS,
): SetupStepState[] {
  return steps.map((step) => {
    const check = SETUP_CHECKS[step.id]
    // A guide step with no check is a programming error, and the honest
    // answer is "we do not know", not "done". Rendering it as not-done keeps
    // the step visible (and the farmer pointed at the screen) instead of
    // hiding it behind a tick nobody earned.
    const result = check ? check(counts) : { done: false, detail: 'Not tracked yet' }
    return {
      id: step.id,
      title: step.title,
      body: step.body,
      screen: step.screen,
      goTo: step.goTo,
      done: result.done,
      detail: result.detail,
    }
  })
}

/** Roll the per-step results up into the numbers the UI shows. */
export function summariseSetup(counts: SetupCounts, steps?: readonly OnboardingGuideStep[]): SetupState {
  const derived = deriveSetupSteps(counts, steps)
  const completed = derived.filter((s) => s.done).length
  const next = derived.find((s) => !s.done) ?? null
  return {
    counts,
    steps: derived,
    completed,
    total: derived.length,
    // Every step, not "enough of them". A threshold would be a judgement the
    // app is not entitled to make about somebody else's farm.
    complete: completed === derived.length,
    nextStepId: next ? next.id : null,
  }
}
