import { db } from '@/db';
import { users } from '@/db/schemas';
import { inArray } from 'drizzle-orm';
import { verifySecret } from '@/lib/server/crypto';
import { createSession } from '@/lib/server/session';
import { checkLoginRateLimit, clientIp } from '@/lib/server/rateLimit';
import { checkLoginLockout, recordLoginAttempt, clearLoginFailures } from '@/lib/server/loginThrottle';
import { ok, badRequest, unauthorized, serviceUnavailable, tooMany } from '@/lib/server/http';
import { parseBody, workerLoginSchema } from '@/lib/server/validate';
import { phoneLookupVariants } from '@/lib/phone';

const BAD_CREDS = 'Wrong phone number or PIN.';

// POST /api/auth/worker  { phone, pin }
export async function POST(req: Request) {
  try {
    const parsed = await parseBody(req, workerLoginSchema);
    // Rate limit per (identifier, IP) so one account can't be brute-forced, without
    // penalizing every other user sharing the same router/IP (see rateLimit.ts).
    const limit = checkLoginRateLimit(req, 'error' in parsed ? undefined : parsed.data.phone);
    if (!limit.allowed) {
      return tooMany(`Too many login attempts. Try again in ${limit.retryAfter} seconds.`, limit.retryAfter);
    }
    if ('error' in parsed) return parsed.error;
    const { phone, pin } = parsed.data;
    const ip = clientIp(req);

    // DB-backed lockout — authoritative across serverless instances/cold starts.
    // Critical here: worker PINs are only 4–6 digits, so this is the real brute-force
    // defense. Generic message — never reveal whether the phone maps to an account.
    const lockout = await checkLoginLockout(phone);
    if (lockout.locked) {
      return tooMany(`Too many login attempts. Try again in ${lockout.retryAfter} seconds.`, lockout.retryAfter);
    }

    let user;
    try {
      [user] = await db.select().from(users).where(inArray(users.phone, phoneLookupVariants(phone))).limit(1);
    } catch {
      return serviceUnavailable("We couldn't reach the server. You can still work offline — sync when you're back online.");
    }
    if (!user || user.role !== 'worker' || !user.pinHash || !(await verifySecret(pin, user.pinHash))) {
      await recordLoginAttempt(phone, ip, false);
      return unauthorized(BAD_CREDS);
    }
    await clearLoginFailures(phone);

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
