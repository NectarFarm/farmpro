import { db } from '@/db';
import { tenants, users, batches, sales, mortalityRecords, feedingRecords, productionRecords, auditLog, records } from '@/db/schemas';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { computeAllBatchCosts } from '@/lib/server/costing';
import { enterpriseFromSpecies } from '@/lib/server/productTemplates';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { readRateLimited } from '@/lib/server/rateLimit';

// GET /api/admin/tenants/analytics?id=... — detailed analytics for a single farm.
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) return badRequest('Farm not found');

  const allUsers = await db.select().from(users).where(eq(users.tenantId, id));
  const owner = allUsers.find(u => u.role === 'owner');
  const workerCount = allUsers.filter(u => u.role === 'worker').length;

  const allBatches = await db.select().from(batches).where(eq(batches.tenantId, id));
  const activeBatches = allBatches.filter(b => b.status === 'ACTIVE');
  const totalAnimals = activeBatches.reduce((s, b) => s + b.currentQty, 0);

  // Enterprise breakdown
  const entMap: Record<string, { batches: number; animals: number }> = {};
  for (const b of allBatches) {
    const ent = enterpriseFromSpecies(b.species || '') || 'other';
    if (!entMap[ent]) entMap[ent] = { batches: 0, animals: 0 };
    entMap[ent].batches++;
    if (b.status === 'ACTIVE') entMap[ent].animals += b.currentQty;
  }

  // Sales revenue (all time + monthly for chart)
  const allSales = await db.select().from(sales).where(eq(sales.tenantId, id));
  const totalRevenue = allSales.reduce((s, x) => s + x.totalAmount, 0);

  // Monthly revenue (last 6 months)
  const monthlyRevenue: { month: string; revenue: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const prefix = d.toISOString().slice(0, 7);
    const rev = allSales
      .filter(x => (x.createdAt ?? '').startsWith(prefix))
      .reduce((s, x) => s + x.totalAmount, 0);
    monthlyRevenue.push({ month: prefix, revenue: Math.round(rev) });
  }

  // Total mortality
  const allMorts = await db.select().from(mortalityRecords).where(eq(mortalityRecords.tenantId, id));
  const totalDeaths = allMorts.reduce((s, m) => s + m.count, 0);
  const totalInitial = allBatches.reduce((s, b) => s + b.initialQty, 0);
  const mortalityPct = totalInitial > 0 ? Math.round((totalDeaths / totalInitial) * 10000) / 100 : 0;

  // Cost summary per batch — one bulk-loaded pass instead of a per-batch query
  // round-trip (computeAllBatchCosts already groups every activity table in memory).
  const costs = await computeAllBatchCosts(id);
  const batchSummaries: Record<string, unknown>[] = [];
  let totalCost = 0;
  let fcrSum = 0, fcrN = 0;
  for (const b of allBatches) {
    const cost = costs.get(b.id);
    if (!cost) continue;
    totalCost += cost.totalCost;
    if (b.status === 'ACTIVE' && cost.fcr) { fcrSum += cost.fcr; fcrN++; }
    batchSummaries.push({
      id: b.id,
      name: b.name,
      species: b.species,
      stage: b.stage,
      status: b.status,
      initialQty: b.initialQty,
      currentQty: b.currentQty,
      acquiredDate: b.acquiredDate,
      fcr: cost.fcr,
      mortalityPct: cost.mortalityPct,
      costPerUnit: cost.costPerUnit,
      grossMargin: cost.grossMargin,
      totalRevenue: cost.totalRevenue,
      totalCost: cost.totalCost,
      costPerBird: cost.costPerBird,
      survivors: cost.survivors,
      soldHead: cost.soldHead,
      deaths: cost.deaths,
    });
  }

  // Recent activity (last 20 records)
  const recentRecords = await db.select()
    .from(records)
    .where(eq(records.tenantId, id))
    .orderBy(desc(records.createdAt))
    .limit(20);

  // Recent audit entries
  const recentAudits = await db.select()
    .from(auditLog)
    .where(eq(auditLog.tenantId, id))
    .orderBy(desc(auditLog.at))
    .limit(10);

  return ok({
    farm: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      features: tenant.features,
      active: tenant.active,
      testingEnabled: tenant.testingEnabled,
      createdAt: tenant.createdAt,
    },
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone } : null,
    users: { total: allUsers.length, workers: workerCount, managers: allUsers.filter(u => ['manager', 'vet'].includes(u.role)).length, owners: allUsers.filter(u => u.role === 'owner').length },
    metrics: {
      totalBatches: allBatches.length,
      activeBatches: activeBatches.length,
      totalAnimals,
      totalRevenue: Math.round(totalRevenue),
      totalCost: Math.round(totalCost),
      grossMargin: Math.round(totalRevenue - totalCost),
      mortalityPct,
      avgFCR: fcrN > 0 ? Math.round((fcrSum / fcrN) * 100) / 100 : 0,
      totalDeaths,
      totalInitial,
    },
    enterpriseBreakdown: entMap,
    monthlyRevenue,
    batches: batchSummaries,
    recentActivity: recentRecords.map(r => ({
      clientUuid: r.clientUuid,
      type: r.type,
      payload: r.payload,
      capturedAt: r.capturedAt,
      createdBy: r.createdBy,
    })),
    recentAudits: recentAudits.map(a => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      entity: a.entity,
      meta: a.meta,
      at: a.at,
    })),
  });
}
