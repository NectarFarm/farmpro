import { NextResponse } from 'next/server';
import { signToken } from '@/lib/server/crypto';
import { SESSION_COOKIE } from '@/lib/server/session';
import { getServerEnv } from '@/lib/env';
import { consumeAuditorLink } from '@/lib/server/auditorLinks';

// GET /api/auditor/enter?token=... — verify the owner-issued link (signature + DB revoke
// check), grant a scoped read-only auditor session, and land on the auditor dashboard.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.redirect(`${origin}/owner/login`);

  const payload = await consumeAuditorLink(token);
  if (!payload) {
    return NextResponse.redirect(`${origin}/owner/login?error=link_expired`);
  }

  const { SESSION_SECRET, COOKIE_SECURE } = getServerEnv();
  const exp = Math.floor(Date.now() / 1000) + 8 * 3600;
  const jti = crypto.randomUUID();
  const sessionToken = await signToken(
    {
      userId: `link-auditor:${payload.linkId}`,
      tenantId: payload.tenantId,
      role: 'auditor',
      name: payload.email || 'Auditor (link)',
      exp,
      jti,
    },
    SESSION_SECRET,
  );
  const res = NextResponse.redirect(`${origin}/auditor/dashboard`);
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 8 * 3600,
  });
  return res;
}
