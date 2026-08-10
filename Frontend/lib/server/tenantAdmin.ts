import 'server-only';
import { db } from '@/db';
import { eq } from 'drizzle-orm';
import {
  users, workerProfiles, employees, productionUnits, batches, inventoryItems, inventoryLots,
  tasks, alerts, sales, purchases, records, conflictLog, feedingRecords, mortalityRecords,
  productionRecords, healthRecords, laborLogs, overheads, alertRules, products, photos,
  closingStockCounts, feedFormulas, testRuns, testPhotos, auditorLinks, payslips, employeeLedger,
  physicalCounts, weightSamples, observations, lifecycleStages, batchStageEvents,
  productionBackfillReport,
} from '@/db/schemas';

// Every tenant-scoped table (all carry tenant_id). The tenants row itself is
// deleted by the caller after this clears the dependent data.
// NOTE: auditLog is intentionally EXCLUDED — the audit trail must outlive a farm
// so there's a forensic record of what happened to it (including its deletion).
// NOTE: productionBackfillReport IS included, like conflictLog — it's an
// operational artefact of a migration run, but its rows carry a real
// per-tenant tenantId (0039) and are meaningless once that tenant is gone, so
// deletion should not orphan them (the exact bug class #36 exists to fix).
const TENANT_TABLES = [
  feedingRecords, mortalityRecords, productionRecords, healthRecords, laborLogs, closingStockCounts,
  feedFormulas, records, conflictLog, alerts, alertRules, tasks, sales, purchases,
  products, photos, inventoryLots, inventoryItems, overheads, batches, productionUnits,
  employees, workerProfiles, testRuns, testPhotos, users, auditorLinks, payslips, employeeLedger,
  physicalCounts, weightSamples, observations, lifecycleStages, batchStageEvents,
  productionBackfillReport,
];

// Permanently remove all data belonging to a tenant (irreversible).
export async function deleteTenantData(tenantId: string): Promise<void> {
  for (const table of TENANT_TABLES) {
    // every table in the list has a tenantId column
    await db.delete(table).where(eq((table as typeof users).tenantId, tenantId));
  }
}
