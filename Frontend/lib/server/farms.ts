import 'server-only';
import { db } from '@/db';
import { farms } from '@/db/schemas';
import { eq, asc } from 'drizzle-orm';

// Minimal executor shape so the helper can run inside a transaction (drizzle's
// `tx` from db.transaction) or against the request-scoped `db` directly.
// production_units.farm_id is a real FK into farms (issue #219), so every place
// that inserts a unit must first resolve a real farm id through here.
type FarmExecutor = Pick<typeof db, 'select' | 'insert'>;

/**
 * Returns the tenant's first farm (oldest first), creating a default one when
 * the tenant has none yet. Unit-creation paths call this so their farmId always
 * references a real farms row.
 */
export async function ensureFarm(
  tenantId: string,
  name = 'Main Farm',
  client: FarmExecutor = db,
): Promise<string> {
  const [existing] = await client.select({ id: farms.id }).from(farms)
    .where(eq(farms.tenantId, tenantId)).orderBy(asc(farms.createdAt)).limit(1);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const code = `FRM-${id.slice(0, 6).toUpperCase()}`;
  await client.insert(farms).values({ id, tenantId, name, location: '', code });
  return id;
}

/**
 * Default farm code derived from a farm name (uppercase slug), e.g.
 * "Nakuru Main Farm" → "FRM-NAKURU-MAIN". POST /api/farms uses this when the
 * caller doesn't provide a `code`.
 */
export function farmCodeFromName(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12);
  return `FRM-${slug || 'FARM'}`;
}
