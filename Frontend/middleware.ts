import { NextRequest, NextResponse } from 'next/server';

// Edge auth gate: no protected page (owner/admin/worker/…) is served to a request
// without a valid, unexpired, correctly-signed session cookie — and each section is
// locked to its roles. Runs before any page renders, so nothing flashes and it
// can't be bypassed by client state. Verifies the same HMAC token as the server.

const SESSION_COOKIE = 'ifms_session';
const enc = new TextEncoder();

const ROLE_HOME: Record<string, string> = {
  owner: '/owner/dashboard', manager: '/owner/dashboard', worker: '/worker/home',
  vet: '/vet/units', auditor: '/auditor/dashboard', super_admin: '/admin/dashboard',
};

// Login / token-entry pages must stay reachable while logged out.
const PUBLIC = ['/login', '/owner/login', '/owner/setup', '/worker/login', '/auditor/enter'];

function sectionRoles(pathname: string): string[] | null {
  if (pathname.startsWith('/admin')) return ['super_admin'];
  if (pathname.startsWith('/owner') || pathname.startsWith('/manager')) return ['owner', 'manager'];
  if (pathname.startsWith('/vet')) return ['vet'];
  if (pathname.startsWith('/auditor')) return ['auditor'];
  if (pathname.startsWith('/worker')) return ['worker'];
  return null;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function readSession(token: string, secret: string): Promise<{ role: string; exp: number } | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { role: string; exp: number };
    if (!p.exp || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) return NextResponse.next();

  const allowed = sectionRoles(pathname);
  if (!allowed) return NextResponse.next();

  const secret = process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me-please';
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await readSession(token, secret) : null;

  const redirect = (to: string) => {
    const url = req.nextUrl.clone();
    url.pathname = to;
    url.search = '';
    return NextResponse.redirect(url);
  };

  if (!session) return redirect('/login');
  if (!allowed.includes(session.role)) return redirect(ROLE_HOME[session.role] ?? '/owner/login');
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/owner/:path*', '/manager/:path*', '/vet/:path*', '/auditor/:path*', '/worker/:path*'],
};
