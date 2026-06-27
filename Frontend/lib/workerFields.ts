import type { FieldConfig } from '@/lib/types';

// The default field-permission matrix a new worker profile starts from. Single
// source of truth — used when a tenant is created, in the setup wizard, and when
// an owner adds a profile, so the three never drift apart. Money fields default
// to hidden; the things a worker actually records default to editable/required.
export const DEFAULT_WORKER_FIELDS: FieldConfig[] = [
  { fieldKey: 'feed_unit_cost', label: 'Feed unit cost (KES)', permission: 'hidden' },
  { fieldKey: 'feed_quantity', label: 'Feed quantity (kg)', permission: 'editable', required: true },
  { fieldKey: 'egg_sale_price', label: 'Egg sale price', permission: 'hidden' },
  { fieldKey: 'mortality_cause', label: 'Mortality cause', permission: 'editable' },
  { fieldKey: 'batch_profit_loss', label: 'Batch profit/loss', permission: 'hidden' },
  { fieldKey: 'water_level', label: 'Water level', permission: 'editable', required: true },
  { fieldKey: 'eggs_collected', label: 'Eggs collected', permission: 'editable', required: true },
  { fieldKey: 'abnormal', label: 'Abnormal observation', permission: 'editable', required: true },
];

export const DEFAULT_WORKER_MODULES = ['morning_round', 'mortality', 'feeding', 'health', 'weight_sampling', 'collect'];
