import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const KNOWN_GAPS = new Set([
  // Intentional, documented exclusion (see the NOTE next to TENANT_TABLES in
  // tenantAdmin.ts) — the audit trail must outlive the tenant it describes.
  'auditLog',
  // Pre-existing gaps, out of scope for #200/#195/#201 — tracked by #36.
  // Leave these out of the assertion so this test documents, rather than
  // silently masks, the remaining debt.
  'processingEvents',
  'errorLogs',
]);

// deleteTenantData imports '@/db' at module scope, so the mock must be in
// place before a fresh import of the module graph, and modules must be reset
// between tests so each test's local recorder isn't shared with the next.
async function deleteTenantDataWithRecorder(): Promise<Set<string>> {
  vi.resetModules();
  const deletedTableNames = new Set<string>();
  vi.doMock('@/db', () => ({
    db: {
      delete: (table: unknown) => {
        deletedTableNames.add(getTableName(table as Parameters<typeof getTableName>[0]));
        return { where: () => Promise.resolve(undefined) };
      },
    },
  }));
  const { deleteTenantData } = await import('@/lib/server/tenantAdmin');
  await deleteTenantData('t1');
  return deletedTableNames;
}

describe('deleteTenantData / TENANT_TABLES (#200)', () => {
  afterEach(() => {
    vi.doUnmock('@/db');
    vi.resetModules();
  });

  it('deletes every schema table that has a tenantId column, except the documented exclusions', async () => {
    const deletedTableNames = await deleteTenantDataWithRecorder();

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
    const deletedTableNames = await deleteTenantDataWithRecorder();
    expect(deletedTableNames.has('production_backfill_report')).toBe(true);
  });
});
