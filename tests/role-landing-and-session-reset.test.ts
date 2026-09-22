import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// Demoing the app by signing in and out between roles showed the PREVIOUS
// user's screen: NavProvider restores window.location.hash on mount (right for
// a refresh mid-session), and the hash outlives a sign-out, so it carried the
// last user's screen and its params into the next session. These tests pin
// both halves of the fix — the landing screen each role gets, and the reset
// that guarantees they actually get it.
describe('every role lands on its own screen, with nothing of the last user left', () => {
  const nav = read('components/farm/navigation.tsx')
  const page = read('app/page.tsx')

  it('names the exact landing screen for every role', () => {
    const map = nav.slice(nav.indexOf('function startScreenForRole'))
    expect(map).toMatch(/if \(role === 'worker'\) return 'worker-home'/)
    expect(map).toMatch(/if \(role === 'super_admin'\) return 'admin-dashboard'/)
    expect(map).toMatch(/if \(role === 'vet'\) return 'vet-herd'/)
    expect(map).toMatch(/if \(role === 'auditor'\) return 'auditor-reports'/)
    // owner and manager share the farm dashboard — the fallthrough.
    expect(map).toMatch(/return 'dashboard'; \/\/ owner \/ manager/)
  })

  it('signing in clears the screen hash, so the role lands where it should', () => {
    expect(page).toMatch(/function handleLogin\([^)]*\) \{\s*\n\s*clearScreenHash\(\);/)
  })

  it('signing out clears the hash and the whole identity, not just the role', () => {
    const logout = page.slice(page.indexOf('function handleLogout'), page.indexOf('// Register globally'))
    expect(logout).toMatch(/clearScreenHash\(\);/)
    expect(logout).toMatch(/setRole\('owner'\);/)
    expect(logout).toMatch(/setTenantId\(null\);/)
    expect(logout).toMatch(/setUserName\(''\);/)
    expect(logout).toMatch(/setSubscription\(null\);/)
    expect(logout).toMatch(/setImpersonation\(null\);/)
  })

  it('clearScreenHash drops the hash without reloading or losing the path', () => {
    const fn = page.slice(page.indexOf('function clearScreenHash'), page.indexOf('function handleLogin'))
    expect(fn).toMatch(/window\.history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\)/)
    expect(fn).not.toMatch(/location\.reload|location\.href\s*=/)
  })

  it('NavProvider is keyed by role and tenant, so no nav state survives a user switch', () => {
    expect(page).toMatch(/<NavProvider key=\{`\$\{role\}:\$\{tenantId \?\? 'none'\}`\}/)
  })

  it('still restores the hash on a mid-session refresh (the case the hash is for)', () => {
    const effect = nav.slice(nav.indexOf('const decoded = decodeHash(window.location.hash)'))
    expect(effect).toMatch(/if \(decoded\) \{/)
    expect(effect).toMatch(/initialScreen = startScreenForRole\(role\)/)
  })
})
