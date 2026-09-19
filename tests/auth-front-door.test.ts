// Front door: login, apply, set-password, fix-application are one family.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
    expect(auth).toMatch(/Ask admin/)
  })

  it('makes Apply for access a full-width door, not a text link', () => {
    expect(auth).toMatch(/className="auth-apply"/)
    expect(auth).toMatch(/Apply for access/)
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
    expect(auth).toMatch(/Application sent\./)
    expect(auth).not.toMatch(/\{'\\n'\}/)
    expect(auth).not.toMatch(/Request Submitted!/)
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
