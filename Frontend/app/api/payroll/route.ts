import { db } from '@/db';
import { employees, payslips, employeeLedger } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, created, badRequest, unauthorized, forbidden } from '@/lib/server/http';
import { parseBody, payrollActionSchema } from '@/lib/server/validate';
import { toCents } from '@/lib/server/money';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';
import { computePayslip, validPeriod, currentPeriod, type LedgerEntry, type LedgerType } from '@/lib/payslip';

const ALLOWED = ['owner', 'manager'];
const LEDGER_TYPES: LedgerType[] = ['advance', 'fine', 'bonus', 'adjustment'];

async function slipFor(tenantId: string, employeeId: string, period: string) {
  const [s] = await db.select().from(payslips)
    .where(and(eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId), eq(payslips.period, period))).limit(1);
  return s ?? null;
}
async function ledgerFor(tenantId: string, employeeId: string, period: string) {
  return db.select().from(employeeLedger)
    .where(and(eq(employeeLedger.tenantId, tenantId), eq(employeeLedger.employeeId, employeeId), eq(employeeLedger.period, period)));
}
const asEntries = (rows: { type: string; amount: number }[]): LedgerEntry[] => rows.map((r) => {
  const type = LEDGER_TYPES.includes(r.type as LedgerType) ? (r.type as LedgerType) : 'adjustment';
  return { type, amount: r.amount };
});

// GET /api/payroll?period=YYYY-MM — every employee with their payslip (if any),
// a LIVE preview of what they'd be paid, and the month's ledger entries.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tenantId = session.tenantId;
  const period = new URL(req.url).searchParams.get('period') || currentPeriod(new Date());
  if (!validPeriod(period)) return badRequest('Invalid period (use YYYY-MM).');

  const emps = await db.select().from(employees).where(eq(employees.tenantId, tenantId));
  const out = [];
  let totGross = 0, totNet = 0, totFines = 0, paidCount = 0;
  for (const e of emps) {
    const slip = await slipFor(tenantId, e.id, period);
    const ledger = await ledgerFor(tenantId, e.id, period);
    const preview = computePayslip(e.salary, asEntries(ledger));
    const eligible = e.active && e.salary > 0 && (!e.paymentsFrom || e.paymentsFrom <= period);
    out.push({
      id: e.id, name: e.name, role: e.role, salary: e.salary, active: e.active, paymentsFrom: e.paymentsFrom, eligible,
      payslip: slip ? { gross: slip.gross, advances: slip.advances, fines: slip.fines, bonuses: slip.bonuses, net: slip.net, status: slip.status, paidAt: slip.paidAt } : null,
      preview,
      ledger: ledger.map((l) => ({ id: l.id, type: l.type, amount: l.amount, note: l.note, date: l.date })),
    });
    if (slip) { totGross += slip.gross; totNet += slip.net; totFines += slip.fines; if (slip.status === 'paid') paidCount++; }
  }
  return ok({ period, employees: out, summary: { gross: Math.round(totGross * 100) / 100, net: Math.round(totNet * 100) / 100, fines: Math.round(totFines * 100) / 100, paid: paidCount, withSlip: out.filter((o) => o.payslip).length } });
}

