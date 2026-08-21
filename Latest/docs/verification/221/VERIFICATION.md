# Issue #221 — Verification Report

Independent check that the Platform Shell & Responsive Layout epic (#218) is done.
All six checks pass. Evidence was gathered live against the running app
(http://localhost:13001, new in-branch backend, postgres:16) on 2026-08-12.

The auth core this verification depends on was built fresh in this branch
(`users` + `sessions` tables, `POST /api/auth/login`, `GET /api/auth/session`,
`POST /api/auth/logout`, seeded real accounts via `pnpm db:seed`) — the shell's
bootstrap (#220) and farms API (#219) were already merged, but had no real
endpoints/accounts to verify against until now.

## Check 1 — Fresh load on 4 viewports ✅

Fresh (no-session) load renders the login screen at all four widths; screenshots
attached per viewport in this directory.

| Viewport | Screenshot | Evidence |
|---|---|---|
| 1440×900 (desktop ≥1440px) | `login-desktop.png` | Computed: `innerWidth` 1440, `.farm-device-frame` width **1440**, `max-width` 1440 → shell fills the window, **no fixed phone-frame artifact** (the old `.farm-app` 430px frame was removed in #220; only a fluid frame exists now). |
| 768×1024 (tablet) | `login-tablet.png` | `.farm-device-frame { max-width: 760px }` in the 768–1023px block → centered tablet column; login screen renders (DOM: Sign In + Demo Accounts present). |
| 412×915 (Android) | `login-android.png` | <768px: full-bleed phone layout, no frame chrome. |
| 390×844 (iPhone) | `login-iphone.png` | Same full-bleed phone layout; login screen renders. |

## Check 2 — Real login for owner / manager / worker, nav matches role ✅

Logged in against the **seeded `users` table** (real rows created by
`pnpm db:seed` — not the old client-side `DEMO_USERS` mock; the mock was
removed from the login screen and replaced with a real `POST /api/auth/login`):

| Account | Credential | Nav set shown |
|---|---|---|
| owner | james@nakurufarm.com / farm2026 | Home, Farm, Finance, Tasks, More |
| manager | peter@nakurufarm.com / mgr123 | Home, Farm, Tasks, Stock, More |
| worker | PIN 1234 | Home, Record, Pay, Profile |

Verified live in Chrome: each role lands on its start screen and the bottom
nav/sidebar shows exactly the role's tab set.

## Check 3 — Refresh mid-session stays logged in ✅

After owner login, reloading the page returned straight to the app shell
(Home screen with farm badge) — no bounce to login. The session is an httpOnly
`ifms_session` cookie resolved by `GET /api/auth/session`.

## Check 4 — Logout hits /api/auth/logout, cookie gone ✅

Sign-out: (1) `performance.getEntriesByType('resource')` shows a
**POST `/api/auth/logout`** was made; (2) immediately after, a fresh
`GET /api/auth/session` returns **401** — the session cookie is gone (deleted
server-side and `maxAge: 0` on the client).

## Check 5 — vet / auditor decision actually behaves ✅

Logged in as a real seeded vet (`vet@nakurufarm.com` / vet123) → the app shows
the **"Role not yet supported"** notice (Veterinarian) with a Sign Out button
and **no** bottom nav tabs — the explicit-deny decision from #219, verified as
actual behavior, not documentation. (Auditor follows the same guard in
`navigate()`; both roles have no tab set.)

## Check 6 — Second farm + switcher ✅

As owner: `POST /api/farms` with `{ name: "Rift Valley Dairy", location: "Nakuru" }`
(tenant resolved from the owner's session) returned `success: true`,
code `FRM-RIFT-VALLEY`. After reload, the dashboard farm switcher listed
**All Farms + Nakuru Main Farm + Eldoret Satellite + Rift Valley Dairy**, and
switching to Rift Valley Dairy updated the displayed farm pill to
**Rift Valley Dairy**.

## Console notes (all pre-existing / by design)

- `401` on `/api/auth/session` when logged out — the designed fallback to login.
- "button cannot be a descendant of button" hydration warning — pre-existing on
  `mobile-ui-upgrade`, unrelated to this diff.
