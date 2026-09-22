'use client';
// ── Trial-ending / past-due banner (package H2, SaaS back-office) ──────────
// Mounted once in app/page.tsx's ScreenRouter, above the screen slot, so it
// is visible from every screen without a per-screen edit. Dismissible "per
// session" = plain component state: it comes back on next login/reload,
// which is the whole point (a subscription that's still trialing/past_due
// tomorrow should say so again). Reads NavContext's `subscription`, already
// populated at boot from GET /api/auth/session — no extra fetch here.
import { useState } from 'react';
import { useNav } from '@/components/farm/navigation';
import { X, AlertTriangle } from 'lucide-react';

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function SubscriptionBanner() {
  const { role, subscription, navigate } = useNav();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || role === 'super_admin' || !subscription) return null;

  const left = daysLeft(subscription.trialEndsAt);
  const trialEnding = subscription.status === 'trialing' && left !== null && left <= 5;
  const pastDue = subscription.status === 'past_due';
  if (!trialEnding && !pastDue) return null;

  const message = pastDue
    ? "Your last payment hasn't been confirmed yet — your plan is past due."
    : left !== null && left <= 0
      ? 'Your trial ends today.'
      : `Your trial ends in ${left} day${left === 1 ? '' : 's'}.`;

  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-sm text-warning lg:mx-5">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={() => navigate('billing')} className="shrink-0 font-medium underline underline-offset-2">
        View
      </button>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss" className="shrink-0 rounded p-0.5 hover:bg-warning/10">
        <X size={14} />
      </button>
    </div>
  );
}
