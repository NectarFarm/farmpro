// ── Screen swaps must stay non-blocking (INP) ──────────────────────────────
// Measured on a real device: tapping a nav item gave INP 1,288ms — input
// delay 1ms, handler 21ms, and ~1,266ms of PRESENTATION delay. Nothing in the
// handler was slow; the browser could not paint because the setStates were
// urgent and app/page.tsx mounts the whole destination screen in the same
// frame, some of which are 2,000-line components.
//
// These guard the shape of the fix, not the timing (which needs a device).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const nav = readFileSync(join(process.cwd(), 'components/farm/navigation.tsx'), 'utf8')

describe('components/farm/navigation.tsx — screen swaps are transitions', () => {
  it('uses useTransition rather than plain urgent state', () => {
    expect(nav).toMatch(/const \[isNavigating, startTransition\] = useTransition\(\)/)
  })

  it('every setCurrent that swaps screens is inside a transition', () => {
    // Walk each setCurrent call and require a startTransition between the
    // enclosing function start and it. Anchored to CODE: a bare
    // /startTransition/ check would pass on this file's own comments.
    const swaps = [...nav.matchAll(/setCurrent\(/g)].map((m) => m.index ?? 0)
    expect(swaps.length).toBeGreaterThan(3)
    const unwrapped = swaps.filter((at) => {
      const before = nav.slice(Math.max(0, at - 700), at)
      // Not interactions, so not INP: the mount-time hash decode (it runs
      // before any tap and has no frame to block) and the dev-only
      // RoleSelector, which never ships to production.
      const near = nav.slice(Math.max(0, at - 400), at)
      if (/decodeHash\(window\.location\.hash\)|RoleSelector|useState<ScreenId>\(startScreen\)/.test(near)) return false
      return !/startTransition\(\(\) => \{/.test(before)
    })
    expect(unwrapped).toEqual([])
  })

  it('keeps pushState OUT of the transition', () => {
    // It must run in the gesture's own task; deferring it desynchronises the
    // browser history from the screen and breaks the Android back button.
    const navigateBody = nav.slice(nav.indexOf('const navigate = useCallback'), nav.indexOf('const goBack'))
    const transitionAt = navigateBody.indexOf('startTransition')
    const pushAt = navigateBody.indexOf('window.history.pushState')
    expect(pushAt).toBeGreaterThan(-1)
    expect(pushAt).toBeGreaterThan(transitionAt)
    // pushState sits after the transition block closes, not inside it.
    expect(navigateBody.slice(transitionAt, pushAt)).toMatch(/\}\);/)
  })

  it('the browser back gesture gets the same treatment', () => {
    const popstate = nav.slice(nav.indexOf('const onPopState'), nav.indexOf('const onPopState') + 1400)
    expect(popstate).toMatch(/startTransition/)
  })

  it('exposes a pending flag, so a transition is never a dead button', () => {
    expect(nav).toMatch(/isNavigating: boolean/)
    expect(nav).toMatch(/isNavigating && <div className="nav-progress"/)
  })

  it('the progress bar survives prefers-reduced-motion', () => {
    // The signal is "something is happening" — the animation is decoration,
    // the bar is the message.
    const css = readFileSync(join(process.cwd(), 'app/global.css'), 'utf8')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    expect(block).toMatch(/\.nav-progress::after/)
    expect(block).toMatch(/animation: none/)
    expect(block).not.toMatch(/\.nav-progress[^:]*\{[^}]*display:\s*none/)
  })
})