// POST /api/payroll  { action: 'run'|'pay'|'ledger'|'deleteLedger', ... }
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (!ALLOWED.includes(session.role)) return forbidden();
  const tenantId = session.tenantId;
  const parsed = await parseBody(req, payrollActionSchema);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const now = new Date().toISOString();
  const { audit, actorLabel } = await import('@/lib/server/audit');

  if (body.action === 'run') {
    const period = body.period || currentPeriod(new Date());
    if (!validPeriod(period)) return badRequest('Invalid period.');
    const emps = await db.select().from(employees).where(eq(employees.tenantId, tenantId));
    let generated = 0;
    for (const e of emps) {
      if (!(e.active && e.salary > 0 && (!e.paymentsFrom || e.paymentsFrom <= period))) continue;
      const existing = await slipFor(tenantId, e.id, period);
      if (existing?.status === 'paid') continue; // locked — never rewrite a disbursed month
      const b = computePayslip(e.salary, asEntries(await ledgerFor(tenantId, e.id, period)));
      const slipVals = {
        gross: b.gross, grossCents: toCents(b.gross),
        advances: b.advances, advancesCents: toCents(b.advances),
        fines: b.fines, finesCents: toCents(b.fines),
        bonuses: b.bonuses, bonusesCents: toCents(b.bonuses),
        net: b.net, netCents: toCents(b.net),
      };
      if (existing) {
        await db.update(payslips).set(slipVals)
          .where(eq(payslips.id, existing.id));
      } else {
        // Two concurrent `run` requests can both see "no existing slip" and both
        // reach this branch — the unique (tenantId, employeeId, period) constraint
        // plus onConflictDoNothing makes only one INSERT win; the loser is a safe
        // no-op instead of creating a duplicate payslip row.
        await db.insert(payslips).values({
          id: crypto.randomUUID(), tenantId, employeeId: e.id, period,
          ...slipVals,
          status: 'pending', paidAt: null, createdAt: now,
        }).onConflictDoNothing({ target: [payslips.tenantId, payslips.employeeId, payslips.period] });
      }
      generated++;
    }
    await audit({ tenantId, actor: actorLabel(session), action: 'payroll.run', meta: { period, employees: generated } });
    return ok({ period, generated });
  }

  if (body.action === 'pay') {
    const period = body.period;
    if (!validPeriod(period)) return badRequest('Invalid period.');
    const where = body.employeeId
      ? and(eq(payslips.tenantId, tenantId), eq(payslips.period, period!), eq(payslips.employeeId, body.employeeId))
      : and(eq(payslips.tenantId, tenantId), eq(payslips.period, period!), eq(payslips.status, 'pending'));
    await db.update(payslips).set({ status: 'paid', paidAt: now }).where(where);
    await audit({ tenantId, actor: actorLabel(session), action: 'payroll.pay', meta: { period, employeeId: body.employeeId ?? 'all' } });
    return ok({ period, paid: true });
  }

  if (body.action === 'ledger') {
    const employeeId = body.employeeId!;
    const type = body.type!;
    const period = body.period!;
    const amount = body.amount!;
    const note = body.note ?? null;
    const clientUuid = body.clientUuid ?? null;
    if (!body.employeeId || !LEDGER_TYPES.includes(type)) return badRequest('employeeId and a valid type are required.');
    if (!validPeriod(period)) return badRequest('Invalid period.');
    if (!Number.isFinite(amount) || amount === 0) return badRequest('Enter an amount.');
    if (type !== 'adjustment' && amount < 0) return badRequest('Amount must be positive.');
    const [emp] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId))).limit(1);
    if (!emp) return badRequest('Unknown employee.');
    const slip = await slipFor(tenantId, employeeId, period);
    if (slip?.status === 'paid') return badRequest('That month is already paid and locked. Use the next month.');
    const row = { id: crypto.randomUUID(), tenantId, employeeId, type, amount, amountCents: toCents(amount), note, period, date: now.slice(0, 10), createdAt: now, clientUuid };
    const inserted = clientUuid
      ? await db.insert(employeeLedger).values(row).onConflictDoNothing({ target: employeeLedger.clientUuid }).returning({ id: employeeLedger.id })
      : await db.insert(employeeLedger).values(row).returning({ id: employeeLedger.id });
    if (slip) {
      const b = computePayslip(slip.gross, asEntries(await ledgerFor(tenantId, employeeId, period)));
      await db.update(payslips).set({
        advances: b.advances, advancesCents: toCents(b.advances),
        fines: b.fines, finesCents: toCents(b.fines),
        bonuses: b.bonuses, bonusesCents: toCents(b.bonuses),
        net: b.net, netCents: toCents(b.net),
      }).where(eq(payslips.id, slip.id));
    }
    if (inserted.length) {
      await audit({ tenantId, actor: actorLabel(session), action: `payroll.${type}`, entity: employeeId, meta: { period, amount } });
    }
    return created({ ok: true });
  }

  if (body.action === 'deleteLedger') {
    const ledgerId = body.ledgerId;
    if (!ledgerId) return badRequest('ledgerId required');
    const [entry] = await db.select().from(employeeLedger).where(and(eq(employeeLedger.tenantId, tenantId), eq(employeeLedger.id, ledgerId))).limit(1);
    if (!entry) return ok({ ok: true });
    const slip = await slipFor(tenantId, entry.employeeId, entry.period);
    if (slip?.status === 'paid') return badRequest('That month is already paid and locked.');
    await db.delete(employeeLedger).where(eq(employeeLedger.id, entry.id));
    if (slip) {
      const b = computePayslip(slip.gross, asEntries(await ledgerFor(tenantId, entry.employeeId, entry.period)));
      await db.update(payslips).set({
        advances: b.advances, advancesCents: toCents(b.advances),
        fines: b.fines, finesCents: toCents(b.fines),
        bonuses: b.bonuses, bonusesCents: toCents(b.bonuses),
        net: b.net, netCents: toCents(b.net),
      }).where(eq(payslips.id, slip.id));
    }
    return ok({ ok: true });
  }

  return badRequest('Unknown action.');
}
