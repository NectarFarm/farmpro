import { getSession } from '@/lib/server/session';
import { signToken } from '@/lib/server/crypto';
import { getServerEnv } from '@/lib/env';
import { ok, unauthorized, forbidden } from '@/lib/server/http';

// POST /api/auditor-link  { email?, days? } — owner generates an expiring read-only link.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();

  const { email, days } = (await req.json().catch(() => ({}))) as { email?: string; days?: number };
  const d = Math.min(Math.max(Number(days) || 7, 1), 365);
  const exp = Math.floor(Date.now() / 1000) + d * 86400;
  const { SESSION_SECRET } = getServerEnv();

  const token = await signToken({ tenantId: session.tenantId, role: 'auditor', email: email ?? '', exp }, SESSION_SECRET);
  const origin = new URL(req.url).origin;
  return ok({ url: `${origin}/api/auditor/enter?token=${encodeURIComponent(token)}`, expiresInDays: d });
}
