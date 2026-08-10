// #25 — recover production_records rows destroyed by the pre-#24 same-day
// dedupe. Run with: pnpm tsx scripts/recoverProductionConflicts.ts [--restore]
// (needs DATABASE_URL set; defaults to a dry run — nothing is written to
// production_records unless --restore is passed).
//
// Scope, precisely: before #24, lib/server/syncHandlers.ts's handleProduction
// treated a second same-day production record as an edit conflict and, when
// the incoming record won (`resolution: 'kept_mine'`), DELETEd the existing
// row after writing its full JSON to conflict_log.server_version. That is the
// ONLY code path that ever deleted a production_records row, so recovery is
// scoped to exactly those conflict_log rows: record_type = 'production' AND
// resolution = 'kept_mine'.
//
// Deliberately NOT in scope: `resolution = 'kept_server'` conflict_log rows.
// There, the OLD code never inserted the incoming submission at all (it just
// returned without writing) — so there is no deleted row to restore, even
// though that submission's data is also sitting in `my_version` unused. That
// is a real, separate gap (a silently dropped submission, not a destroyed
// row) that issue #25 does not ask this script to close; it is called out in
// the task report rather than guessed at here.
//
// A row is "recoverable" only when conflict_log.server_version contains
// every field production_records requires (see reconstructDeletedRow).
// Anything else is reported as unrecoverable, never guessed.
//
// Idempotent: a restored row keeps the ORIGINAL deleted row's client_uuid
// (production_records' primary key), so re-running --restore after rows are
// already back finds them present and counts them under `alreadyRestored`
// instead of reinserting or double-counting them. A dry run never writes to
// production_records at all, only to production_recovery_report (this run's
// own durable summary — see db/schemas/index.ts) so the operator has a
// queryable record of what a dry run found even before deciding to restore.
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { alerts, conflictLog, productionRecords, productionRecoveryReport } from '../db/schemas';
import { reconstructDeletedRow } from './lib/reconstructProductionRow';

interface TenantTally {
  recovered: number;
  recoveredQty: number;
  alreadyRestored: number;
  unrecoverable: number;
  unrecoverableReasons: string[];
}

function bucketFor(map: Map<string, TenantTally>, tenantId: string): TenantTally {
  let b = map.get(tenantId);
  if (!b) { b = { recovered: 0, recoveredQty: 0, alreadyRestored: 0, unrecoverable: 0, unrecoverableReasons: [] }; map.set(tenantId, b); }
  return b;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const restore = process.argv.includes('--restore');

  const client = postgres(url, { prepare: false });
  const db = drizzle(client);

  const candidates = await db.select().from(conflictLog)
    .where(and(eq(conflictLog.recordType, 'production'), eq(conflictLog.resolution, 'kept_mine')));

  const byTenant = new Map<string, TenantTally>();

  for (const c of candidates) {
    const result = reconstructDeletedRow({ tenantId: c.tenantId, serverVersion: c.serverVersion });
    const bucket = bucketFor(byTenant, c.tenantId);
    if (!result.ok) {
      bucket.unrecoverable++;
      bucket.unrecoverableReasons.push(`${c.id}: ${result.reason}`);
      continue;
    }
    const row = result.row;
    // Idempotency check — this row may already have been put back by an
    // earlier --restore run (or, in principle, never actually removed).
    const [existing] = await db.select({ clientUuid: productionRecords.clientUuid })
      .from(productionRecords).where(eq(productionRecords.clientUuid, row.clientUuid)).limit(1);
    if (existing) { bucket.alreadyRestored++; continue; }

    bucket.recovered++;
    bucket.recoveredQty += row.qty;
    if (restore) {
      await db.insert(productionRecords).values(row).onConflictDoNothing({ target: productionRecords.clientUuid });
    }
  }

  console.log(`\n──────── #25 production recovery (${restore ? 'RESTORE' : 'DRY RUN'}) ────────`);
  for (const [tenantId, b] of byTenant) {
    console.log(`  ${tenantId}: recovered=${b.recovered} qty=${b.recoveredQty} alreadyRestored=${b.alreadyRestored} unrecoverable=${b.unrecoverable}`);
    for (const reason of b.unrecoverableReasons) console.log(`    - unrecoverable: ${reason}`);

    await db.insert(productionRecoveryReport).values({
      id: crypto.randomUUID(), tenantId, mode: restore ? 'restore' : 'dry_run',
      recovered: b.recovered, recoveredQty: b.recoveredQty,
      alreadyRestored: b.alreadyRestored, unrecoverable: b.unrecoverable,
    });

    // Owner-visible note (#25 AC) — only once real rows have actually landed,
    // and only once per tenant (deterministic id, onConflictDoNothing) so a
    // repeat --restore run that finds nothing new to insert doesn't re-alert.
    if (restore && b.recovered > 0) {
      await db.insert(alerts).values({
        id: `auto:production_recovery:${tenantId}`, tenantId, severity: 'info', type: 'data_recovery',
        title: 'Historical production records restored',
        message: `${b.recovered} production record(s) totaling ${b.recoveredQty} units were restored. They were previously discarded by a bug where two same-day collections deleted one another (now fixed) — this changes some historical totals.`,
        createdAt: new Date().toISOString(), acknowledged: false,
      }).onConflictDoNothing({ target: alerts.id });
    }
  }
  if (byTenant.size === 0) console.log('  no production-record conflicts found (kept_mine) — nothing to recover.');
  if (!restore) console.log('\n  Re-run with --restore to actually reinsert the recoverable rows.\n');

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
