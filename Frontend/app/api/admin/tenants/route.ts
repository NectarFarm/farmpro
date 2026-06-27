import { db } from '@/db';
import { tenants, users, batches, workerProfiles } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { hashSecret } from '@/lib/server/crypto';
import { DEFAULT_WORKER_FIELDS, DEFAULT_WORKER_MODULES } from '@/lib/workerFields';
import { deleteTenantData } from '@/lib/server/tenantAdmin';
import { audit, actorLabel } from '@/lib/server/audit';
import { getActivePackages } from '@/lib/server/packagesConfig';
import { packageFeatures } from '@/lib/packages';
import { ok, created, unauthorized, forbidden, badRequest } from '@/lib/server/http';

const sid = (p: string) => `${p}_${crypto.randomUUID().slice(0, 8)}`;

// GET /api/admin/tenants — every farm + plan/features/counts (super_admin only).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const [ts, us, bs] = await Promise.all([
    db.select().from(tenants),
    db.select({ id: users.id, tenantId: users.tenantId, role: users.role }).from(users),
    db.select({ id: batches.id, tenantId: batches.tenantId }).from(batches),
  ]);
  return ok(ts.map((t) => ({
    id: t.id, name: t.name, plan: t.plan, features: t.features, active: t.active,
    users: us.filter((u) => u.tenantId === t.id).length,
    workers: us.filter((u) => u.tenantId === t.id && u.role === 'worker').length,
    batches: bs.filter((b) => b.tenantId === t.id).length,
  })));
}

// POST /api/admin/tenants — onboard a new farm: create the tenant + its owner login.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const body = (await req.json().catch(() => ({}))) as {
    farmName?: string; ownerName?: string; ownerEmail?: string; ownerPassword?: string; ownerPhone?: string; plan?: string;
  };
  const farmName = body.farmName?.trim();
  const ownerName = body.ownerName?.trim();
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  const ownerPassword = body.ownerPassword ?? '';
  const ownerPhone = body.ownerPhone?.trim() || `+0${crypto.randomUUID().replace(/\D/g, '').slice(0, 11)}`;

  if (!farmName || !ownerName || !ownerEmail) return badRequest('Farm name, owner name and owner email are required.');
  if (!ownerEmail.includes('@')) return badRequest('Enter a valid owner email.');
  if (ownerPassword.length < 8) return badRequest('Owner password must be at least 8 characters.');

  const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).limit(1);
  if (clash) return badRequest('That owner email is already in use.');

  // Assign an admin-defined package (default to pro / first available).
  const pkgs = await getActivePackages();
  const plan = pkgs.some((p) => p.id === body.plan) ? body.plan! : (pkgs.find((p) => p.id === 'pro')?.id ?? pkgs[0].id);
  const tenantId = sid('t');
  await db.insert(tenants).values({ id: tenantId, name: farmName, plan, features: packageFeatures(pkgs, plan) });
  await db.insert(users).values({
    id: sid('u'), tenantId, name: ownerName, email: ownerEmail, phone: ownerPhone, role: 'owner', language: 'en',
    passwordHash: await hashSecret(ownerPassword),
  });
  // Seed a default worker profile so the owner has something to assign & edit
  // from day one (Worker Config is otherwise empty on a brand-new farm).
  await db.insert(workerProfiles).values({
    id: sid('wp'), tenantId, name: 'Standard Worker', fields: DEFAULT_WORKER_FIELDS,
    modules: DEFAULT_WORKER_MODULES, mortalityPhotoThreshold: 1, alertThresholds: {},
  });
  await audit({ tenantId, actor: actorLabel(session), action: 'tenant.create', entity: farmName, after: { plan, ownerEmail } });
  return created({ id: tenantId, name: farmName, plan, ownerEmail });
}

// PATCH /api/admin/tenants?id=... { name?, plan?, features?, active? } (super_admin).
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const body = (await req.json().catch(() => ({}))) as { name?: string; plan?: string; features?: string[]; active?: boolean };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.plan === 'string') patch.plan = body.plan;
  if (Array.isArray(body.features)) patch.features = body.features;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (Object.keys(patch).length === 0) return badRequest('Nothing to update.');
  await db.update(tenants).set(patch).where(eq(tenants.id, id));
  const action = 'active' in patch ? (patch.active ? 'tenant.reactivate' : 'tenant.suspend') : 'tenant.update';
  await audit({ tenantId: id, actor: actorLabel(session), action, meta: patch });
  return ok({ id });
}

// DELETE /api/admin/tenants?id=... — permanently remove a farm and all its data.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  // Record the deletion BEFORE wiping data — this audit row deliberately survives.
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, id)).limit(1);
  await audit({ tenantId: id, actor: actorLabel(session), action: 'tenant.delete', entity: t?.name ?? id, meta: { id } });
  await deleteTenantData(id);
  await db.delete(tenants).where(eq(tenants.id, id));
  return ok({ id, deleted: true });
}
