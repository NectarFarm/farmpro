import 'server-only';
// Alert evaluation (FR-M14) — computes alerts from live data against the saved
// rules. On-demand within Next.js (the scheduled version is the Celery tier).
// Deterministic alert ids → re-running is idempotent and preserves ack state.
import { db } from '@/db';
import { batches, mortalityRecords, inventoryItems, inventoryLots, tasks, alertRules, alerts } from '@/db/schemas';
import { eq } from 'drizzle-orm';

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

  let created = 0;
  for (const a of toInsert) {
    const existing = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.id, a.id as string)).limit(1);
    if (existing.length === 0) { await db.insert(alerts).values(a); created++; }
  }
  return { conditions: toInsert.length, created };
}
