// Pure reconstruction logic for scripts/recoverProductionConflicts.ts (#25).
// No DB, no 'server-only' — kept separate from the runnable script so it can
// be unit-tested directly, and so importing it never has the side effect of
// running the recovery script against a real database.
export interface ReconstructedRow {
  clientUuid: string;
  tenantId: string;
  batchId: string;
  type: string;
  qty: number;
  weightKg: number | null;
  productId: string | null;
  baseUnit: string | null;
  recordedBy: string;
  capturedAt: string;
  slotKey: string;
}

export type ReconstructResult =
  | { ok: true; row: ReconstructedRow }
  | { ok: false; reason: string };

// Reconstructs the production_records row a pre-#24 `kept_mine` conflict
// DELETEd, from the JSON snapshot conflict_log.server_version wrote right
// before that delete. Never guesses: any core field missing or malformed
// reports why instead of fabricating a value (#25's explicit scope).
export function reconstructDeletedRow(conflict: { tenantId: string; serverVersion: unknown }): ReconstructResult {
  const sv = conflict.serverVersion;
  if (!sv || typeof sv !== 'object' || Array.isArray(sv)) {
    return { ok: false, reason: 'server_version is missing or not an object' };
  }
  const v = sv as Record<string, unknown>;

  const clientUuid = v.clientUuid;
  if (typeof clientUuid !== 'string' || !clientUuid) return { ok: false, reason: 'server_version.clientUuid missing' };
  const batchId = v.batchId;
  if (typeof batchId !== 'string' || !batchId) return { ok: false, reason: 'server_version.batchId missing' };
  const type = v.type;
  if (typeof type !== 'string' || !type) return { ok: false, reason: 'server_version.type missing' };
  const qty = v.qty;
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return { ok: false, reason: 'server_version.qty missing or not a finite number' };
  const capturedAt = v.capturedAt;
  if (typeof capturedAt !== 'string' || Number.isNaN(Date.parse(capturedAt))) return { ok: false, reason: 'server_version.capturedAt missing or unparseable' };
  const recordedBy = v.recordedBy;
  if (typeof recordedBy !== 'string' || !recordedBy) return { ok: false, reason: 'server_version.recordedBy missing' };

  // tenantId isn't always present on older logged rows — the conflict_log
  // row itself is always correctly tenant-scoped (a real column, not
  // reconstructed JSON), so fall back to that rather than reject the row.
  const tenantId = typeof v.tenantId === 'string' && v.tenantId ? v.tenantId : conflict.tenantId;
  const weightKg = typeof v.weightKg === 'number' ? v.weightKg : null;
  const productId = typeof v.productId === 'string' ? v.productId : null;
  const baseUnit = typeof v.baseUnit === 'string' ? v.baseUnit : null;

  const day = capturedAt.slice(0, 10);
  // Distinguishing slot key (#25's AC): folds in the original client_uuid, so
  // it can never collide with the surviving record's own slot (which is
  // keyed on ITS client_uuid — see db/schemas/index.ts), and the literal
  // 'restored' marker documents in the data itself how this row came back.
  const slotKey = `${day}:${productId ?? 'none'}:restored:${clientUuid}`;

  return { ok: true, row: { clientUuid, tenantId, batchId, type, qty, weightKg, productId, baseUnit, recordedBy, capturedAt, slotKey } };
}
