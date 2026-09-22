'use client';
// ── Platform-staff capability gating (docs/backoffice-api.md §1) ────────────
// GET /api/admin/me returns the CALLER's own resolved capabilities — a
// super_admin with no platform_staff row gets every capability back (backend
// backward-compat rule, lib/platform-staff.ts). The UI reads this once per
// admin session and uses it to hide actions the caller's own capability set
// doesn't cover; the backend enforces the real boundary on every route
// regardless (requirePlatformCapability), so this is a courtesy — it never
// invents a permission the server wouldn't also grant.
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';

export const CAPABILITIES = [
  'tenants.manage',
  'users.manage',
  'billing.manage',
  'support.handle',
  'support.assign',
  'staff.manage',
  'onboarding.review',
  'impersonate',
  'analytics.view',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// Plain-English description per capability — shown on the staff editor's
// checklist so an admin creating a colleague's account knows exactly what
// each box unlocks, per the brief ("capabilities checklist with plain-
// English descriptions of what each allows").
export const CAPABILITY_LABEL: Record<Capability, string> = {
  'tenants.manage': 'Tenants & farms',
  'users.manage': 'User management',
  'billing.manage': 'Billing & plans',
  'support.handle': 'Handle support tickets',
  'support.assign': 'Assign tickets to others',
  'staff.manage': 'Manage platform staff',
  'onboarding.review': 'Review onboarding requests',
  'impersonate': 'Impersonate tenant users',
  'analytics.view': 'View platform stats',
};

export const CAPABILITY_DESCRIPTION: Record<Capability, string> = {
  'tenants.manage': 'See every tenant, suspend/reactivate them, manage their farms and add admin notes.',
  'users.manage': 'Search and edit any user, reset passwords, and force a sign-out.',
  'billing.manage': 'Edit plans and discounts, change a tenant’s subscription, and confirm or reject payments.',
  'support.handle': 'See the ticket queue, reply to tickets, and open tickets on behalf of a tenant.',
  'support.assign': 'Assign a ticket to a colleague, not just to yourself. Requires support.handle to be useful.',
  'staff.manage': 'Create, edit and deactivate other platform staff accounts — including this one.',
  'onboarding.review': 'Approve, reject or request more information on new-tenant applications.',
  'impersonate': 'Sign in as a tenant user for a time-boxed, audited window.',
  'analytics.view': 'See platform-wide stats on the Overview screen.',
};

// Presets offered on the staff-create/edit sheet (brief: "Support agent" =
// support.handle; "Support lead" = support.handle + support.assign;
// "Billing" = billing.manage + analytics.view; "Full admin" = all).
export const CAPABILITY_PRESETS: { id: string; label: string; capabilities: Capability[] }[] = [
  { id: 'support-agent', label: 'Support agent', capabilities: ['support.handle'] },
  { id: 'support-lead', label: 'Support lead', capabilities: ['support.handle', 'support.assign'] },
  { id: 'billing', label: 'Billing', capabilities: ['billing.manage', 'analytics.view'] },
  { id: 'full-admin', label: 'Full admin', capabilities: [...CAPABILITIES] },
];

export interface AdminMe {
  userId: string;
  name: string;
  email: string;
  capabilities: Capability[];
}

// Loading is represented as `null` capabilities (not an empty array — an
// empty array would read as "no permissions", a real and different state)
// so a screen can tell "still checking" from "confirmed: nothing".
export function useAdminCapabilities(): { me: AdminMe | null; loading: boolean; has: (cap: Capability) => boolean } {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<AdminMe>('/api/admin/me').then((res) => {
      if (cancelled) return;
      if (res.success) setMe(res.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // While loading, `has` optimistically allows — the backend is the real
  // gate, and briefly showing an action that a 403 will refuse a beat later
  // is far less confusing than every admin screen flashing "no access" on
  // every load before the very first fetch resolves.
  function has(cap: Capability): boolean {
    if (loading) return true;
    return !!me?.capabilities.includes(cap);
  }

  return { me, loading, has };
}
