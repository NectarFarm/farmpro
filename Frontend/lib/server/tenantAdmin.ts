import 'server-only';
import { db } from '@/db';
import { eq } from 'drizzle-orm';
import { deletePhoto, isStorageConfigured } from '@/lib/server/storage';
import {
  users, workerProfiles, employees, productionUnits, batches, inventoryItems, inventoryLots,
  tasks, alerts, sales, purchases, records, conflictLog, feedingRecords, mortalityRecords,
  productionRecords, healthRecords, laborLogs, overheads, alertRules, products, photos,
  closingStockCounts, feedFormulas, testRuns, testPhotos, auditorLinks, payslips, employeeLedger,
  physicalCounts, weightSamples, observations, lifecycleStages, batchStageEvents,
  productionBackfillReport, productionRecoveryReport, processingEvents, errorLogs,
} from '@/db/schemas';

// Every tenant-scoped table (all carry tenant_id). The tenants row itself is
// deleted by the caller after this clears the dependent data.
// NOTE: auditLog is intentionally EXCLUDED — the audit trail must outlive a farm
// so there's a forensic record of what happened to it (including its deletion).
// NOTE: productionBackfillReport and productionRecoveryReport ARE included,
// like conflictLog — both are operational artefacts (of the 0039 backfill and
// of scripts/recoverProductionConflicts.ts respectively) but their rows carry
// a real per-tenant tenantId and are meaningless once that tenant is gone, so
// deletion should not orphan them (the exact bug class #36 exists to fix).
//
// ORDER MATTERS (#36 / #40): once composite (tenant_id, id) foreign keys land
// (#40), a row that references another row (e.g. mortalityRecords.batchId ->
// batches.id) must be deleted BEFORE the row it references, or the delete is
// rejected with a FK violation. So this list is a topological order derived
// from the *_id-shaped columns in db/schemas/index.ts — not alphabetical or
// historical accident:
//   - batchId       -> batches
//   - unitId        -> productionUnits
//   - itemId/lotId  -> inventoryItems / inventoryLots (inventoryLots itself
//                      references inventoryItems, so it precedes it too)
//   - employeeId    -> employees
//   - workerProfileId -> workerProfiles
//   - photoId       -> photos (mortalityRecords.photoId)
//   - productId     -> products (productionRecords.productId; already an
//                      explicit .references(..., { onDelete: 'restrict' }))
// Tables with no tenant-scoped FK-shaped relationship to anything else in this
// list are pure leaves and are grouped first — their position among
// themselves doesn't matter.
const TENANT_TABLES = [
  // Leaves: nothing else in this list references these.
  records, conflictLog, alerts, alertRules, overheads, feedFormulas, testRuns, testPhotos,
  auditorLinks, productionBackfillReport, productionRecoveryReport, errorLogs, lifecycleStages,

  // Batch/unit-scoped history — deleted before the batches/products/photos they reference.
  batchStageEvents, mortalityRecords, weightSamples, observations, physicalCounts,
  healthRecords, feedingRecords, laborLogs, sales, tasks, productionRecords,

  // products.batchId -> batches; productionRecords.productId -> products (above them).
  products,
  // batches.unitId -> productionUnits.
  batches,
  productionUnits,
  // photos: referenced by mortalityRecords.photoId (deleted above).
  photos,

  // Inventory: purchases/closingStockCounts/processingEvents/healthRecords/feedingRecords
  // (above) reference items/lots; inventoryLots itself references inventoryItems.
  closingStockCounts, purchases, processingEvents, inventoryLots, inventoryItems,

  // Payroll: payslips/employeeLedger reference employees; employees/users reference workerProfiles.
  payslips, employeeLedger, employees, users, workerProfiles,
];

// Collect R2 storage keys for a tenant's photo rows (both worker-captured
// photos and UAT test screenshots — both are stored in R2 under a
// "<tenantId>/..." key prefix when configured, per storageKey in db/schemas).
async function collectStorageKeys(tenantId: string): Promise<string[]> {
  const [photoRows, testPhotoRows] = await Promise.all([
    db.select({ storageKey: photos.storageKey }).from(photos).where(eq(photos.tenantId, tenantId)),
    db.select({ storageKey: testPhotos.storageKey }).from(testPhotos).where(eq(testPhotos.tenantId, tenantId)),
  ]);
  return [...photoRows, ...testPhotoRows]
    .map((r) => r.storageKey)
    .filter((k): k is string => !!k);
}

// Permanently remove all data belonging to a tenant (irreversible).
export async function deleteTenantData(tenantId: string): Promise<void> {
  // Read the R2 keys BEFORE the rows disappear, so we still know what to clean
  // up in R2 afterward.
  const storageKeys = await collectStorageKeys(tenantId);

  // The whole per-table wipe is one transaction: if any table's delete throws
  // partway through (e.g. a future FK violation once #40 lands, or a
  // connection drop), Postgres rolls back everything above it too — the
  // tenant is left exactly as it was, never half-deleted. The caller sees the
  // thrown error and the tenant row itself (deleted separately, after this
  // resolves) is untouched.
  await db.transaction(async (tx) => {
    for (const table of TENANT_TABLES) {
      // every table in the list has a tenantId column
      await tx.delete(table).where(eq((table as typeof users).tenantId, tenantId));
    }
  });

  // R2 object deletion happens AFTER the transaction commits, deliberately —
  // not before. A blob delete cannot participate in the SQL transaction above
  // (R2 has no two-phase commit with Postgres), so one of the two orderings
  // has to risk being wrong on a mid-process failure:
  //   - delete blobs first, then run the DB transaction: if the transaction
  //     then fails and rolls back, the DB rows (and the farm) survive but
  //     now point at blobs that are already gone — an UNRECOVERABLE loss of
  //     photo data with no way to tell it happened.
  //   - run the DB transaction first, then delete blobs (chosen here): if the
  //     process dies before/during the blob deletes, the DB is already
  //     correctly wiped and the blobs are merely leaked. Every key is
  //     prefixed "<tenantId>/...", so a later sweep (list-by-prefix against
  //     the bucket, e.g. a scheduled job) can always find and remove
  //     leftovers for a deleted tenant, even with zero DB rows left to
  //     consult. Leaked-but-findable beats deleted-but-orphaned.
  // Best-effort: failures are logged, not thrown — the tenant's data is
  // already correctly gone from Postgres, and a stray blob is an operational
  // cleanup issue, not a data-integrity one on this path.
  if (storageKeys.length && isStorageConfigured()) {
    const results = await Promise.allSettled(storageKeys.map((key) => deletePhoto(key)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      console.error(
        `deleteTenantData(${tenantId}): failed to delete ${failed}/${storageKeys.length} R2 object(s); ` +
        `they are orphaned under the "${tenantId}/" prefix and need a sweep/manual cleanup.`,
      );
    }
  }
}
