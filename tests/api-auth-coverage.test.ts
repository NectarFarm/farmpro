// ── API auth coverage sweep (fix/authenticate-all-apis) ─────────────────────
// The hole this task closed: 27 routes resolved their tenant as
// `session?.tenantId ?? searchParams.get('tenantId')` (14 of them the body
// equivalent on writes) — so an unauthenticated caller who merely guessed a
// tenant id got that tenant's data. lib/api-auth.ts's requireSession /
// requireRole / requireTenantSession close that, but a shared helper only
// helps if every route actually calls it. This test is what keeps that true:
// it WALKS THE FILESYSTEM under app/api (never a hardcoded route list, so a
// new route file is picked up automatically) and, for every exported HTTP
// method handler, asserts one of exactly two things:
//   (a) the route+method is named in PUBLIC_ROUTES below (public BY DESIGN,
//       justified inline), or
//   (b) calling it with NO session cookie returns 401.
// Add a route later and forget auth, and this test fails on it by name —
// that's the whole point.
//
// `OPTIONS` exports are not enumerated: they exist purely for CORS preflight
// (see app/api/health/route.ts, app/api/farms/route.ts), return a bare 204
// with no body, and never touch application data — there is nothing for an
// auth check to protect there.
//
// Write methods (POST/PUT/PATCH/DELETE) are sent a well-formed empty JSON
// body (`{}`), never a missing/malformed one. Several routes parse the body
// BEFORE the auth check purely to pull an optional `tenantId` field out of it
// for a super_admin caller (see lib/api-auth.ts's `explicitTenantId`) — with
// a malformed body those routes 400 on "Invalid JSON body" before ever
// reaching the auth check, which would make this test fail for the wrong
// reason. A well-formed empty body reaches the real check every time.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))
// No session cookie, ever — this suite only exercises the unauthenticated path.
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))

// Deliberately NOT gated on DATABASE_URL like this repo's other integration
// tests. getSessionUser() resolves to null straight from the (mocked, always
// -empty) cookie store without ever touching the database — see
// lib/auth.ts's getSessionDetails, which returns null the instant there's no
// token — so every non-public route below rejects before any DB call is
// attempted. This test is the one thing standing between "a route forgets
// auth" and it shipping; gating it on a database CI doesn't have would mean
// it never runs where it matters most.
//
// Two PUBLIC routes are the exception: auth/login (its rate-limit throttle
// check queries the DB unconditionally, before it even looks at the
// submitted credentials) and the auditor token route (resolving a token to a
// tenant is itself a DB lookup — there is no cookie to short-circuit on).
// Both are handled below by tolerating a thrown "DATABASE_URL is not set"
// specifically for PUBLIC routes — never for a route this test expects to
// 401, where a thrown error still fails loudly.
const API_ROOT = path.join(process.cwd(), 'app/api')
const TESTS_DIR = path.join(process.cwd(), 'tests')

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

// ── The public allowlist ─────────────────────────────────────────────────
// Keyed by the route's path relative to app/api (posix separators, dynamic
// segments kept literally as `[name]`). Value is 'all' (every method on that
// route is public) or a Set of just the public methods (everything else on
// that same route must still 401).
const PUBLIC_ROUTES: Record<string, 'all' | ReadonlySet<HttpMethod>> = {
  // Liveness probe — must answer with no credentials for a health checker /
  // load balancer to be useful at all.
  health: 'all',
  // Session lifecycle itself: login issues the session that every OTHER
  // route requires, so it cannot itself require one. Same for logout
  // (destroys whatever session exists, or no-ops) and session (the
  // bootstrap check the shell calls to find out whether it's logged in).
  'auth/login': 'all',
  'auth/logout': 'all',
  'auth/session': 'all',
  // A locked-out user has no session by definition — that's the whole
  // reason this route exists.
  'auth/forgot-password': 'all',
  // A prospective farmer submitting a signup request has no account yet.
  // GET on this same path is the super_admin review queue and must NOT be
  // public — only POST is allowlisted here.
  'onboard-requests': new Set<HttpMethod>(['POST']),
  // Authenticated by a share token in the URL instead of a session cookie —
  // see lib/auditor.ts's resolveAuditorTenantId. An invalid/expired/revoked
  // token still 401s (checked below), it just isn't the SESSION-shaped 401
  // every other route returns for "no cookie".
  'auditor/[token]/reports/[type]': 'all',
}

function isPublic(relDir: string, method: HttpMethod): boolean {
  const entry = PUBLIC_ROUTES[relDir]
  if (!entry) return false
  return entry === 'all' || entry.has(method)
}

