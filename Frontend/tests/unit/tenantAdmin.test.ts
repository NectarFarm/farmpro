import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import * as schema from '@/db/schemas';

// #200: production_backfill_report carries a tenant_id column but was missing
// from TENANT_TABLES, so deleting a tenant orphaned its rows — a fresh
// instance of the bug class #36 exists to fix (TENANT_TABLES is hand-
// maintained and goes stale). Rather than hardcoding the one table name we
// just fixed, reflect over the schema for every table with a tenantId column
// and assert deleteTenantData actually clears each one. That's the reflection
// test #36 plans; landing it here (per #200's note) means #36 doesn't have to
// discover this gap again.
//
// As of #36 this allowlist holds exactly ONE entry — auditLog — and it is a
// permanent, deliberate policy exclusion (the audit trail must outlive the
// tenant it describes), not leftover debt. Nothing else may be added here:
// any other table with a tenantId column that isn't wired into
// deleteTenantData fails this test, which is what makes TENANT_TABLES
// structurally guaranteed to stay complete rather than silently going stale
// (the exact failure mode #200 hit and #36 was filed to fix for good).
const KNOWN_GAPS = new Set([
  // Intentional, documented exclusion (see the NOTE next to TENANT_TABLES in
  // tenantAdmin.ts) — the audit trail must outlive the tenant it describes.
  'auditLog',
]);

// deleteTenantData imports '@/db' and '@/lib/server/storage' at module scope,
// so both mocks must be in place before a fresh import of the module graph,
// and modules must be reset between tests so each test's local recorder isn't
// shared with the next.
async function deleteTenantDataWithRecorder(
  storageKeysByTable: Record<string, { storageKey: string | null }[]> = {},
): Promise<{ deletedTableNames: Set<string>; deletedKeys: string[] }> {
  vi.resetModules();
  const deletedTableNames = new Set<string>();
  const deletedKeys: string[] = [];

  vi.doMock('@/db', () => ({
    db: {
      // Used only to read R2 storage keys before the transaction runs.
      select: () => ({
        from: (table: unknown) => ({
          where: () => Promise.resolve(storageKeysByTable[getTableName(table as Parameters<typeof getTableName>[0])] ?? []),
        }),
      }),
      // The real deleteTenantData wraps its per-table deletes in db.transaction;
      // the mock `tx` just needs the same `.delete().where()` shape as `db`.
      transaction: async (cb: (tx: unknown) => Promise<void>) => {
        const tx = {
          delete: (table: unknown) => {
            deletedTableNames.add(getTableName(table as Parameters<typeof getTableName>[0]));
            return { where: () => Promise.resolve(undefined) };
          },
        };
        return cb(tx);
      },
    },
  }));
  vi.doMock('@/lib/server/storage', () => ({
    isStorageConfigured: () => true,
    deletePhoto: (key: string) => {
      deletedKeys.push(key);
      return Promise.resolve();
    },
  }));

  const { deleteTenantData } = await import('@/lib/server/tenantAdmin');
  await deleteTenantData('t1');
  return { deletedTableNames, deletedKeys };
}

describe('deleteTenantData / TENANT_TABLES (#200, #36)', () => {
  afterEach(() => {
    vi.doUnmock('@/db');
    vi.doUnmock('@/lib/server/storage');
    vi.resetModules();
  });

  it('deletes every schema table that has a tenantId column, except the documented exclusions', async () => {
    const { deletedTableNames } = await deleteTenantDataWithRecorder();

    const tenantScopedTables = Object.entries(schema).filter(([name, table]) => {
      if (KNOWN_GAPS.has(name)) return false;
      try {
        return 'tenantId' in getTableColumns(table as Parameters<typeof getTableColumns>[0]);
      } catch {
        return false; // not a pgTable export
      }
    });

    expect(tenantScopedTables.length).toBeGreaterThan(0);
    for (const [name, table] of tenantScopedTables) {
      const tableName = getTableName(table as Parameters<typeof getTableName>[0]);
      expect(deletedTableNames.has(tableName), `expected TENANT_TABLES to include "${name}" (${tableName})`).toBe(true);
    }
  });

  it('deletes production_backfill_report specifically', async () => {
    const { deletedTableNames } = await deleteTenantDataWithRecorder();
    expect(deletedTableNames.has('production_backfill_report')).toBe(true);
  });

  it('never deletes auditLog, the one deliberate/permanent exclusion', async () => {
    const { deletedTableNames } = await deleteTenantDataWithRecorder();
    expect(deletedTableNames.has('audit_log')).toBe(false);
  });

  it('deletes processing_events and error_logs (#36)', async () => {
    const { deletedTableNames } = await deleteTenantDataWithRecorder();
    expect(deletedTableNames.has('processing_events')).toBe(true);
    expect(deletedTableNames.has('error_logs')).toBe(true);
  });

  it('runs every per-table delete inside db.transaction, not against the top-level db (#36)', async () => {
    vi.resetModules();
    let transactionCalled = false;
    let topLevelDeleteCalled = false;
    vi.doMock('@/db', () => ({
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
        delete: () => {
          topLevelDeleteCalled = true;
          return { where: () => Promise.resolve(undefined) };
        },
        transaction: async (cb: (tx: unknown) => Promise<void>) => {
          transactionCalled = true;
          return cb({ delete: () => ({ where: () => Promise.resolve(undefined) }) });
        },
      },
    }));
    vi.doMock('@/lib/server/storage', () => ({
      isStorageConfigured: () => false,
      deletePhoto: () => Promise.resolve(),
    }));
    const { deleteTenantData } = await import('@/lib/server/tenantAdmin');
    await deleteTenantData('t1');
    expect(transactionCalled).toBe(true);
    expect(topLevelDeleteCalled).toBe(false);
  });

  it('deletes the R2 objects for a tenant\'s photos and test photos after the DB rows are gone (#36)', async () => {
    const { deletedKeys } = await deleteTenantDataWithRecorder({
      photos: [{ storageKey: 't1/photo-a.jpg' }, { storageKey: null }],
      test_photos: [{ storageKey: 't1/test/shot-b.png' }],
    });
    expect(deletedKeys.sort()).toEqual(['t1/photo-a.jpg', 't1/test/shot-b.png']);
  });

  it('does not attempt R2 deletes when storage is not configured', async () => {
    vi.resetModules();
    let deletePhotoCalled = false;
    vi.doMock('@/db', () => ({
      db: {
        select: () => ({
          from: () => ({ where: () => Promise.resolve([{ storageKey: 't1/photo-a.jpg' }]) }),
        }),
        transaction: async (cb: (tx: unknown) => Promise<void>) =>
          cb({ delete: () => ({ where: () => Promise.resolve(undefined) }) }),
      },
    }));
    vi.doMock('@/lib/server/storage', () => ({
      isStorageConfigured: () => false,
      deletePhoto: () => {
        deletePhotoCalled = true;
        return Promise.resolve();
      },
    }));
    const { deleteTenantData } = await import('@/lib/server/tenantAdmin');
    await deleteTenantData('t1');
    expect(deletePhotoCalled).toBe(false);
  });
});
