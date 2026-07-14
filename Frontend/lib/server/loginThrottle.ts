import 'server-only';
import { db } from '@/db';
import { loginAttempts } from '@/db/schemas';
import { and, eq, gt, lt, asc } from 'drizzle-orm';

// DB-backed login brute-force protection.
//
// The in-memory limiter in ./rateLimit.ts is per serverless instance and is wiped
// on every cold start, so on Vercel it barely throttles an attacker who fans
// requests across instances. This module persists failed-login counts to Postgres
// (the same "survives across instances" pattern as ./sessionRevoke.ts) so the
// lockout is authoritative regardless of which function instance serves a request.
//
// Model: count FAILED attempts for one normalized identifier (email/phone) inside a
// sliding window; once the count reaches the threshold the identifier is locked out
// until the oldest counted failure ages out of the window. A SUCCESSFUL login clears
// the identifier's failures immediately (clearLoginFailures), so a legitimate user
// who eventually types the right secret is never left locked out by their own typos.

/** Max failed attempts per identifier within the window before lockout. */
const MAX_FAILURES = Number(process.env.LOGIN_LOCKOUT_MAX_FAILURES) || 10;
/** Sliding window length, in minutes. */
const WINDOW_MIN = Number(process.env.LOGIN_LOCKOUT_WINDOW_MIN) || 15;
const WINDOW_MS = WINDOW_MIN * 60_000;

function normalize(identifier: string): string {
  return identifier.trim().toLowerCase();
}

/** "table doesn't exist yet" — thrown before the migration runs; fail OPEN so login still works. */
function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

export type LockoutResult =
  | { locked: false }
  | { locked: true; retryAfter: number }; // seconds until the lockout eases

/**
 * Is this identifier currently locked out? Counts recent failed attempts and, if at
 * or over threshold, computes how long until enough failures age out of the window.
 *
 * Fails OPEN only when the table is missing (pre-migration). Any other DB error
 * propagates to the caller's try/catch, which returns a generic serviceUnavailable —
 * we never silently disable the throttle on a transient blip AND we never hard-fail
 * login in a way that leaks a different response for locked vs. unknown accounts.
 */
export async function checkLoginLockout(identifier: string): Promise<LockoutResult> {
  const id = normalize(identifier);
  if (!id) return { locked: false };
  const cutoff = new Date(Date.now() - WINDOW_MS);
  try {
    // Oldest-first, bounded: we only need the earliest failures to know when the
    // window clears. Limit keeps a griefed identifier's row-count from ballooning
    // the read (we still record every attempt, but never scan more than we need).
    const rows = await db
      .select({ createdAt: loginAttempts.createdAt })
      .from(loginAttempts)
      .where(and(
        eq(loginAttempts.identifier, id),
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, cutoff),
      ))
      .orderBy(asc(loginAttempts.createdAt))
      .limit(MAX_FAILURES + 1);

    if (rows.length < MAX_FAILURES) return { locked: false };

    // count === MAX_FAILURES here (limit capped it). The lockout eases once the
    // oldest counted failure ages past the window, dropping the count below threshold.
    const oldest = rows[0].createdAt.getTime();
    const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000));
    return { locked: true, retryAfter };
  } catch (err) {
    if (isMissingTable(err)) return { locked: false };
    throw err;
  }
}

/** Record one login attempt. Best-effort: never let bookkeeping break the login flow. */
export async function recordLoginAttempt(identifier: string, ip: string | null, success: boolean): Promise<void> {
  const id = normalize(identifier);
  if (!id) return;
  try {
    await db.insert(loginAttempts).values({
      id: crypto.randomUUID(),
      identifier: id,
      ip: ip ?? null,
      success,
    });
  } catch {
    /* best-effort — a failed insert must not turn a valid login into an error */
  }
}

/** Clear an identifier's failed attempts (call on successful login so typos don't linger). */
export async function clearLoginFailures(identifier: string): Promise<void> {
  const id = normalize(identifier);
  if (!id) return;
  try {
    await db.delete(loginAttempts).where(and(
      eq(loginAttempts.identifier, id),
      eq(loginAttempts.success, false),
    ));
  } catch {
    /* best-effort */
  }
}

/**
 * Opportunistic cleanup of old attempt rows (call rarely, e.g. from an admin/cron job).
 * Only rows older than the window matter for lockout; everything else is inert history
 * and can be swept. Not wired to a scheduler here — see follow-up note in the PR.
 */
export async function purgeOldLoginAttempts(): Promise<void> {
  try {
    await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(Date.now() - WINDOW_MS)));
  } catch {
    /* ignore */
  }
}
