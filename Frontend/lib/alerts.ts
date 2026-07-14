import type { Alert } from '@/lib/types';

// Where clicking an alert should take the farmer to act on it. Every
// server-raised alert id is deterministic and prefix-tagged with the entity
// it's about (lib/server/alertEngine.ts, lib/server/syncHandlers.ts) — parse
// that instead of switching on `type` alone, since most real alert types
// (weight_loss, stock_variance, abnormal, stage_due) need a specific BATCH
// page, not a generic section list.
export const alertDestination = (a: Alert): string => {
  const id = a.id ?? '';

  // auto:mortality:BATCHID
  const mortality = id.match(/^auto:mortality:(.+)$/);
  if (mortality) return `/owner/farm/${mortality[1]}`;

  // auto:stage_due:BATCHID:NEXTSTAGE
  const stageDue = id.match(/^auto:stage_due:([^:]+):/);
  if (stageDue) return `/owner/farm/${stageDue[1]}`;

  // auto:weightloss:BATCHID:CLIENTUUID
  const weightLoss = id.match(/^auto:weightloss:([^:]+):/);
  if (weightLoss) return `/owner/farm/${weightLoss[1]}`;

  // auto:variance:BATCHID:CLIENTUUID
  const variance = id.match(/^auto:variance:([^:]+):/);
  if (variance) return `/owner/farm/${variance[1]}`;

  // auto:abnormal:CLIENTUUID:BATCHID (batch id is the LAST segment here)
  const abnormal = id.match(/^auto:abnormal:.+:([^:]+)$/);
  if (abnormal) return `/owner/farm/${abnormal[1]}`;

  // auto:lowstock:ITEMID — no per-item detail page, Inventory is the right target.
  if (id.startsWith('auto:lowstock:')) return '/owner/inventory';

  // auto:overdue:TASKID — no per-task detail page, Tasks list is the right target.
  if (id.startsWith('auto:overdue:')) return '/owner/tasks';

  // assign:PRODUCTID — "assign a collector"; done from People, not a product page.
  if (id.startsWith('assign:')) return '/owner/people';

  // Fallback for any alert without a recognized id shape to parse (e.g. a
  // future rule type raised without following this id convention).
  switch (a.type) {
    case 'low_stock': case 'expiry': case 'feed_variance': return '/owner/inventory';
    case 'mortality_spike': case 'overdue_vaccine': case 'withdrawal_violation': case 'water_quality':
    case 'stage_due': case 'weight_loss': case 'stock_variance': case 'abnormal':
      return '/owner/farm';
    case 'task_missed': return '/owner/tasks';
    default: return '/owner/farm';
  }
};
