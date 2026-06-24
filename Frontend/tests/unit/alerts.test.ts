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
});
