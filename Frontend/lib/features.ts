// Commercial feature entitlements. A tenant's `features` array lists what their
// plan unlocks; the admin toggles these per farm.
export const FEATURES: { key: string; label: string; desc: string }[] = [
  { key: 'setup_guide', label: 'Setup Guide', desc: 'The floating onboarding walkthrough' },
  { key: 'ai_advisor', label: 'AI Advisor', desc: 'AI farm advice grounded in their data' },
  { key: 'reports', label: 'Reports & Exports', desc: 'PDF/Excel/CSV report exports' },
  { key: 'activity_log', label: 'Worker Activity Log', desc: 'Per-worker daily activity + photos' },
  { key: 'alerts', label: 'Alerts', desc: 'Rule-based alert engine' },
  { key: 'finance', label: 'Finance & P&L', desc: 'Sales, purchases, batch profitability' },
];

export const ALL_FEATURE_KEYS = FEATURES.map((f) => f.key);

export const PLANS: Record<string, string[]> = {
  free: ['setup_guide', 'finance'],
  standard: ['setup_guide', 'finance', 'reports', 'alerts', 'activity_log'],
  pro: ALL_FEATURE_KEYS,
};
