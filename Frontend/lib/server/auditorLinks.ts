import 'server-only';
import { db } from '@/db';
import { auditorLinks } from '@/db/schemas';
import { and, eq, isNull } from 'drizzle-orm';
import { signToken, verifyToken } from './crypto';
import { getServerEnv } from '@/lib/env';

export const MAX_AUDITOR_LINK_DAYS = 14;

interface LinkPayload {
  linkId: string;
  tenantId: string;
  role: 'auditor';
  email?: string;
  exp: number;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function issueAuditorLink(opts: {
  tenantId: string;
  createdBy: string;
  email?: string;
  days?: number;
  origin: string;
}): Promise<{ url: string; expiresInDays: number; linkId: string }> {
  const days = Math.min(Math.max(Number(opts.days) || 7, 1), MAX_AUDITOR_LINK_DAYS);
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const linkId = crypto.randomUUID();
  const { SESSION_SECRET } = getServerEnv();
  const token = await signToken(
    { linkId, tenantId: opts.tenantId, role: 'auditor' as const, email: opts.email ?? '', exp },
    SESSION_SECRET,
  );
  const tokenHash = await sha256Hex(token);
  await db.insert(auditorLinks).values({
    id: linkId,
    tenantId: opts.tenantId,
    tokenHash,
    email: opts.email ?? null,
    createdBy: opts.createdBy,
    expiresAt: new Date(exp * 1000),
    revokedAt: null,
  });
  return {
    url: `${opts.origin}/api/auditor/enter?token=${encodeURIComponent(token)}`,
    expiresInDays: days,
    linkId,
  };
}

export async function consumeAuditorLink(token: string): Promise<LinkPayload | null> {
  const { SESSION_SECRET } = getServerEnv();
  const payload = await verifyToken<LinkPayload>(token, SESSION_SECRET);
  if (!payload || payload.role !== 'auditor' || !payload.linkId || !payload.exp) return null;
  if (payload.exp * 1000 < Date.now()) return null;

  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select()
    .from(auditorLinks)
    .where(and(
      eq(auditorLinks.id, payload.linkId),
      eq(auditorLinks.tenantId, payload.tenantId),
      eq(auditorLinks.tokenHash, tokenHash),
      isNull(auditorLinks.revokedAt),
    ))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return payload;
}

export async function revokeAuditorLink(tenantId: string, linkId: string): Promise<boolean> {
  const updated = await db
    .update(auditorLinks)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(auditorLinks.id, linkId),
      eq(auditorLinks.tenantId, tenantId),
      isNull(auditorLinks.revokedAt),
    ))
    .returning({ id: auditorLinks.id });
  return updated.length > 0;
}

export async function listAuditorLinks(tenantId: string) {
  return db
    .select({
      id: auditorLinks.id,
      email: auditorLinks.email,
      createdBy: auditorLinks.createdBy,
      expiresAt: auditorLinks.expiresAt,
      revokedAt: auditorLinks.revokedAt,
      createdAt: auditorLinks.createdAt,
    })
    .from(auditorLinks)
    .where(eq(auditorLinks.tenantId, tenantId));
}
