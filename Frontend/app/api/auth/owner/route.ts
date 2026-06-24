import { db } from '@/db';
import { users } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { verifySecret } from '@/lib/server/crypto';
import { createSession } from '@/lib/server/session';
import { ok, badRequest, unauthorized, serviceUnavailable } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const WEB_ROLES: Role[] = ['owner', 'manager', 'vet', 'auditor', 'super_admin'];
const BAD_CREDS = 'Invalid email or password.';

// POST /api/auth/owner  { email, password }
export async function POST(req: Request) {
  try {
    const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    if (!email || !password) return badRequest('Enter your email and password.');

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
