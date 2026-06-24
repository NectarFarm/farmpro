import type { Alert } from '@/lib/types';

// Where clicking an alert should take the farmer to act on it.
export const alertDestination = (a: Alert): string => {
  if (a.id?.startsWith('auto:mortality:')) return `/owner/farm/${a.id.replace('auto:mortality:', '')}`;
  if (a.id?.startsWith('assign:')) return '/owner/people';
  switch (a.type) {
    case 'low_stock': case 'expiry': case 'feed_variance': return '/owner/inventory';
    case 'mortality_spike': case 'overdue_vaccine': case 'withdrawal_violation': case 'water_quality': return '/owner/farm';
    case 'task_missed': return '/owner/activity';
    default: return '/owner/farm';
  }
};
