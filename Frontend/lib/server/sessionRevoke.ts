import 'server-only';
import { db } from '@/db';
import { revokedSessions } from '@/db/schemas';
import { eq, lt } from 'drizzle-orm';
import { pgErrorCode } from './dbErrors';

/** Mark a session jti as revoked until its natural expiry (logout / remote kill). */
export async function revokeSessionJti(jti: string, userId: string | undefined, exp: number): Promise<void> {
  if (!jti) return;
  try {
    await db.insert(revokedSessions).values({
      jti,
      userId: userId ?? null,
      expiresAt: new Date(exp * 1000),
    }).onConflictDoNothing({ target: revokedSessions.jti });
  } catch {
    /* best-effort — never block logout */
  }
}

export async function isSessionRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return false;
  try {
    const [row] = await db.select({ jti: revokedSessions.jti })
      .from(revokedSessions)
      .where(eq(revokedSessions.jti, jti))
      .limit(1);
    return !!row;
  } catch (err) {
    // Fail open ONLY for "table doesn't exist yet" (42P01 — pre-migration), so
    // login still works before the migration runs. Any other error (connection
    // drop, timeout, etc.) must fail closed — treating it as "not revoked" would
    // silently defeat logout/remote-kill on a transient DB blip.
    // drizzle wraps the real postgres error in a DrizzleQueryError, so the
    // SQLSTATE lives on err.cause.code, not err.code — see lib/server/dbErrors.ts.
    if (pgErrorCode(err) === '42P01') return false;
    throw err;
  }
}

/** Opportunistic cleanup of expired revoke rows (call rarely). */
export async function purgeExpiredRevocations(): Promise<void> {
  try {
    await db.delete(revokedSessions).where(lt(revokedSessions.expiresAt, new Date()));
  } catch {
    /* ignore */
  }
}
