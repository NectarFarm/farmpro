// ── Setup progress: the part that must never start lying ───────────────────
// lib/setup-state.ts turns real row counts into "step done / step not done",
// and that derivation is the one piece of this feature that can quietly go
// wrong in a way nobody notices. A broken layout is visible; a checklist that
// ticks "give each employee a login" for a farm whose workers cannot sign in
// is worse than having no checklist, because the farmer stops looking.
//
// So the tests below are deliberately about the CLAIMS, not about coverage:
//   - every guide step has a check, and no check exists for a step that isn't
//     in the guide (the two lists cannot drift apart silently);
//   - a completely empty tenant ticks exactly one step, the one that is true
//     by construction (you are signed in to be asking);
//   - each two-part step (products, stock, employees) refuses to tick on its
//     first half alone — those are the three the guide's own copy warns about;
//   - "complete" means every step, never a threshold;
//   - `detail` states the real number, so a wrong tick is inspectable.
//
// Pure functions over a plain object: no database, no route, no DOM. The route
// (app/api/setup-state/route.ts) does the counting and nothing else, which is
// what lets this suite run everywhere.
import { describe, it, expect } from 'vitest'
import { deriveSetupSteps, summariseSetup, type SetupCounts } from '@/lib/setup-state'
import { ONBOARDING_GUIDE_STEPS } from '@/lib/onboarding-guide'

// A tenant that has just signed in for the first time and done nothing else.
const EMPTY: SetupCounts = {
  farms: 0, units: 0, batches: 0, products: 0, productsAttachedToUnits: 0,
  stockItems: 0, purchases: 0, employees: 0, employeeLogins: 0, routines: 0,
  approvalRules: 0,
}

// Everything done, minimally.
const DONE: SetupCounts = {
  farms: 1, units: 2, batches: 3, products: 2, productsAttachedToUnits: 2,
  stockItems: 4, purchases: 1, employees: 5, employeeLogins: 2, routines: 1,
  approvalRules: 12,
}

function stepsById(counts: SetupCounts) {
  return new Map(deriveSetupSteps(counts).map((s) => [s.id, s]))
}

