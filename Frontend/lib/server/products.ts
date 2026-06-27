import 'server-only';
import { db } from '@/db';
import { products, workerProfiles, alerts } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { PRODUCT_TEMPLATES, enterpriseFromSpecies, type ProductDef } from './productTemplates';
import type { FieldConfig } from '@/lib/types';

export const productFieldKey = (name: string) =>
  'collect_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

interface CreatedProduct { id: string; name: string; fieldKey: string; frequency: string }

// Resolve which default products a batch should get (by chosen enterprise, else by species).
export function defaultsForBatch(species: string, enterprise?: string): ProductDef[] {
  const key = enterprise && PRODUCT_TEMPLATES[enterprise] ? enterprise : enterpriseFromSpecies(species || '');
  return key ? PRODUCT_TEMPLATES[key] : [];
}

// Returns only the main product for the batch (the animal itself / primary output).
// Other products (manure, eggs, etc.) are added manually by the farmer.
export function mainProductForBatch(species: string, enterprise?: string): ProductDef | null {
  const key = enterprise && PRODUCT_TEMPLATES[enterprise] ? enterprise : enterpriseFromSpecies(species || '');
  if (!key) return null;
  return PRODUCT_TEMPLATES[key].find(p => p.isMainProduct) ?? null;
}

export async function createProductsForBatch(tenantId: string, batchId: string, defs: ProductDef[]): Promise<CreatedProduct[]> {
  const created: CreatedProduct[] = [];
  for (const d of defs) {
    const fieldKey = productFieldKey(d.name);
    const id = crypto.randomUUID();
    await db.insert(products).values({
      id, tenantId, batchId, name: d.name, baseUnit: d.baseUnit, saleUnits: d.saleUnits,
      collectFrequency: d.collectFrequency, flow: d.flow ?? 'sale', fieldKey, active: true,
      isAnimalProduct: d.isAnimalProduct ?? false,
    });
    created.push({ id, name: d.name, fieldKey, frequency: d.collectFrequency });
  }
  // Collection permissions/reminders apply only to things a worker actually
  // collects (eggs, manure, milk…) — never the live animal itself, which is sold.
  const collectible = created.filter((_, i) => !defs[i].isAnimalProduct);
  if (collectible.length) {
    await addCollectionPermissions(tenantId, collectible);
    await notifyAssignCollectors(tenantId, collectible);
  }
  return created;
}

// Auto-add a collection permission field to every worker profile (idempotent).
async function addCollectionPermissions(tenantId: string, items: CreatedProduct[]) {
  const profiles = await db.select().from(workerProfiles).where(eq(workerProfiles.tenantId, tenantId));
  for (const p of profiles) {
    const fields = ((p.fields ?? []) as FieldConfig[]).slice();
    const existing = new Set(fields.map((f) => f.fieldKey));
    let changed = false;
    for (const it of items) {
      if (!existing.has(it.fieldKey)) {
        fields.push({ fieldKey: it.fieldKey, label: `Collect ${it.name} (${it.frequency})`, permission: 'editable', required: false });
        changed = true;
      }
    }
    if (changed) await db.update(workerProfiles).set({ fields }).where(eq(workerProfiles.id, p.id));
  }
}

// Notify the farmer to assign a worker to collect each new product.
async function notifyAssignCollectors(tenantId: string, items: CreatedProduct[]) {
  const now = new Date().toISOString();
  for (const it of items) {
    await db.insert(alerts).values({
      id: `assign:${it.id}`, tenantId, severity: 'info', type: 'task_missed',
      title: 'Assign a collector', message: `Assign a worker to collect ${it.name} (${it.frequency})`,
      createdAt: now, acknowledged: false,
    }).onConflictDoNothing({ target: alerts.id });
  }
}
