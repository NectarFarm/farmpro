import { db } from '@/db';
import { users } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { verifySecret } from '@/lib/server/crypto';
import { createSession } from '@/lib/server/session';
import { checkLoginRateLimit } from '@/lib/server/rateLimit';
import { ok, badRequest, unauthorized, serviceUnavailable, tooMany } from '@/lib/server/http';
import { parseBody, ownerLoginSchema } from '@/lib/server/validate';
import type { Role } from '@/lib/types';

const WEB_ROLES: Role[] = ['owner', 'manager', 'vet', 'auditor', 'super_admin'];
const BAD_CREDS = 'Invalid email or password.';

// POST /api/auth/owner  { email, password }
export async function POST(req: Request) {
  // Rate limit: 5 attempts per minute per IP (brute-force protection)
  const limit = checkLoginRateLimit(req);
  if (!limit.allowed) {
    return tooMany(`Too many login attempts. Try again in ${limit.retryAfter} seconds.`, limit.retryAfter);
  }
  try {
    const parsed = await parseBody(req, ownerLoginSchema);
    if ('error' in parsed) return parsed.error;
    const { email, password } = parsed.data;

    let user;
    try {
      [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    } catch {
      // DB unreachable — never surface the raw error; tell the user to retry.
      return serviceUnavailable("We couldn't reach the server. Check your connection and try again.");
    }
    // Same response for unknown user and wrong password (no account enumeration).
    if (!user || !WEB_ROLES.includes(user.role as Role) || !user.passwordHash) return unauthorized(BAD_CREDS);
    if (!(await verifySecret(password, user.passwordHash))) return unauthorized(BAD_CREDS);

    await createSession({
      userId: user.id, tenantId: user.tenantId, role: user.role as Role,
      workerProfileId: user.workerProfileId ?? undefined, name: user.name,
    });
    return ok({
      user: {
        id: user.id, tenantId: user.tenantId, name: user.name,
        phone: user.phone, email: user.email, role: user.role, language: user.language,
      },
    });
  } catch {
    return serviceUnavailable('Something went wrong signing you in. Please try again.');
  }
}
