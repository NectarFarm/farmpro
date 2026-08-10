import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sales } from '@/db/schemas';

// #33: every `*_cents` column was declared `integer` (int4), which caps at
// 2,147,483,647 — KSh 21,474,836.47. A plausible cooperative-treasury or
// cumulative-ledger figure exceeds that. This asserts the fix directly
// against a real Postgres connection (not a mock), because the whole bug is
// about what the DB column type actually allows on the wire — a mocked
// drizzle client would happily "store" any JS number regardless of the
// underlying SQL type and never catch a regression back to `integer`.
describe('sales.total_amount_cents / unit_price_cents are bigint (#33)', () => {
  const testId = `test-cents-overflow-${Date.now()}`;

  afterAll(async () => {
    await db.delete(sales).where(eq(sales.id, testId));
  });

  it('persists and reads back a cents value above the int4 ceiling exactly', async () => {
    // KSh 50,000,000 = 5,000,000,000 cents — the issue's own verification
    // example. int4 maxes out at 2,147,483,647; this value overflows it by
    // more than 2x, so on an unfixed `integer` column the INSERT itself
    // throws ("numeric field overflow" / "value out of range for type
    // integer") rather than silently truncating.
    const overflowingCents = 5_000_000_000;

    await db.insert(sales).values({
      id: testId,
      tenantId: 'test-tenant-cents-overflow',
      batchId: 'test-batch',
      unitId: 'test-unit',
      productType: 'eggs',
      quantity: 1,
      unitPrice: 50_000_000,
      unitPriceCents: overflowingCents,
      totalAmount: 50_000_000,
      totalAmountCents: overflowingCents,
      buyer: 'test-buyer',
      paymentMethod: 'cash',
      status: 'completed',
      withdrawalCheck: 'na',
      createdAt: new Date().toISOString(),
    });

    const [row] = await db
      .select({ unitPriceCents: sales.unitPriceCents, totalAmountCents: sales.totalAmountCents })
      .from(sales)
      .where(eq(sales.id, testId));

    expect(row.unitPriceCents).toBe(overflowingCents);
    expect(row.totalAmountCents).toBe(overflowingCents);
  });
});