// Recursively finds every `route.ts` under `dir`, returning absolute paths.
// This is the filesystem walk the whole test depends on — nothing here is a
// maintained list of routes; add a file under app/api and it appears here on
// the next run with no code change.
function findRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...findRouteFiles(full))
    } else if (entry.isFile() && entry.name === 'route.ts') {
      found.push(full)
    }
  }
  return found
}

// `app/api/auditor/[token]/reports/[type]` -> { relDir: 'auditor/[token]/reports/[type]',
// urlPath: '/api/auditor/coverage-test-token/reports/coverage-test-type',
// params: { token: 'coverage-test-token', type: 'coverage-test-type' } }
function describeRoute(routeFile: string) {
  const dirAbs = path.dirname(routeFile)
  const relDir = path.relative(API_ROOT, dirAbs).split(path.sep).join('/')
  const params: Record<string, string> = {}
  const urlSegments = relDir.split('/').map((segment) => {
    const match = segment.match(/^\[(.+)\]$/)
    if (!match) return segment
    const value = `coverage-test-${match[1]}`
    params[match[1]] = value
    return value
  })
  return {
    relDir,
    urlPath: `/api/${urlSegments.join('/')}`,
    params,
  }
}

function specifierFor(routeFile: string): string {
  const rel = path.relative(TESTS_DIR, routeFile).replace(/\.ts$/, '').split(path.sep).join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

describe('every app/api route requires auth unless explicitly public', () => {
  const routeFiles = findRouteFiles(API_ROOT).sort()

  // Sanity check on the sweep itself — if this ever reads 0, the walk is
  // broken, not the app.
  it('found real route.ts files to check', () => {
    expect(routeFiles.length).toBeGreaterThan(50)
  })

  for (const routeFile of routeFiles) {
    const { relDir, urlPath, params } = describeRoute(routeFile)

    it(`${relDir || '.'}: every exported handler is public-by-design or 401s with no session`, async () => {
      const mod = (await import(/* @vite-ignore */ specifierFor(routeFile))) as Record<string, unknown>

      const foundMethods = HTTP_METHODS.filter((m) => typeof mod[m] === 'function')
      expect(foundMethods.length, `${relDir}/route.ts exports no recognized HTTP method handler`).toBeGreaterThan(0)

      for (const method of foundMethods) {
        const handler = mod[method] as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

        const url = `http://localhost${urlPath}`
        const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
        const req = new Request(url, {
          method,
          headers: isWrite ? { 'Content-Type': 'application/json' } : undefined,
          body: isWrite ? JSON.stringify({}) : undefined,
        })

        const routeIsPublic = isPublic(relDir, method)

        let res: Response
        try {
          res = await handler(req, { params: Promise.resolve(params) })
        } catch (err) {
          // A PUBLIC route is allowed to need a real database to do its own
          // job (auth/login's throttle check, the auditor token lookup) —
          // that's not an auth hole, it's just untestable without a DB. A
          // route this test expects to 401 must never throw, with or
          // without a database — getSessionUser() never reaches the DB when
          // there's no cookie, so a throw here means something is broken
          // before the auth check even runs.
          if (routeIsPublic && String(err).includes('DATABASE_URL is not set')) continue
          throw new Error(
            `${relDir || '.'} ${method} threw instead of returning a response for an unauthenticated request: ${String(err)}`
          )
        }

        if (routeIsPublic) continue

        expect(
          res.status,
          `${relDir || '.'} ${method} is not in the public allowlist (tests/api-auth-coverage.test.ts) but returned ${res.status} for an unauthenticated request — it must 401`
        ).toBe(401)
      }
    })
  }
})

// ── The sweep above only proves a public route CAN be reached with no
// session. It says nothing about whether "public" is actually justified for
// the two entries that are public for a reason other than "there is
// genuinely no gate at all" — this checks that directly, no DB required.
describe('allowlist routes are exempt for the stated reason, not because nothing checks', () => {
  it('auditor/[token]/reports/[type]: an unrecognized token is rejected, not treated as public data', async () => {
    // resolveAuditorTenantId does a real DB lookup for the token — unlike a
    // session cookie, there's no way to know it's bogus without asking the
    // database. Skips (rather than fails) when no DB is configured, same as
    // every other DB-backed integration test in this repo.
    if (!process.env.DATABASE_URL) return
    const { GET } = await import('../app/api/auditor/[token]/reports/[type]/route')
    const res = await GET(new Request('http://localhost/api/auditor/bogus/reports/pl'), {
      params: Promise.resolve({ token: 'this-token-does-not-exist', type: 'pl' }),
    })
    expect(res.status).toBe(401)
  })

  it('onboard-requests: POST is public, but GET (the super_admin review queue) still requires a session', async () => {
    const { GET } = await import('../app/api/onboard-requests/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('gl/accounts is NOT on the allowlist — it now requires a session like everything else', async () => {
    const { GET } = await import('../app/api/gl/accounts/route')
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
