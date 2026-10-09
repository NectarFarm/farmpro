// ── Guided tour: who gets it, and how "already seen" is remembered ─────────
// The overlay itself is DOM work this repo doesn't render in tests (no RTL —
// see tests/crops-batch-detail-ui.test.ts's header), but the decisions around
// it are plain functions and are where the behaviour that matters lives:
// showing a walkthrough to someone who has dismissed it, or hiding it from
// someone who hasn't, are both the kind of bug nobody reports — they just
// find the app annoying.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tourIdForRole, hasSeenTour, markTourSeen, clearTourSeen, tourStorageKey, TOURS } from '@/components/farm/tour'

function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    ...impl,
  }
  // The module reads `window.localStorage` directly; the app runs in a
  // browser and there is no injection seam worth adding for a UI preference.
  ;(globalThis as unknown as { window: unknown }).window = { localStorage: storage }
  return store
}

describe('guided tour', () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
    vi.restoreAllMocks()
  })

  describe('who gets a tour', () => {
    it('walks owners and managers through the same setup script', () => {
      expect(tourIdForRole('owner')).toBe('owner-v1')
      expect(tourIdForRole('manager')).toBe('owner-v1')
      expect(TOURS.owner).toBe(TOURS.manager)
    })

    it('gives workers their own, shorter script', () => {
      expect(tourIdForRole('worker')).toBe('worker-v1')
      expect(TOURS.worker.length).toBeGreaterThan(0)
      expect(TOURS.worker).not.toBe(TOURS.owner)
    })

    it('has no tour for roles pinned to a single screen', () => {
      // vet, auditor and super_admin land on one restricted screen — there is
      // nothing to walk through, and a spotlight on a nav bar they cannot use
      // would be worse than silence.
      for (const role of ['vet', 'auditor', 'super_admin']) {
        expect(tourIdForRole(role)).toBeNull()
      }
    })

    it('points every step at an anchor, never at a placeholder', () => {
      for (const steps of Object.values(TOURS)) {
        for (const step of steps) {
          expect(step.target).toMatch(/^[a-z0-9-]+$/)
          expect(step.title.length).toBeGreaterThan(0)
          expect(step.body.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('remembering that it has been seen', () => {
    beforeEach(() => { installStorage() })

    it('shows once, then not again', () => {
      expect(hasSeenTour('owner-v1', 'user-1')).toBe(false)
      markTourSeen('owner-v1', 'user-1', 'completed')
      expect(hasSeenTour('owner-v1', 'user-1')).toBe(true)
    })

    it('treats dismissing the same as finishing', () => {
      // Someone who closed it does not want it back on the next page load
      // either — that is the difference between a tour and a nag.
      markTourSeen('owner-v1', 'user-1', 'dismissed')
      expect(hasSeenTour('owner-v1', 'user-1')).toBe(true)
    })

    it('keeps two people on a shared device apart', () => {
      markTourSeen('owner-v1', 'user-1', 'completed')
      expect(hasSeenTour('owner-v1', 'user-2')).toBe(false)
      expect(tourStorageKey('owner-v1', 'user-1')).not.toBe(tourStorageKey('owner-v1', 'user-2'))
    })

    it('keeps the two scripts apart, so changing one does not replay the other', () => {
      markTourSeen('owner-v1', 'user-1', 'completed')
      expect(hasSeenTour('worker-v1', 'user-1')).toBe(false)
    })

    it('can be reset, which is what Settings › Show me around does', () => {
      markTourSeen('owner-v1', 'user-1', 'completed')
      clearTourSeen('owner-v1', 'user-1')
      expect(hasSeenTour('owner-v1', 'user-1')).toBe(false)
    })
  })

  describe('when the browser refuses storage', () => {
    it('reports the tour as seen rather than showing it on every load', () => {
      // Private windows and blocked site data THROW on access rather than
      // returning null. Guessing "not seen" there means an inescapable tour
      // on every single page load, so the safe guess is the quiet one.
      installStorage({ getItem: () => { throw new Error('SecurityError') } })
      expect(hasSeenTour('owner-v1', 'user-1')).toBe(true)
    })

    it('does not throw when it cannot record the dismissal', () => {
      installStorage({ setItem: () => { throw new Error('QuotaExceededError') } })
      expect(() => markTourSeen('owner-v1', 'user-1', 'dismissed')).not.toThrow()
      expect(() => clearTourSeen('owner-v1', 'user-1')).not.toThrow()
    })
  })
})

// ── Replay from Settings: source guards (client-only behaviour) ────────────
// Two bugs found by driving the app at 390px: (1) after a fresh sign-in (no
// reload) the page never learned the user id, so TourController never mounted
// and "Show me around" did nothing; (2) the overlay resolved its steps once
// at mount, before the dashboard it had just navigated to rendered, so the
// replay silently dropped the setup card and farm switcher (4 of 8 steps).
import { readFileSync } from 'node:fs'

describe('tour source guards', () => {
  const tour = readFileSync('components/farm/tour.tsx', 'utf8')
  const page = readFileSync('app/page.tsx', 'utf8')
  const auth = readFileSync('components/farm/auth.tsx', 'utf8')

  it('keeps the user id from a fresh sign-in so the tour controller mounts', () => {
    expect(auth).toMatch(/onLogin\(res\.data\.role,[^)]*res\.data\.id\)/)
    expect(page).toMatch(/function handleLogin\([^)]*id = ''\)/)
    expect(page).toMatch(/setUserId\(id\)/)
  })

  it('re-resolves steps as the page changes instead of once at mount', () => {
    expect(tour).toContain('new MutationObserver')
    expect(tour).toContain('resolveSteps(steps)')
  })

  it('does not smooth-scroll the target (spotlight chased it for 320ms)', () => {
    expect(tour).not.toContain("behavior: 'smooth'")
  })
})
