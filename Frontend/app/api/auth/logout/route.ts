import { clearSession } from '@/lib/server/session';
import { ok } from '@/lib/server/http';

// POST /api/auth/logout
export async function POST() {
  await clearSession();
  return ok({ ok: true });
}
