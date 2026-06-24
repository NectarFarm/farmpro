import { getSession } from '@/lib/server/session';
import { ok, unauthorized } from '@/lib/server/http';

// GET /api/auth/session — current user (for client bootstrap).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  return ok({
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role,
    workerProfileId: session.workerProfileId,
    name: session.name,
  });
}
