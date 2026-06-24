import 'server-only';
// THE security boundary (FR-M16, NFR-SEC-2). Sensitive properties are DROPPED
// from the response object on the server — not hidden in the client. A worker
// whose profile hides 'feed_unit_cost' never receives that property in the JSON.
import { db } from '@/db';
import { workerProfiles } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import type { Session } from './session';
import type { FieldConfig, Role } from '@/lib/types';

// Map each resource's sensitive object-properties → the permission fieldKey that gates them.
const SENSITIVE: Record<string, Record<string, string>> = {
  batches: { acquisitionCost: 'batch_profit_loss' },
  lots: { unitCost: 'feed_unit_cost' },
  sales: { unitPrice: 'egg_sale_price', totalAmount: 'egg_sale_price', buyer: 'egg_sale_price' },
  purchases: { unitCost: 'feed_unit_cost', totalCost: 'feed_unit_cost' },
  'cost-summary': {
    acquisitionCost: 'batch_profit_loss', feedCost: 'batch_profit_loss', healthCost: 'batch_profit_loss',
    laborCost: 'batch_profit_loss', overheadCost: 'batch_profit_loss', totalCost: 'batch_profit_loss',
    totalRevenue: 'batch_profit_loss', grossMargin: 'batch_profit_loss', costPerUnit: 'batch_profit_loss',
  },
};

// Financial keys hidden by default from roles without explicit financial access.
const FINANCIAL_KEYS = ['feed_unit_cost', 'egg_sale_price', 'batch_profit_loss'];
const FULL_FINANCIAL_ROLES: Role[] = ['owner', 'auditor'];

// Resolve which fieldKeys must be hidden for this session.
export async function hiddenFieldKeysFor(session: Session): Promise<Set<string>> {
  if (FULL_FINANCIAL_ROLES.includes(session.role)) return new Set();
  if (session.role === 'worker' && session.workerProfileId) {
    const [profile] = await db
      .select({ fields: workerProfiles.fields })
      .from(workerProfiles)
      .where(eq(workerProfiles.id, session.workerProfileId))
      .limit(1);
    const fields = (profile?.fields ?? []) as FieldConfig[];
    const perm = new Map(fields.map((f) => [f.fieldKey, f.permission]));
    const hidden = new Set(fields.filter((f) => f.permission === 'hidden').map((f) => f.fieldKey));
    // Default-deny: financial keys stay hidden unless the profile EXPLICITLY reveals
    // them. A partial/mangled profile can never leak money to a worker.
    for (const k of FINANCIAL_KEYS) {
      const p = perm.get(k);
      if (p !== 'editable' && p !== 'readonly') hidden.add(k);
    }
    return hidden;
  }
  // manager, vet, or a worker without a profile → hide all financial fields by default.
  return new Set(FINANCIAL_KEYS);
}

// Drop hidden properties from each row for the given resource.
export function stripForRead<T extends Record<string, unknown>>(
  resource: string,
  rows: T[],
  hidden: Set<string>
): Partial<T>[] {
  const map = SENSITIVE[resource];
  if (!map || hidden.size === 0) return rows;
  return rows.map((row) => {
    const copy: Partial<T> = { ...row };
    for (const [prop, key] of Object.entries(map)) {
      if (hidden.has(key)) delete copy[prop as keyof T];
    }
    return copy;
  });
}

// On writes: reject any attempt to set a non-editable field (FR-M16 editable flag).
export async function assertWritable(session: Session, fieldKeys: string[]): Promise<void> {
  if (session.role === 'owner') return;
  if (session.role === 'worker' && session.workerProfileId) {
    const [profile] = await db
      .select({ fields: workerProfiles.fields })
      .from(workerProfiles)
      .where(eq(workerProfiles.id, session.workerProfileId))
      .limit(1);
    const fields = (profile?.fields ?? []) as FieldConfig[];
    const notEditable = new Set(fields.filter((f) => f.permission !== 'editable').map((f) => f.fieldKey));
    const violation = fieldKeys.find((k) => notEditable.has(k));
    if (violation) throw new Error(`Field not editable: ${violation}`);
  }
}
