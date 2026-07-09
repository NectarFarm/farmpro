import { db } from '@/db';
import { employees, users } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { hashSecret } from '@/lib/server/crypto';
import { ok, created, unauthorized, forbidden, notFound, badRequest, tooMany } from '@/lib/server/http';
import { parseBody, createEmployeeSchema, updateEmployeeSchema, MIN_PASSWORD_LENGTH } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { checkWriteRateLimit } from '@/lib/server/rateLimit';

// POST /api/data/employees — create, with optional login (PIN for worker, email+password for mgr/vet).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  if (session.role !== 'owner') return forbidden();

  const parsed = await parseBody(req, createEmployeeSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const id = crypto.randomUUID();

  const role = body.role;
  const phone = body.phone;
  const email = body.email?.trim().toLowerCase() ?? null;
  const profileId = body.workerProfileId ?? null;
  const pin = body.pin.trim();
  const password = body.password;
  let pinHash: string | null = null, passwordHash: string | null = null;

  if (role === 'worker' && pin) pinHash = await hashSecret(pin);
  if (role !== 'worker' && (email || password)) {
    if (!email) return badRequest('Email is required for a manager/vet login.');
    if (password.length < MIN_PASSWORD_LENGTH) return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    passwordHash = await hashSecret(password);
  }

  const makeLogin = !!(pinHash || passwordHash);
  if (makeLogin) {
    const [dupPhone] = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (dupPhone) return badRequest('That phone number already has a login.');
    if (email) {
      const [dupEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (dupEmail) return badRequest('That email already has a login.');
    }
  }

  try {
    await db.transaction(async (tx) => {
      const salaryVal = Math.max(0, body.salary ?? 0);
      await tx.insert(employees).values({
        id, tenantId: session.tenantId, name: body.name, phone,
        role, workerProfileId: profileId, pinSet: !!pinHash, active: true,
        salary: salaryVal, salaryCents: toCents(salaryVal),
        payDay: body.payDay ?? null, paymentsFrom: body.paymentsFrom ?? null,
        assignedBatchIds: body.assignedBatchIds ?? null,
      });
      if (makeLogin) {
        await tx.insert(users).values({
          id: crypto.randomUUID(), tenantId: session.tenantId, name: body.name, phone, email,
          role, workerProfileId: role === 'worker' ? profileId : null, language: 'en', pinHash, passwordHash,
        });
      }
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return badRequest('That phone number or email already has a login.');
    throw e;
  }
  return created({ id });
}

// PATCH /api/data/employees?id=... — update employee + optionally sync user login.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  const writeLimit = checkWriteRateLimit(req);
  if (!writeLimit.allowed) return tooMany(`Too many requests.`, writeLimit.retryAfter);
  if (session.role !== 'owner') return forbidden();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const tid = session.tenantId;

  const parsed = await parseBody(req, updateEmployeeSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.role !== undefined) patch.role = body.role;
  if (body.active !== undefined) patch.active = body.active;
  if (body.salary !== undefined) {
    patch.salary = Math.max(0, body.salary);
    patch.salaryCents = toCents(Math.max(0, body.salary));
  }
  if ('payDay' in body) patch.payDay = body.payDay ?? null;
  if ('paymentsFrom' in body) patch.paymentsFrom = body.paymentsFrom ?? null;
  if ('assignedBatchIds' in body) patch.assignedBatchIds = body.assignedBatchIds ?? null;
  if ('workerProfileId' in body) patch.workerProfileId = body.workerProfileId ?? null;

  const pin = body.pin.trim();
  const password = body.password;
  const wantCreds = !!(pin || password);
  if (Object.keys(patch).length === 0 && !wantCreds) return badRequest('Nothing to update.');

  const needUser = wantCreds || 'workerProfileId' in body || 'name' in body || 'role' in body;
  let emp: { phone: string; name: string; role: string; workerProfileId: string | null } | undefined;
  if (needUser) {
    [emp] = await db.select({ phone: employees.phone, name: employees.name, role: employees.role, workerProfileId: employees.workerProfileId })
      .from(employees).where(and(eq(employees.tenantId, tid), eq(employees.id, id))).limit(1);
    if (!emp) return notFound();
  }

  if (wantCreds && emp) {
    const role = body.role ?? emp.role;
    let pinHash: string | undefined, passwordHash: string | undefined;
    if (pin) { pinHash = await hashSecret(pin); patch.pinSet = true; }
    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH) return badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      passwordHash = await hashSecret(password);
    }
    const email = body.email?.trim().toLowerCase() ?? null;
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tid), eq(users.phone, emp.phone))).limit(1);
    if (u) {
      const uset: Record<string, unknown> = {};
      if (pinHash !== undefined) uset.pinHash = pinHash;
      if (passwordHash !== undefined) uset.passwordHash = passwordHash;
      await db.update(users).set(uset).where(eq(users.id, u.id));
    } else {
      if (passwordHash && !email) return badRequest('Email is required for a manager/vet login.');
      try {
        await db.insert(users).values({
          id: crypto.randomUUID(), tenantId: tid, name: emp.name, phone: emp.phone, email,
          role, workerProfileId: emp.workerProfileId ?? null, language: 'en',
          pinHash: pinHash ?? null, passwordHash: passwordHash ?? null,
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return badRequest('That phone number or email already has a login.');
        throw e;
      }
    }
  }

  await db.update(employees).set(patch).where(and(eq(employees.tenantId, tid), eq(employees.id, id)));

  if (emp && ('workerProfileId' in body || 'name' in body || 'role' in body)) {
    const usync: Record<string, unknown> = {};
    if (body.name !== undefined) usync.name = body.name;
    if (body.role !== undefined) usync.role = body.role;
    if ('workerProfileId' in body) usync.workerProfileId = body.workerProfileId ?? null;
    if (Object.keys(usync).length) await db.update(users).set(usync).where(and(eq(users.tenantId, tid), eq(users.phone, emp.phone)));
  }
  return ok({ id });
}
