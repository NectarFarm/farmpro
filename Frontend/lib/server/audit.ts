import 'server-only';
import { db } from '@/db';
import { auditLog } from '@/db/schemas';

export interface AuditEntry {
  tenantId?: string | null;   // the farm acted on ('platform' for platform-wide)
  actor: string;              // who did it (email/name + role)
  action: string;             // dot.namespaced verb, e.g. 'tenant.delete'
  entity?: string | null;     // human label of the target (farm name, owner email…)
  before?: unknown;
  after?: unknown;
  meta?: unknown;
}

// Append an immutable audit record. Never throws — a failed audit must not break
// the action it describes. Audit rows deliberately OUTLIVE a deleted farm.
export async function audit(e: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      tenantId: e.tenantId ?? 'platform',
      actor: e.actor,
      action: e.action,
      entity: e.entity ?? null,
      before: (e.before ?? null) as never,
      after: (e.after ?? null) as never,
      meta: (e.meta ?? null) as never,
    });
  } catch {
    /* swallow — audit is best-effort and must never block the real operation */
  }
}

// A consistent actor label for the audit trail from a session-like object.
export function actorLabel(s: { name?: string; role?: string; userId?: string }): string {
  return `${s.name ?? s.userId ?? 'unknown'} (${s.role ?? 'unknown'})`;
}
