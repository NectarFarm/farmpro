import { db } from '@/db';
import { batches, alerts, inventoryItems, inventoryLots, productionRecords } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import type { Session } from '@/lib/server/session';
import { withFeature } from '@/lib/server/entitlements';
import { computeDashboardKPIs } from '@/lib/server/costing';
import { askAI, type ChatMessage } from '@/lib/server/ai';
import { ok, forbidden, badRequest, serverError } from '@/lib/server/http';
import type { Role } from '@/lib/types';

const ALLOWED: Role[] = ['owner', 'manager'];

const SYSTEM = `You are IFMS Advisor, an expert advisor for a diversified Kenyan smallholder farm (poultry, pigs, fish, crops).
Rules:
- Ground every answer in the LIVE FARM DATA provided, plus solid agronomy and animal-husbandry knowledge.
- Be concrete: cite the farm's own numbers, give KES amounts, and end with 1-3 specific actions to take this week.
- Keep it under 180 words; use short bullets when it helps. Never invent figures not in the data.
- If you lack the data to answer well, say exactly what the farmer should start recording.
- You remember earlier messages in this conversation — build on them instead of repeating.`;

// POST /api/ai/advise { messages: [{role,content}] } — grounded, multi-turn farm advice.
// #29: gated behind the `ai_advisor` feature — this is a paid LLM call (#17
// separately rate-limits it), not something a free-plan tenant should reach.
async function postHandler(req: Request, session: Session) {
  if (!ALLOWED.includes(session.role)) return forbidden();
  const { messages } = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) return badRequest('Ask a question first.');

  const tid = session.tenantId;
  const [kpis, bs, al, items, lots, prod] = await Promise.all([
    computeDashboardKPIs(tid),
    db.select().from(batches).where(eq(batches.tenantId, tid)),
    db.select().from(alerts).where(eq(alerts.tenantId, tid)),
    db.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tid)),
    db.select().from(inventoryLots).where(eq(inventoryLots.tenantId, tid)),
    db.select().from(productionRecords).where(eq(productionRecords.tenantId, tid)),
  ]);

  const onHand = (itemId: string) => lots.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qtyOnHand, 0);
  const lowStock = items.filter((i) => onHand(i.id) <= i.lowStockThreshold).map((i) => `${i.name} (${onHand(i.id)} ${i.unit} left, reorder at ${i.lowStockThreshold})`);
  const activeAlerts = al.filter((a) => !a.acknowledged).map((a) => a.title);
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const prodByType: Record<string, number> = {};
  for (const p of prod) if (p.capturedAt.slice(0, 10) >= cutoff) prodByType[p.type] = (prodByType[p.type] ?? 0) + p.qty;

  // avgFCR is 0 both when it's genuinely 0 (never happens in practice) AND when
  // no active batch had a computable FCR at all (a maize-only farm, a meat-goats
  // batch that's never been milked, etc — see #23). Feeding a bare "0" into a
  // prompt that's told to "never invent figures" would read as a real, good
  // number, so say plainly when there's nothing to report instead.
  const avgFcrText = kpis.avgFCRSampleSize > 0 ? String(kpis.avgFCR) : 'not available (no batch has feed-conversion data yet)';

  const context = `LIVE FARM DATA (as of ${new Date().toISOString().slice(0, 10)}):
- Active batches: ${kpis.activeBatches}; total animals: ${kpis.totalBirds}; mortality: ${kpis.mortalityPct}%; avg FCR: ${avgFcrText}.
- Gross margin: KES ${kpis.grossMargin}; revenue this month: KES ${kpis.revenueThisMonth}; pending alerts: ${kpis.pendingAlerts}.
- Batches: ${bs.map((b) => `${b.name} [${b.species}, ${b.currentQty} head, stage ${b.stage}]`).join('; ') || 'none yet'}.
- Active alerts: ${activeAlerts.join('; ') || 'none'}.
- Low/empty stock: ${lowStock.join('; ') || 'all stock healthy'}.
- Production (last 14 days): ${Object.entries(prodByType).map(([k, v]) => `${v} ${k}`).join('; ') || 'nothing recorded'}.`;

  const thread: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM}\n\n${context}` },
    ...messages.slice(-10).map((m): ChatMessage => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '').slice(0, 2000),
    })),
  ];

  try {
    const answer = await askAI(thread);
    return ok({ answer });
  } catch (e) {
    return serverError((e as Error).message);
  }
}

export const POST = withFeature('POST /api/ai/advise', postHandler);