describe('setup progress derivation', () => {
  describe('it stays tied to the one guide', () => {
    it('derives exactly the guide’s steps, in the guide’s order', () => {
      const derived = deriveSetupSteps(EMPTY)
      expect(derived.map((s) => s.id)).toEqual(ONBOARDING_GUIDE_STEPS.map((s) => s.id))
      expect(derived.map((s) => s.title)).toEqual(ONBOARDING_GUIDE_STEPS.map((s) => s.title))
    })

    it('has a real check for every step — a step with no check must not silently tick', () => {
      // A missing check renders as not-done with "Not tracked yet". If this
      // string ever appears for a real guide step, a step was added to
      // lib/onboarding-guide.ts without adding its check to SETUP_CHECKS —
      // which would leave that step permanently unfinished and the farm
      // permanently "in setup".
      for (const step of deriveSetupSteps(DONE)) {
        expect(step.detail).not.toBe('Not tracked yet')
      }
    })

    it('carries the guide’s deep links through unchanged', () => {
      const byId = stepsById(EMPTY)
      for (const guideStep of ONBOARDING_GUIDE_STEPS) {
        expect(byId.get(guideStep.id)?.goTo).toEqual(guideStep.goTo)
        expect(byId.get(guideStep.id)?.screen).toEqual(guideStep.screen)
      }
    })
  })

  describe('an account with nothing in it', () => {
    it('ticks only the step that is true by construction', () => {
      const state = summariseSetup(EMPTY)
      expect(state.completed).toBe(1)
      expect(state.steps.filter((s) => s.done).map((s) => s.id)).toEqual(['sign-in'])
      expect(state.complete).toBe(false)
    })

    it('points at the first real thing to do, not at a later step', () => {
      expect(summariseSetup(EMPTY).nextStepId).toBe('farm')
      // With the farm already provisioned (the normal case after approval),
      // the next step is production units — the first thing the owner does.
      expect(summariseSetup({ ...EMPTY, farms: 1 }).nextStepId).toBe('units')
    })

    it('says what is missing in real terms, never a percentage', () => {
      const byId = stepsById(EMPTY)
      expect(byId.get('units')?.detail).toBe('No production units yet')
      expect(byId.get('batch')?.detail).toBe('No batches yet')
      expect(byId.get('employees')?.detail).toBe('No employees yet')
      expect(byId.get('approvals')?.detail).toBe('Approval rules not set yet')
    })
  })

  describe('the three steps with two halves', () => {
    it('will not tick products on a catalogue that no unit produces', () => {
      const half = stepsById({ ...DONE, products: 3, productsAttachedToUnits: 0 })
      expect(half.get('products')?.done).toBe(false)
      expect(half.get('products')?.detail).toBe('3 products, none attached to a unit')
      // And ticks once at least one attachment exists.
      expect(stepsById({ ...DONE, products: 3, productsAttachedToUnits: 1 }).get('products')?.done).toBe(true)
    })

    it('will not tick stock on items with no purchase behind them', () => {
      const half = stepsById({ ...DONE, stockItems: 4, purchases: 0 })
      expect(half.get('stock')?.done).toBe(false)
      expect(half.get('stock')?.detail).toBe('4 stock items, no purchases recorded')
      expect(stepsById({ ...DONE, stockItems: 4, purchases: 1 }).get('stock')?.done).toBe(true)
    })

    it('will not tick employees while nobody can actually sign in', () => {
      // The step the guide singles out as "the separate step people miss".
      // Counting employees alone here would tick it for a farm whose workers
      // have records but no way into the app.
      const half = stepsById({ ...DONE, employees: 6, employeeLogins: 0 })
      expect(half.get('employees')?.done).toBe(false)
      expect(half.get('employees')?.detail).toBe('6 employees, none with a login yet')
      const full = stepsById({ ...DONE, employees: 6, employeeLogins: 1 })
      expect(full.get('employees')?.done).toBe(true)
      expect(full.get('employees')?.detail).toBe('6 employees, 1 with a login')
    })
  })

  describe('one-count steps', () => {
    it('ticks on the first row and reports the real count', () => {
      expect(stepsById({ ...EMPTY, units: 1 }).get('units')?.detail).toBe('1 production unit')
      expect(stepsById({ ...EMPTY, units: 7 }).get('units')?.detail).toBe('7 production units')
      expect(stepsById({ ...EMPTY, batches: 1 }).get('batch')?.detail).toBe('1 batch')
      expect(stepsById({ ...EMPTY, batches: 4 }).get('batch')?.detail).toBe('4 batches')
      expect(stepsById({ ...EMPTY, routines: 2 }).get('routines')?.done).toBe(true)
      expect(stepsById({ ...EMPTY, approvalRules: 1 }).get('approvals')?.done).toBe(true)
    })

    it('checks the farm rather than assuming it — a tenant with no farm is not set up', () => {
      expect(stepsById(EMPTY).get('farm')?.done).toBe(false)
      expect(stepsById(EMPTY).get('farm')?.detail).toBe('No farm on this account yet')
      expect(stepsById({ ...EMPTY, farms: 2 }).get('farm')?.detail).toBe('2 farms')
    })
  })

  describe('completion', () => {
    it('is every step, not a threshold', () => {
      const state = summariseSetup(DONE)
      expect(state.complete).toBe(true)
      expect(state.completed).toBe(state.total)
      expect(state.total).toBe(ONBOARDING_GUIDE_STEPS.length)
      expect(state.nextStepId).toBeNull()

      // One step short is not complete, however late in the list it is.
      const almost = summariseSetup({ ...DONE, approvalRules: 0 })
      expect(almost.complete).toBe(false)
      expect(almost.completed).toBe(state.total - 1)
      expect(almost.nextStepId).toBe('approvals')
    })

    it('echoes the counts it was given, so a tick can be checked against them', () => {
      expect(summariseSetup(DONE).counts).toEqual(DONE)
    })

    it('never reports more completed steps than there are steps', () => {
      const state = summariseSetup(DONE)
      expect(state.completed).toBeLessThanOrEqual(state.total)
      expect(state.steps).toHaveLength(state.total)
    })
  })

  describe('it is pure', () => {
    it('gives the same answer twice and does not mutate its input', () => {
      const counts = { ...DONE }
      const a = summariseSetup(counts)
      const b = summariseSetup(counts)
      expect(a).toEqual(b)
      expect(counts).toEqual(DONE)
    })
  })
})
