import { db } from '@/db';
import {
  users, workerProfiles, employees, payslips, employeeLedger,
  productionUnits, batches, batchStageEvents, inventoryItems, inventoryLots,
  tasks, sales, purchases, records,
} from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { unauthorized, forbidden, serverError } from '@/lib/server/http';
import { readRateLimited } from '@/lib/server/rateLimit';
import { audit, actorLabel } from '@/lib/server/audit';

// GET /api/backup/export — owner-only JSON dump of the tenant's core data.
// Supplementary safety net: this is a manual, on-demand export, NOT a
// substitute for Neon's own point-in-time-recovery retention — verify that
// separately in the Neon dashboard. Owner-only (not manager/auditor) because
// it includes payroll (payslips, employeeLedger) unredacted. Login credentials
// (passwordHash/pinHash) are excluded even from the owner's own export — see
// the users query below.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;

  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();

  try {
    const tenantId = session.tenantId;
    const [
      usersRows, workerProfilesRows, employeesRows, payslipsRows, employeeLedgerRows,
      productionUnitsRows, batchesRows, batchStageEventsRows, inventoryItemsRows, inventoryLotsRows,
      tasksRows, salesRows, purchasesRows, recordsRows,
    ] = await Promise.all([
      // Never export passwordHash/pinHash: a downloaded file is far more likely to
      // end up somewhere insecure (email, USB, personal cloud drive) than the DB
      // itself, and worker PINs are low-entropy enough to be crackable offline
      // from a leaked hash even at 100k PBKDF2 iterations.
      db.select({
        id: users.id, tenantId: users.tenantId, name: users.name, phone: users.phone,
        email: users.email, role: users.role, workerProfileId: users.workerProfileId,
        language: users.language,
      }).from(users).where(eq(users.tenantId, tenantId)),
      db.select().from(workerProfiles).where(eq(workerProfiles.tenantId, tenantId)),
      db.select().from(employees).where(eq(employees.tenantId, tenantId)),
      db.select().from(payslips).where(eq(payslips.tenantId, tenantId)),
      db.select().from(employeeLedger).where(eq(employeeLedger.tenantId, tenantId)),
      db.select().from(productionUnits).where(eq(productionUnits.tenantId, tenantId)),
      db.select().from(batches).where(eq(batches.tenantId, tenantId)),
      db.select().from(batchStageEvents).where(eq(batchStageEvents.tenantId, tenantId)),
      db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)),
      db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId)),
      db.select().from(tasks).where(eq(tasks.tenantId, tenantId)),
      db.select().from(sales).where(eq(sales.tenantId, tenantId)),
      db.select().from(purchases).where(eq(purchases.tenantId, tenantId)),
      db.select().from(records).where(eq(records.tenantId, tenantId)),
    ]);

    const data = {
      users: usersRows,
      workerProfiles: workerProfilesRows,
      employees: employeesRows,
      payslips: payslipsRows,
      employeeLedger: employeeLedgerRows,
      productionUnits: productionUnitsRows,
      batches: batchesRows,
      batchStageEvents: batchStageEventsRows,
      inventoryItems: inventoryItemsRows,
      inventoryLots: inventoryLotsRows,
      tasks: tasksRows,
      sales: salesRows,
      purchases: purchasesRows,
      records: recordsRows,
    };

    await audit({
      tenantId: session.tenantId,
      actor: actorLabel(session),
      action: 'backup.export',
      meta: { tableCount: Object.keys(data).length },
    });

    const body = JSON.stringify({ exportedAt: new Date().toISOString(), tenantId, data }, null, 2);
    const filename = `ifms-backup-${tenantId}-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return serverError('Backup export failed. Please try again.');
  }
}
