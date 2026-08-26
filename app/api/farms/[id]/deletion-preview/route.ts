import { NextResponse } from 'next/server'
import { and, count, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { farms, productionUnits, batches, records, tasks, inventoryLots, employees, routines } from '@/db/schemas'
import { requireRole } from '@/lib/api-auth'

// ── GET /api/farms/[id]/deletion-preview (super_admin) ─────────────────────
// What DELETE ?cascade=true would actually destroy, counted, without
// destroying it. The point is that an admin confirms against real numbers
// rather than a generic "are you sure?" — deleting a farm with 4 batches and
// 900 records is a different decision from deleting an empty duplicate, and
// the dialog should be able to say which one this is.
//
// Deliberately separates the two outcomes, because they are not the same
// promise: `deletes` is gone forever, `detaches` keeps the row and only clears
// its farmId. Staff, stock, tasks and routines belong to the tenant, not to
// one farm, so removing a farm must not take an employee record with it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(['super_admin'])
  if ('error' in auth) return auth.error
  const { id } = await params

  const farmRows = await db.select().from(farms).where(eq(farms.id, id)).limit(1)
  const farm = farmRows[0]
  if (!farm) return NextResponse.json({ success: false, error: 'Farm not found' }, { status: 404 })

  const units = await db.select({ id: productionUnits.id }).from(productionUnits).where(eq(productionUnits.farmId, id))
  const unitIds = units.map((u) => u.id)
  const batchRows = unitIds.length
    ? await db.select({ id: batches.id }).from(batches).where(inArray(batches.unitId, unitIds))
    : []
  const batchIds = batchRows.map((b) => b.id)

  const [recordCount] = batchIds.length
    ? await db.select({ n: count() }).from(records).where(inArray(records.batchId, batchIds))
    : [{ n: 0 }]
  const [taskCount] = await db.select({ n: count() }).from(tasks).where(and(eq(tasks.tenantId, farm.tenantId), eq(tasks.farmId, id)))
  const [lotCount] = await db.select({ n: count() }).from(inventoryLots).where(eq(inventoryLots.farmId, id))
  const [employeeCount] = await db.select({ n: count() }).from(employees).where(eq(employees.farmId, id))
  const [routineCount] = await db.select({ n: count() }).from(routines).where(eq(routines.farmId, id))

  return NextResponse.json({
    success: true,
    data: {
      farm: { id: farm.id, name: farm.name, code: farm.code },
      deletes: {
        productionUnits: unitIds.length,
        batches: batchIds.length,
        records: Number(recordCount?.n ?? 0),
      },
      detaches: {
        tasks: Number(taskCount?.n ?? 0),
        inventoryLots: Number(lotCount?.n ?? 0),
        employees: Number(employeeCount?.n ?? 0),
        routines: Number(routineCount?.n ?? 0),
      },
      // An empty farm needs no cascade — the plain delete already handles it.
      cascadeRequired: unitIds.length > 0,
    },
  }, { status: 200 })
}
