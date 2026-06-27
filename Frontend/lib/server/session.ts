import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '@/lib/env';
import { signToken, verifyToken } from './crypto';
import type { Role } from '@/lib/types';

export const SESSION_COOKIE = 'ifms_session';
const MAX_AGE = 60 * 60 * 8; // 8h

export interface Session {
  userId: string;
  tenantId: string;
  role: Role;
  workerProfileId?: string;
  name: string;
  exp: number;
}

export async function createSession(s: Omit<Session, 'exp'>): Promise<void> {
  const { SESSION_SECRET, COOKIE_SECURE } = getServerEnv();
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const token = await signToken({ ...s, exp }, SESSION_SECRET);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<Session | null> {
  const { SESSION_SECRET } = getServerEnv();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifyToken<Session>(token, SESSION_SECRET);
  if (!session) return null;
  if (session.exp * 1000 < Date.now()) return null;
  return session;
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
