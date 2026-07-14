import { describe, it, expect } from 'vitest';
import { alertDestination } from '@/lib/alerts';
import type { Alert } from '@/lib/types';

const a = (p: Partial<Alert>): Alert => ({ id: 'x', tenantId: 't', type: 'task_missed', severity: 'info', title: '', message: '', acknowledged: false, createdAt: '' , ...p } as Alert);

describe('alert → responsible screen routing', () => {
  it('routes a mortality alert to its specific batch page', () => {
    expect(alertDestination(a({ id: 'auto:mortality:b1', type: 'mortality_spike' }))).toBe('/owner/farm/b1');
  });
  it('routes an assign-collector alert to People', () => {
    expect(alertDestination(a({ id: 'assign:xyz', type: 'task_missed' }))).toBe('/owner/people');
  });
  it('routes low-stock / expiry to Inventory', () => {
    expect(alertDestination(a({ type: 'low_stock' }))).toBe('/owner/inventory');
    expect(alertDestination(a({ type: 'expiry' }))).toBe('/owner/inventory');
  });
  it('routes vaccine/withdrawal to Farm', () => {
    expect(alertDestination(a({ type: 'overdue_vaccine' }))).toBe('/owner/farm');
  });

  // Real alert types actually raised by lib/server/alertEngine.ts / syncHandlers.ts —
  // previously all fell through to a generic page regardless of which batch/item/task
  // they were about, since the id-parsing only special-cased 'auto:mortality:'.
  it('routes a stage-due alert to its specific batch page', () => {
    expect(alertDestination(a({ id: 'auto:stage_due:b2:Grower', type: 'stage_due' }))).toBe('/owner/farm/b2');
  });
  it('routes a weight-loss alert to its specific batch page', () => {
    expect(alertDestination(a({ id: 'auto:weightloss:b3:c-uuid-1', type: 'weight_loss' }))).toBe('/owner/farm/b3');
  });
  it('routes a stock-variance alert to its specific batch page', () => {
    expect(alertDestination(a({ id: 'auto:variance:b4:c-uuid-2', type: 'stock_variance' }))).toBe('/owner/farm/b4');
  });
  it('routes an abnormal-observation alert to its specific batch page (batch id is the LAST id segment)', () => {
    expect(alertDestination(a({ id: 'auto:abnormal:c-uuid-3:b5', type: 'abnormal' }))).toBe('/owner/farm/b5');
  });
  it('routes an overdue-task alert to Tasks, not a generic page', () => {
    expect(alertDestination(a({ id: 'auto:overdue:t1', type: 'task_missed' }))).toBe('/owner/tasks');
  });
  it('routes a low-stock alert with its item id to Inventory', () => {
    expect(alertDestination(a({ id: 'auto:lowstock:i1', type: 'low_stock' }))).toBe('/owner/inventory');
  });
});
