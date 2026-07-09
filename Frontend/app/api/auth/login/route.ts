import { db } from '@/db';
import { users, tenants } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { verifySecret } from '@/lib/server/crypto';
import { createSession } from '@/lib/server/session';
import { checkLoginRateLimit } from '@/lib/server/rateLimit';
import { ok, badRequest, unauthorized, serviceUnavailable, forbidden, tooMany } from '@/lib/server/http';
import { parseBody, loginSchema } from '@/lib/server/validate';
import type { Role } from '@/lib/types';

const WEB_ROLES: Role[] = ['owner', 'manager', 'vet', 'auditor', 'super_admin'];

function isWebRole(r: string): r is Role {
  return (WEB_ROLES as readonly string[]).includes(r);
}

// Unified login: one form for everyone. The DB record decides the role — the
// client never chooses it. Accepts an email OR phone identifier, and verifies the
// secret against whichever credential the account uses (password for web roles,
// PIN for workers). Generic errors → no account enumeration.
const BAD = 'Login failed. Check your details and try again.';

export async function POST(req: Request) {
  try {
    const parsed = await parseBody(req, loginSchema);
    // Rate limit per (identifier, IP) so one account can't be brute-forced, without
    // penalizing every other user sharing the same router/IP (see rateLimit.ts).
    const limit = checkLoginRateLimit(req, 'error' in parsed ? undefined : parsed.data.identifier);
    if (!limit.allowed) {
      return tooMany(`Too many login attempts. Try again in ${limit.retryAfter} seconds.`, limit.retryAfter);
    }
    if ('error' in parsed) return parsed.error;
    const body = parsed.data;
    const identifier = body.identifier.trim();
    const secret = body.secret;

    let user;
    try {
      // Prefer an exact email match, then fall back to phone (distinct namespaces).
      [user] = await db.select().from(users).where(eq(users.email, identifier.toLowerCase())).limit(1);
      if (!user) [user] = await db.select().from(users).where(eq(users.phone, identifier)).limit(1);
    } catch {
      return serviceUnavailable("We couldn't reach the server. Check your connection and try again.");
    }

    const hash = user?.passwordHash ?? user?.pinHash;
    if (!user || !hash || !(await verifySecret(secret, hash))) return unauthorized(BAD);

    // A suspended farm (non-renewal) can't sign in — except the platform admin.
    if (user.role !== 'super_admin') {
      const [tenant] = await db.select({ active: tenants.active }).from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
      if (tenant && tenant.active === false) {
        return forbidden('This farm is suspended. Please contact the administrator to reactivate it.');
      }
    }

    await createSession({
      userId: user.id, tenantId: user.tenantId, role: isWebRole(user.role) ? user.role : 'worker',
      workerProfileId: user.workerProfileId ?? undefined, name: user.name,
    });
    return ok({
      user: {
        id: user.id, tenantId: user.tenantId, name: user.name, phone: user.phone,
        email: user.email, role: user.role, workerProfileId: user.workerProfileId, language: user.language,
      },
    });
  } catch {
    return serviceUnavailable('Something went wrong signing you in. Please try again.');
  }
}
