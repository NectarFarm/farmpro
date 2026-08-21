import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import {
  approvalRequests, auditLog, batches, employees, farms, inventoryItems,
  inventoryLots, journalEntries, journalLines, notifications, products,
  productionUnits, purchases, sales, tasks, tenantSettings,
} from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'

// GET /api/security/backup — owner-only tenant export. It deliberately omits
// users, password/PIN hashes, session tokens and platform-level records.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'owner' || !user.tenantId) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  const tenantId = user.tenantId

  const [settings, farmRows, unitRows, batchRows, employeeRows, taskRows, productRows, notificationRows, itemRows, lotRows, purchaseRows, saleRows, approvalRows, auditRows, entryRows] = await Promise.all([
    db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)),
    db.select().from(farms).where(eq(farms.tenantId, tenantId)),
    db.select().from(productionUnits).where(eq(productionUnits.tenantId, tenantId)),
    db.select().from(batches).where(eq(batches.tenantId, tenantId)),
    db.select().from(employees).where(eq(employees.tenantId, tenantId)),
    db.select().from(tasks).where(eq(tasks.tenantId, tenantId)),
    db.select().from(products).where(eq(products.tenantId, tenantId)),
    db.select().from(notifications).where(eq(notifications.tenantId, tenantId)),
    db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)),
    db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId)),
    db.select().from(purchases).where(eq(purchases.tenantId, tenantId)),
    db.select().from(sales).where(eq(sales.tenantId, tenantId)),
    db.select().from(approvalRequests).where(eq(approvalRequests.tenantId, tenantId)),
    db.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)),
    db.select().from(journalEntries).where(eq(journalEntries.tenantId, tenantId)),
  ])
  const journalEntryIds = entryRows.map((entry) => entry.id)
  const lines = journalEntryIds.length ? await db.select().from(journalLines).where(inArray(journalLines.entryId, journalEntryIds)) : []
  const backup = { version: 1, exportedAt: new Date().toISOString(), tenantId, settings, farms: farmRows, units: unitRows, batches: batchRows, employees: employeeRows, tasks: taskRows, products: productRows, notifications: notificationRows, inventoryItems: itemRows, inventoryLots: lotRows, purchases: purchaseRows, sales: saleRows, approvals: approvalRows, auditLog: auditRows, journalEntries: entryRows, journalLines: lines }
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="ifms-${tenantId}-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
