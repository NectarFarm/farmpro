// Front door: login, apply, set-password, fix-application are one family.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatLockRemain } from '@/components/farm/auth'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const auth = read('components/farm/auth.tsx')
const css = read('app/global.css')
const page = read('app/page.tsx')
const setPassword = read('app/set-password/[token]/set-password-view.tsx')
const update = read('app/onboard-requests/update/[token]/onboard-update-view.tsx')

describe('auth is one family, 420px, not the app reading column', () => {
  it('puts login, apply and the token pages in AuthShell', () => {
    expect(auth).toMatch(/export function AuthShell/)
    expect(auth).toMatch(/<AuthShell>/)
    expect(setPassword).toMatch(/<AuthShell>/)
    expect(update).toMatch(/<AuthShell>/)
    expect(css).toMatch(/\.auth-shell \{[\s\S]*max-width: 420px/)
  })

  it('does not cap the headline at 15ch', () => {
    expect(auth).not.toMatch(/maxWidth: '15ch'/)
  })

  it('clips the masthead so 375px does not grow a horizontal scroll', () => {
    expect(css).toMatch(/\.auth-shell \{[\s\S]*overflow-x: hidden/)
    expect(css).toMatch(/\.auth-masthead-horizon \{[\s\S]*inset: 0 0 auto 0/)
    expect(page).toMatch(/overflowX: 'hidden'/)
  })

  it('uses proportional figures on the headline so commas do not float', () => {
    expect(css).toMatch(/\.auth-masthead h1 \{[\s\S]*font-variant-numeric: proportional-nums/)
  })

  it('keeps a 420px form and fills the desktop with public copy, not tenant data', () => {
    expect(auth).toMatch(/export function AuthStage/)
    expect(css).toMatch(/\.auth-aside \{ display: none; \}/)
    expect(auth).toMatch(/The farm record\. Animals, harvests and money/)
  })

  it('does not promise a trial', () => {
    expect(auth).not.toMatch(/14-day trial/)
    expect(auth).not.toMatch(/Join IFMS/)
  })

  it('names a mixed farm, not a poultry house', () => {
    expect(auth).toMatch(/Animals, harvests and money/)
    expect(auth).not.toMatch(/Every bird, bag/)
    expect(page).not.toMatch(/Every bird, bag/)
  })
})

describe('login doors', () => {
  it('names Email and Worker, not I run the farm', () => {
    expect(auth).toMatch(/label: 'Email'/)
    expect(auth).toMatch(/label: 'Worker'/)
    expect(auth).not.toMatch(/I run the farm/)
    expect(auth).not.toMatch(/I work here/)
  })

  it('uses a real form, labelled fields, and a named show-password control', () => {
    expect(auth).toMatch(/htmlFor="login-email"/)
    expect(auth).toMatch(/htmlFor="login-password"/)
    expect(auth).toMatch(/aria-label=\{showPwd \? 'Hide password' : 'Show password'\}/)
    expect(auth).toMatch(/<form onSubmit=/)
  })

  it('asks for help signing in, not a self-serve reset', () => {
    expect(auth).toMatch(/Need help signing in\?/)
    expect(auth).toMatch(/Notify my admin/)
    expect(auth).not.toMatch(/>Ask admin</)
  })

  it('pauses Sign in during lockout and ticks the wait', () => {
    expect(auth).toMatch(/disabled=\{busy \|\| lock\.locked\}/)
    expect(auth).toMatch(/formatLockRemain/)
    expect(auth).toMatch(/retryAfterSeconds/)
    expect(auth).toMatch(/Extra taps will not get you in sooner/)
  })

  it('masks the password again after a failed attempt', () => {
    expect(auth).toMatch(/setShowPwd\(false\)/)
  })

  it('deletes the last PIN digit, and the empty pad cell is not a button', () => {
    expect(auth).toMatch(/aria-label=\{d === 'DEL' \? 'Delete last digit' : d\}/)
    expect(auth).toMatch(/\{d === 'DEL' \? 'Delete' : d\}/)
    expect(auth).not.toMatch(/'Clear last digit'/)
    // Restyled to Tailwind (ui/governance-reference-redesign): the blank pad
    // cell is still a plain, non-interactive <div>, just no longer via the
    // legacy .auth-pin-key CSS class.
    expect(auth).toMatch(/<div aria-hidden="true" className="pointer-events-none" \/>/)
    expect(auth).not.toMatch(/<button[^>]*>\s*<\/button>/)
  })

  it('uses parallel door hints, not a who-list vs a what-list', () => {
    expect(auth).toMatch(/hint: 'Email and password'/)
    expect(auth).toMatch(/hint: 'Phone and PIN'/)
    expect(auth).not.toMatch(/Owners, managers, admins/)
  })

  it('makes Apply for access a full-width button, not a text link', () => {
    // Restyled to the ui-kit Button (was a hand-rolled .auth-apply/.btn-secondary
    // button) — still a full-width button, never a bare <a>/text link.
    expect(auth).toMatch(/<Button variant="secondary" className="w-full justify-center" onClick=\{onRegister\}>/)
    expect(auth).toMatch(/Apply for access/)
    expect(auth).not.toMatch(/<a[^>]*>\s*Apply for access/)
  })

  it('does not auto-submit the PIN on the fourth digit', () => {
    expect(auth).toMatch(/function handlePinLogin/)
    expect(auth).not.toMatch(/if \(next\.length === 4\)/)
  })

  it('PIN dots are not a dark-theme white ring', () => {
    expect(auth).not.toMatch(/rgba\(255,255,255,0\.15\)/)
    expect(css).toMatch(/\.auth-pin-dot/)
  })
})

describe('apply for access', () => {
  it('saves a draft on this device', () => {
    expect(auth).toMatch(/ifms\.apply\.draft/)
  })

  it('does not greet step 3 with live warnings', () => {
    expect(auth).not.toMatch(/selectedEnterprises\.length === 0 \? 'Select at least one/)
  })

  it('does not print livestock\/crop under enterprise names', () => {
    expect(auth).toMatch(/title: 'Animals'/)
    expect(auth).toMatch(/title: 'Crops'/)
    expect(auth).not.toMatch(/\{e\.type\}/)
  })

  it('pins the farm first, coordinates behind a details toggle', () => {
    expect(auth).toMatch(/Pin this farm/)
    expect(auth).toMatch(/Type coordinates instead/)
  })

  it('confirms before abandoning a half-filled application', () => {
    expect(auth).toMatch(/Leave this application\?/)
  })

  it('success copy is real paragraphs, not a collapsed newline', () => {
    expect(auth).toMatch(/Application sent/)
    expect(auth).not.toMatch(/\{'\\n'\}/)
    expect(auth).not.toMatch(/Request Submitted!/)
  })
})

describe('lockout clock', () => {
  it('formats remaining seconds as m:ss, never a rounded 12 min', () => {
    expect(formatLockRemain(12)).toBe('12s')
    expect(formatLockRemain(60)).toBe('1:00')
    expect(formatLockRemain(707)).toBe('11:47')
    expect(formatLockRemain(0)).toBe('0s')
  })
})

describe('boot and token pages', () => {
  it('boot looks like the login, not Loading your session', () => {
    expect(page).toMatch(/Checking…/)
    expect(page).not.toMatch(/Loading your session/)
  })

  it('a dead set-password link has a way back to sign in', () => {
    expect(setPassword).toMatch(/Back to sign in/)
    expect(setPassword).toMatch(/className="farm-input"/)
    expect(setPassword).not.toMatch(/--card-bg/)
  })

  it('a dead update-application link has a way back to sign in', () => {
    expect(update).toMatch(/Back to sign in/)
    expect(update).toMatch(/<AuthShell>/)
    expect(update).not.toMatch(/--card-bg/)
  })
})
