import 'server-only';
// Atomic sale creation: insert the sale and (when selling live animals) decrement
// batch/unit headcount in ONE transaction so a crash can't leave stock wrong.
import { db } from '@/db';
import { sales, batches, productionUnits, products } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { sellableStock, liveWeightFor, checkWithdrawal } from './inventory';
import { toCents } from './money';
import { pgErrorCode } from './dbErrors';

export type SaleInput = {
  tenantId: string;
  batchId: string;
  quantity: number;
  unitPrice: number;
  productId?: string;
  productType?: string;
  unitName?: string;
  weightKg?: number | null;
  buyer?: string;
  paymentMethod?: string;
};

export type SaleResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createSale(input: SaleInput): Promise<SaleResult> {
  const {
    tenantId, batchId, quantity, unitPrice,
    productId, productType, unitName, weightKg, buyer, paymentMethod,
  } = input;

  if (!batchId) return { ok: false, error: 'batchId required' };
  if (!(quantity > 0)) return { ok: false, error: 'Enter a quantity greater than zero.' };
  if (!(unitPrice >= 0) || !Number.isFinite(unitPrice)) {
    return { ok: false, error: 'Enter a valid unit price.' };
  }

  const [batch] = await db
    .select({
      id: batches.id,
      unitId: batches.unitId,
      currentQty: batches.currentQty,
      species: batches.species,
      avgWeightKg: batches.avgWeightKg,
    })
    .from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)))
    .limit(1);
  if (!batch) return { ok: false, error: 'unknown batch' };

  const withdrawal = await checkWithdrawal(tenantId, batch.id);
  if (!withdrawal.cleared) {
    return {
      ok: false,
      error: `This batch is still inside a medicine withdrawal period until ${withdrawal.until} (${withdrawal.daysLeft} day${withdrawal.daysLeft === 1 ? '' : 's'} left) — it cannot be sold yet.`,
    };
  }

  let baseQty = quantity;
  let productName = productType?.trim() || 'produce';
  let baseUnit = 'unit';
  let isAnimalProduct = false;
  let product: typeof products.$inferSelect | null = null;

  if (productId) {
    [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
      .limit(1);
    if (!product) return { ok: false, error: 'unknown product' };
    productName = product.name;
    baseUnit = product.baseUnit;
    isAnimalProduct = product.isAnimalProduct ?? false;
    const saleUnits = (product.saleUnits as { name: string; perBase: number; price: number }[] | null) ?? [];
    const unit = saleUnits.find((u) => u.name === (unitName ?? ''));
    if (unitName && saleUnits.length > 0 && !unit) {
      return {
        ok: false,
        error: `Unknown sale unit "${unitName}" for ${productName}. Pick one of: ${saleUnits.map((u) => u.name).join(', ')}.`,
      };
    }
    baseQty = quantity * (unit?.perBase ?? 1);

    const stock = await sellableStock(tenantId, batch, product);
    if (baseQty > stock.available + 1e-6) {
      if (stock.basis === 'headcount') {
        return {
          ok: false,
          error: `Only ${stock.available} ${baseUnit} of ${productName} left in this batch — you tried to sell ${baseQty}. Record mortalities or check the live count.`,
        };
      }
      if (stock.basis === 'biomass') {
        return {
          ok: false,
          error: stock.available > 0
            ? `Only about ${stock.available} ${baseUnit} of ${productName} in this batch (~${batch.currentQty} animals × ${stock.avgWeightKg} ${baseUnit} each) — you tried to sell ${baseQty}.`
            : `Record a weight sample for this batch first — without an average weight we can't tell how many ${baseUnit} of ${productName} the ${batch.currentQty} animals represent.`,
        };
      }
      return {
        ok: false,
        error: `Only ${stock.available} ${baseUnit} of ${productName} available to sell — collected ${stock.produced}, already sold ${stock.sold}. Record the collection first.`,
      };
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (tx) => {
      // Re-read batch under lock so concurrent sales can't both pass the stock check.
      const [locked] = await tx
        .select({
          id: batches.id,
          unitId: batches.unitId,
          currentQty: batches.currentQty,
          species: batches.species,
          avgWeightKg: batches.avgWeightKg,
        })
        .from(batches)
        .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batch.id)))
        .for('update')
        .limit(1);
      if (!locked) throw new Error('unknown batch');

      // Harvested-output stock (eggs, milk, etc.) has no row to lock — it's
      // collected-minus-sold across productionRecords/sales. Re-check it here,
      // inside the SERIALIZABLE transaction, so Postgres aborts one side of two
      // concurrent sales that would otherwise both pass the pre-check and oversell.
      if (product && !isAnimalProduct && baseQty > 0) {
        const stock = await sellableStock(tenantId, locked, product, tx);
        if (baseQty > stock.available + 1e-6) {
          throw new Error(
            `Only ${stock.available} ${baseUnit} of ${productName} available to sell — collected ${stock.produced}, already sold ${stock.sold}. A concurrent sale may have used the rest.`,
          );
        }
      }

      if (isAnimalProduct && baseQty > 0) {
        const perHead = (baseUnit ?? 'head') === 'head';
        const avg = liveWeightFor(locked);
        const head = perHead ? Math.round(baseQty) : (avg > 0 ? Math.round(baseQty / avg) : 0);
        if (head > locked.currentQty) {
          throw new Error(`Only ${locked.currentQty} head left — concurrent sale reduced stock.`);
        }
        const newBatchQty = Math.max(0, locked.currentQty - head);
        await tx.update(batches).set({ currentQty: newBatchQty })
          .where(and(eq(batches.tenantId, tenantId), eq(batches.id, locked.id)));

        const [unitRow] = await tx
          .select({ q: productionUnits.currentQty })
          .from(productionUnits)
          .where(and(eq(productionUnits.tenantId, tenantId), eq(productionUnits.id, locked.unitId)))
          .for('update')
          .limit(1);
        if (unitRow) {
          await tx.update(productionUnits).set({ currentQty: Math.max(0, (unitRow.q ?? 0) - head) })
            .where(and(eq(productionUnits.tenantId, tenantId), eq(productionUnits.id, locked.unitId)));
        }
      }

      await tx.insert(sales).values({
        id,
        tenantId,
        batchId: locked.id,
        unitId: locked.unitId,
        productType: productName,
        quantity,
        baseQty,
        weightKg: weightKg != null && Number.isFinite(Number(weightKg)) ? Number(weightKg) : null,
        unitPrice,
        unitPriceCents: toCents(unitPrice),
        totalAmount: quantity * unitPrice,
        totalAmountCents: toCents(quantity * unitPrice),
        buyer: buyer?.trim() || 'Market',
        paymentMethod: paymentMethod?.trim() || 'cash',
        status: 'PAID',
        withdrawalCheck: 'cleared',
        createdAt: now,
      });
    }, { isolationLevel: 'serializable' });
  } catch (e) {
    // Postgres aborts one side of a serialization conflict with SQLSTATE 40001 —
    // translate that into the same "someone else just sold this" message a
    // locked-row conflict would produce, instead of a raw DB error string.
    // drizzle wraps the real postgres error in a DrizzleQueryError, so the
    // SQLSTATE lives on e.cause.code, not e.code — see lib/server/dbErrors.ts.
    if (pgErrorCode(e) === '40001') {
      return { ok: false, error: 'This sale conflicted with another concurrent sale on the same batch — please try again.' };
    }
    const msg = e instanceof Error ? e.message : 'Sale failed.';
    return { ok: false, error: msg };
  }

  return { ok: true, id };
}
