import { NextResponse } from 'next/server';
import { verifyToken, signToken } from '@/lib/server/crypto';
import { SESSION_COOKIE } from '@/lib/server/session';
import { getServerEnv } from '@/lib/env';

interface LinkToken { tenantId: string; role: 'auditor'; email?: string; exp: number; }

// GET /api/auditor/enter?token=... — verify the owner-issued link, grant a scoped
// read-only auditor session, and land on the auditor dashboard.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.redirect(`${origin}/owner/login`);

  const { SESSION_SECRET } = getServerEnv();
  const payload = await verifyToken<LinkToken>(token, SESSION_SECRET);
  if (!payload || payload.role !== 'auditor' || payload.exp * 1000 < Date.now()) {
    return NextResponse.redirect(`${origin}/owner/login?error=link_expired`);
  }

  const sessionToken = await signToken(
    { userId: 'link-auditor', tenantId: payload.tenantId, role: 'auditor', name: payload.email || 'Auditor (link)', exp: Math.floor(Date.now() / 1000) + 8 * 3600 },
    SESSION_SECRET
  );
  const res = NextResponse.redirect(`${origin}/auditor/dashboard`);
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 3600,
  });
  return res;
}
