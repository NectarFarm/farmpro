import 'server-only';
// Alert evaluation (FR-M14) — computes alerts from live data against the saved
// rules. On-demand within Next.js (the scheduled version is the Celery tier).
// Deterministic alert ids → re-running is idempotent and preserves ack state.
import { db } from '@/db';
import { batches, mortalityRecords, inventoryItems, inventoryLots, tasks, alertRules, alerts, lifecycleStages } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { enterpriseFromSpecies } from './productTemplates';
import { ageDays, dueToAdvance } from '@/lib/lifecycle';

// Raise a single event alert with a deterministic id. Idempotent: if an alert with
// the same id already exists it's left untouched (so a re-sync never duplicates it or
// resets the owner's acknowledgement). Used by /api/sync for point-in-time events
// (stock variance, abnormal observation, weight loss) so the owner is warned at once.
export async function raiseAlert(
  tenantId: string,
  a: { id: string; severity: string; type: string; title: string; message: string },
): Promise<boolean> {
  const existing = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.id, a.id)).limit(1);
  if (existing.length) return false;
  await db.insert(alerts).values({ ...a, tenantId, createdAt: new Date().toISOString(), acknowledged: false });
  return true;
}

export async function evaluateAlerts(tenantId: string): Promise<{ conditions: number; created: number }> {
  const rules = await db.select().from(alertRules).where(eq(alertRules.tenantId, tenantId));
  const ruleBy = new Map(rules.filter((r) => r.enabled).map((r) => [r.metric, r]));
  const now = new Date().toISOString();
  type Row = typeof alerts.$inferInsert;
  const toInsert: Row[] = [];

  const mRule = ruleBy.get('mortality_rate');
  if (mRule) {
    const bs = await db.select().from(batches).where(eq(batches.tenantId, tenantId));
    const morts = await db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, tenantId));
    for (const b of bs) {
      const deaths = morts.filter((m) => m.batchId === b.id).reduce((s, m) => s + m.count, 0);
      const rate = b.initialQty ? (deaths / b.initialQty) * 100 : 0;
      if (rate > mRule.threshold) {
        toInsert.push({
          id: `auto:mortality:${b.id}`, tenantId, severity: mRule.severity, type: 'mortality_spike',
          title: 'Mortality spike', message: `${b.name}: ${rate.toFixed(1)}% mortality (> ${mRule.threshold}%)`,
          createdAt: now, acknowledged: false,
        });
      }
    }
  }

  const fRule = ruleBy.get('feed_qty');
  if (fRule) {
    const items = await db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    const lots = await db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tenantId));
    for (const it of items.filter((i) => i.category === 'FEED_FINISHED' || i.category === 'FEED_INGREDIENT')) {
      const stock = lots.filter((l) => l.itemId === it.id).reduce((s, l) => s + l.qtyOnHand, 0);
      if (stock < fRule.threshold) {
        toInsert.push({
          id: `auto:lowstock:${it.id}`, tenantId, severity: fRule.severity, type: 'low_stock',
          title: 'Low feed stock', message: `${it.name}: ${stock}${it.unit} left (< ${fRule.threshold}${fRule.unit})`,
          createdAt: now, acknowledged: false,
        });
      }
    }
  }

  const tRule = ruleBy.get('task_overdue_hours');
  if (tRule) {
    const ts = await db.select().from(tasks).where(eq(tasks.tenantId, tenantId));
    for (const t of ts) {
      if (t.status === 'DONE') continue;
      const due = new Date(t.dueAt).getTime();
      if (!isNaN(due) && Date.now() - due > tRule.threshold * 3600 * 1000) {
        toInsert.push({
          id: `auto:overdue:${t.id}`, tenantId, severity: tRule.severity, type: 'task_missed',
          title: 'Overdue task', message: `${t.title} is overdue`, createdAt: now, acknowledged: false,
        });
      }
    }
  }

  // Stage-due: a batch old enough to move to the next lifecycle phase. Config-driven
  // (not a threshold rule) so it's always on — this is how the farmer is warned that
  // "the chicks have reached the age to move on".
  const stageRows = await db.select().from(lifecycleStages).where(eq(lifecycleStages.tenantId, tenantId));
  if (stageRows.length) {
    const stageBatches = await db.select().from(batches).where(eq(batches.tenantId, tenantId));
    for (const b of stageBatches) {
      if (b.status !== 'ACTIVE') continue;
      const ent = enterpriseFromSpecies(b.species);
      if (!ent) continue;
      const set = stageRows.filter((s) => s.enterprise === ent).sort((a, c) => a.ord - c.ord).map((s) => ({ name: s.name, startDay: s.startDay }));
      if (!set.length) continue;
      const age = ageDays(b.acquiredDate, b.ageAtAcquire ?? 0);
      const due = dueToAdvance(set, b.stage, age);
      if (due.due && due.nextStage) {
        toInsert.push({
          id: `auto:stage_due:${b.id}:${due.nextStage}`, tenantId, severity: 'warning', type: 'stage_due',
          title: 'Ready to move stage',
          message: `${b.name} is ${age}d old — due to move to ${due.nextStage}${due.overdueDays > 0 ? ` (${due.overdueDays}d overdue)` : ''}`,
          createdAt: now, acknowledged: false,
        });
      }
    }
  }

  let created = 0;
  for (const a of toInsert) {
    const existing = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.id, a.id as string)).limit(1);
    if (existing.length === 0) { await db.insert(alerts).values(a); created++; }
  }
  return { conditions: toInsert.length, created };
}
