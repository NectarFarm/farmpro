import { db } from '@/db';
import { users } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { verifySecret } from '@/lib/server/crypto';
import { createSession } from '@/lib/server/session';
import { checkLoginRateLimit } from '@/lib/server/rateLimit';
import { ok, badRequest, unauthorized, serviceUnavailable, tooMany } from '@/lib/server/http';
import { parseBody, workerLoginSchema } from '@/lib/server/validate';

const BAD_CREDS = 'Wrong phone number or PIN.';

// POST /api/auth/worker  { phone, pin }
export async function POST(req: Request) {
  // Rate limit: 5 attempts per minute per IP (brute-force protection)
  const limit = checkLoginRateLimit(req);
  if (!limit.allowed) {
    return tooMany(`Too many login attempts. Try again in ${limit.retryAfter} seconds.`, limit.retryAfter);
  }
  try {
    const parsed = await parseBody(req, workerLoginSchema);
    if ('error' in parsed) return parsed.error;
    const { phone, pin } = parsed.data;

    let user;
    try {
      [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    } catch {
      return serviceUnavailable("We couldn't reach the server. You can still work offline — sync when you're back online.");
    }
    if (!user || user.role !== 'worker' || !user.pinHash) return unauthorized(BAD_CREDS);
    if (!(await verifySecret(pin, user.pinHash))) return unauthorized(BAD_CREDS);

    await createSession({
      userId: user.id, tenantId: user.tenantId, role: 'worker',
      workerProfileId: user.workerProfileId ?? undefined, name: user.name,
    });
    return ok({
      user: {
        id: user.id, tenantId: user.tenantId, name: user.name,
        phone: user.phone, role: user.role, workerProfileId: user.workerProfileId, language: user.language,
      },
    });
  } catch {
    return serviceUnavailable('Something went wrong signing you in. Please try again.');
  }
}
