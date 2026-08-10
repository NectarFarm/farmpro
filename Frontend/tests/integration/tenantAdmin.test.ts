import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  productionUnits, batches, products, productionRecords, photos, mortalityRecords,
  processingEvents, errorLogs, alerts,
} from '@/db/schemas';
import { deleteTenantData } from '@/lib/server/tenantAdmin';

// #36: deleteTenantData must (1) actually clear processing_events and
// error_logs, (2) run as one transaction — a mid-way failure must leave the
// tenant untouched, not half-deleted, and (3) do it all against a REAL
// Postgres connection, because the whole point of "transactional" and "FK
// ordering" is about what the database itself enforces — a mocked drizzle
// client (see tests/unit/tenantAdmin.test.ts) can't exercise an actual
// rollback or a real foreign-key constraint.

describe('deleteTenantData against real Postgres (#36)', () => {
  describe('happy path', () => {
    const tenantId = `test-tenant-del-${Date.now()}`;
    const unitId = `${tenantId}-unit`;
    const batchId = `${tenantId}-batch`;
    const productId = `${tenantId}-product`;
    const photoId = `${tenantId}-photo`;

    afterAll(async () => {
      // Best-effort cleanup in case an assertion fails before deleteTenantData
      // runs (or it doesn't clear something, which is exactly what this test
      // exists to catch) — never leave rows behind either way.
      await Promise.all([
        db.delete(productionRecords).where(eq(productionRecords.tenantId, tenantId)),
        db.delete(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)),
        db.delete(processingEvents).where(eq(processingEvents.tenantId, tenantId)),
        db.delete(errorLogs).where(eq(errorLogs.tenantId, tenantId)),
        db.delete(photos).where(eq(photos.tenantId, tenantId)),
        db.delete(products).where(eq(products.tenantId, tenantId)),
        db.delete(batches).where(eq(batches.tenantId, tenantId)),
        db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId)),
      ]);
    });

    it('clears processing_events, error_logs, and a photo-referencing chain, in one pass', async () => {
      await db.insert(productionUnits).values({
        id: unitId, tenantId, farmId: 'farm-1', type: 'poultry', name: 'Unit 1', code: 'U1',
      });
      await db.insert(batches).values({
        id: batchId, tenantId, unitId, name: 'Batch 1', species: 'layers', source: 'purchased',
        acquiredDate: '2026-01-01', initialQty: 10, currentQty: 10, stage: 'grower',
      });
      await db.insert(products).values({ id: productId, tenantId, batchId, name: 'Eggs' });
      // `data` is nullable in the Drizzle schema (legacy base64 column, kept
      // for photos not migrated to R2) but the real DB column still has its
      // original NOT NULL constraint (no migration ever dropped it) — send a
      // placeholder so this test exercises deleteTenantData, not that drift.
      await db.insert(photos).values({ id: photoId, tenantId, data: '', storageKey: `${tenantId}/photo-a.jpg` });
      await db.insert(mortalityRecords).values({
        clientUuid: `${tenantId}-mort-1`, tenantId, batchId, count: 1, photoId,
        recordedBy: 'worker-1', capturedAt: '2026-01-02',
      });
      await db.insert(productionRecords).values({
        clientUuid: `${tenantId}-prod-1`, tenantId, batchId, type: 'eggs', qty: 5, productId,
        slotKey: 'morning', recordedBy: 'worker-1', capturedAt: '2026-01-02',
      });
      // The two tables #36 exists to fix.
      await db.insert(processingEvents).values({
        id: `${tenantId}-proc-1`, tenantId, inputItemId: 'maize', inputQty: 10,
        outputItemId: 'flour', outputQty: 9, recordedBy: 'worker-1', capturedAt: '2026-01-02',
      });
      await db.insert(errorLogs).values({ id: `${tenantId}-err-1`, tenantId, message: 'boom' });

      await deleteTenantData(tenantId);

      const [pu, b, p, ph, mr, pr, pe, el] = await Promise.all([
        db.select().from(productionUnits).where(eq(productionUnits.tenantId, tenantId)),
        db.select().from(batches).where(eq(batches.tenantId, tenantId)),
        db.select().from(products).where(eq(products.tenantId, tenantId)),
        db.select().from(photos).where(eq(photos.tenantId, tenantId)),
        db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId)),
        db.select().from(productionRecords).where(eq(productionRecords.tenantId, tenantId)),
        db.select().from(processingEvents).where(eq(processingEvents.tenantId, tenantId)),
        db.select().from(errorLogs).where(eq(errorLogs.tenantId, tenantId)),
      ]);
      expect(pu).toHaveLength(0);
      expect(b).toHaveLength(0);
      expect(p).toHaveLength(0);
      expect(ph).toHaveLength(0);
      expect(mr).toHaveLength(0);
      expect(pr).toHaveLength(0);
      expect(pe).toHaveLength(0);
      expect(el).toHaveLength(0);
    });
  });

  describe('rollback on a mid-transaction failure', () => {
    const tenantId = `test-tenant-del-rollback-${Date.now()}`;
    const otherTenantId = `test-tenant-del-rollback-other-${Date.now()}`;
    const unitId = `${tenantId}-unit`;
    const batchId = `${tenantId}-batch`;
    const productId = `${tenantId}-product`;
    const alertId = `${tenantId}-alert`;
    // productionRecords.productId is a real FK with onDelete: 'restrict'
    // (see db/schemas/index.ts, #22). A productionRecords row belonging to a
    // DIFFERENT tenant that references this tenant's product forces the
    // `products` delete step (which TENANT_TABLES runs after `alerts`, an
    // earlier/leaf table) to fail with a genuine Postgres FK violation —
    // proving the transaction rolls back everything already deleted in the
    // same call, not just that later steps get skipped.
    const foreignRecordUuid = `${otherTenantId}-prod-1`;

    afterAll(async () => {
      await db.delete(productionRecords).where(eq(productionRecords.clientUuid, foreignRecordUuid));
      await db.delete(alerts).where(eq(alerts.tenantId, tenantId));
      await db.delete(products).where(eq(products.tenantId, tenantId));
      await db.delete(batches).where(eq(batches.tenantId, tenantId));
      await db.delete(productionUnits).where(eq(productionUnits.tenantId, tenantId));
    });

    it('leaves the tenant fully intact when a later table delete violates a FK', async () => {
      await db.insert(productionUnits).values({
        id: unitId, tenantId, farmId: 'farm-1', type: 'poultry', name: 'Unit 1', code: 'U1',
      });
      await db.insert(batches).values({
        id: batchId, tenantId, unitId, name: 'Batch 1', species: 'layers', source: 'purchased',
        acquiredDate: '2026-01-01', initialQty: 10, currentQty: 10, stage: 'grower',
      });
      await db.insert(products).values({ id: productId, tenantId, batchId, name: 'Eggs' });
      // Deleted early (alerts is a leaf table, ordered before products) — this
      // is the row that proves rollback: if the transaction didn't roll back,
      // this would already be gone by the time products' RESTRICT trips.
      await db.insert(alerts).values({
        id: alertId, tenantId, severity: 'info', title: 'x', message: 'x', type: 'x',
        createdAt: '2026-01-02',
      });
      // A cross-tenant reference to this tenant's product — legal today because
      // there is no FK enforcing tenant isolation yet (that's #40); the plain
      // FK on productId alone still blocks deleting the product it points to.
      await db.insert(productionRecords).values({
        clientUuid: foreignRecordUuid, tenantId: otherTenantId, batchId: 'other-batch',
        type: 'eggs', qty: 1, productId, slotKey: 'morning', recordedBy: 'w', capturedAt: '2026-01-02',
      });

      await expect(deleteTenantData(tenantId)).rejects.toBeTruthy();

      // Rollback proof: the alerts row (deleted several steps before the
      // products step that failed) must still be present.
      const remainingAlerts = await db.select().from(alerts).where(eq(alerts.tenantId, tenantId));
      expect(remainingAlerts).toHaveLength(1);
      const remainingProducts = await db.select().from(products).where(eq(products.tenantId, tenantId));
      expect(remainingProducts).toHaveLength(1);
    });
  });
});
