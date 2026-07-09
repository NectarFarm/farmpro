import { db } from '@/db';
import { users } from '@/db/schemas';
import { and, eq, ne } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { hashSecret } from '@/lib/server/crypto';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, unauthorized, forbidden, badRequest, notFound } from '@/lib/server/http';
import { MIN_PASSWORD_LENGTH } from '@/lib/server/validate';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';

// Manage a farm's owner login (super_admin): fix typos, change email/phone, reset password.
async function ownerOf(tenantId: string) {
  const [owner] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, 'owner'))).limit(1);
  return owner;
}

export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const tenantId = new URL(req.url).searchParams.get('tenantId');
  if (!tenantId) return badRequest('tenantId required');
  const owner = await ownerOf(tenantId);
  if (!owner) return notFound('No owner for this farm.');
  return ok({ id: owner.id, name: owner.name, email: owner.email, phone: owner.phone });
}

// PATCH /api/admin/owner?tenantId=... { name?, email?, phone?, newPassword? }
export async function PATCH(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const tenantId = new URL(req.url).searchParams.get('tenantId');
  if (!tenantId) return badRequest('tenantId required');
  const owner = await ownerOf(tenantId);
  if (!owner) return notFound('No owner for this farm.');

  const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string; phone?: string; newPassword?: string };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.phone === 'string' && body.phone.trim()) patch.phone = body.phone.trim();
  if (typeof body.email === 'string' && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!email.includes('@')) return badRequest('Enter a valid email.');
    const [clash] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, owner.id))).limit(1);
    if (clash) return badRequest('That email is already in use.');
    patch.email = email;
  }
  if (typeof body.newPassword === 'string' && body.newPassword.length > 0) {
    if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
      return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    patch.passwordHash = await hashSecret(body.newPassword);
  }
  if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
  await db.update(users).set(patch).where(eq(users.id, owner.id));
  // Record which fields changed — never the password value itself.
  await audit({ tenantId, actor: actorLabel(session), action: 'owner.update', entity: owner.email ?? owner.id, meta: { changed: Object.keys(patch).map((k) => (k === 'passwordHash' ? 'password' : k)) } });
  return ok({ id: owner.id });
}
