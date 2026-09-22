'use client';
// ── Plan selection / gate (package H2, SaaS back-office) ────────────────────
// PlanSelectScreen is reached two ways: as the forced gate app/page.tsx
// renders instead of the dashboard when session.subscription.needsPlan is
// true for an owner (`variant="gate"`), or voluntarily from the Plan &
// billing screen's "Change plan" action (`variant="change"`, the default).
// PlanNeedsAttentionScreen is what a non-owner sees during the same gate —
// billing is an owner-level concern throughout the backend
// (docs/backoffice-api.md), so a manager/worker/vet/auditor can only wait.
//
// Backend: GET /api/billing/plans, POST /api/billing/quote (preview only, no
// redemption consumed), POST /api/billing/subscribe. All three untouched —
// see docs/backoffice-api.md §2.
import React, { useEffect, useMemo, useState } from 'react';
import { useNav, TopNav } from '@/components/farm/navigation';
import { apiClient } from '@/lib/request';
import { useToast } from '@/components/farm/ui-shared';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Segmented } from '@/components/ui-kit/segmented';
import { Badge } from '@/components/ui-kit/badge';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { Field } from '@/components/ui-kit/field';
import { cn } from '@/lib/utils';
import { Check, Sparkles } from 'lucide-react';

type Period = 'monthly' | 'quarterly' | 'annual';

interface Plan {
  id: string;
  code: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  limits: { maxFarms: number | null; maxUsers: number | null; maxUnits: number | null };
  prices: Partial<Record<Period, number>>;
  currency: string;
  trialDays: number;
}

interface Quote {
  listPriceCents: number;
  discountAmountCents: number;
  amountDueCents: number;
}

function limitLabel(n: number | null, unit: string): string {
  return n === null ? `Unlimited ${unit}` : `Up to ${n} ${unit}`;
}

// Real saving vs the monthly rate, computed from the plan's own prices —
// never a hardcoded "10% off" badge.
function savingPct(plan: Plan | undefined, period: Period): number | null {
  if (!plan) return null;
  const monthly = plan.prices.monthly;
  const price = plan.prices[period];
  if (!monthly || !price || period === 'monthly') return null;
  const periods = period === 'quarterly' ? 3 : 12;
  const monthlyEquivalent = price / periods;
  const pct = Math.round((1 - monthlyEquivalent / monthly) * 100);
  return pct > 0 ? pct : null;
}

export function PlanSelectScreen({ variant = 'change' }: { variant?: 'gate' | 'change' }) {
  const { goBack, refreshSubscription, navigate } = useNav();
  const { showToast } = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [period, setPeriod] = useState<Period>('monthly');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient.get<Plan[]>('/api/billing/plans').then((res) => {
      if (cancelled || !res.success || !Array.isArray(res.data)) return;
      setPlans(res.data);
      // Middle plan (by the order the API returns, already sortOrder-sorted)
      // is the recommended one — the lead's call, not an invented "featured"
      // flag the schema doesn't have.
      if (res.data.length) setSelectedId(res.data[Math.floor((res.data.length - 1) / 2)].id);
    });
    return () => { cancelled = true; };
  }, []);

  const selectedPlan = plans?.find((p) => p.id === selectedId);

  useEffect(() => {
    if (!selectedPlan || !selectedPlan.prices[period]) { setQuote(null); setQuoteError(null); return; }
    let cancelled = false;
    setQuoteError(null);
    const t = setTimeout(() => {
      apiClient.post<Quote>('/api/billing/quote', {
        planId: selectedPlan.id,
        period,
        discountCode: discountCode.trim() || undefined,
      }).then((res) => {
        if (cancelled) return;
        if (res.success && res.data) { setQuote(res.data); setQuoteError(null); }
        else { setQuote(null); setQuoteError(res.success ? null : res.error); }
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [selectedPlan, period, discountCode]);

  async function handleSubscribe() {
    if (!selectedPlan) return;
    setSubmitting(true);
    const res = await apiClient.post<{ status: string }>('/api/billing/subscribe', {
      planId: selectedPlan.id,
      period,
      discountCode: discountCode.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.success) { showToast(res.error, 'error'); return; }
    showToast(
      res.data.status === 'trialing' ? `Your ${selectedPlan.trialDays}-day trial has started.` : 'Plan selected — record a payment to activate it.',
      'success'
    );
    refreshSubscription();
    navigate('billing');
  }

  const periodItems = (['monthly', 'quarterly', 'annual'] as Period[]).map((p) => {
    const pct = savingPct(selectedPlan, p);
    return { id: p, label: p[0].toUpperCase() + p.slice(1), hint: pct ? `Save ${pct}%` : (p === 'monthly' ? 'No commitment' : undefined) };
  });

  return (
    <div className="screen-content">
      <TopNav title="Choose your plan" showBack={variant === 'change'} showBell={false} />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Company"
          title="Plans that grow with your farm"
          lede="Pick a plan, a billing period, and start a free trial — change or cancel any time from Plan & billing."
        />

        <div className="mt-5 sticky z-10 bg-bg/95 py-1 backdrop-blur" style={{ top: 'var(--nav-height)' }}>
          <Segmented value={period} onChange={setPeriod} items={periodItems} />
        </div>

        {plans === null ? (
          <div className="py-10 text-center text-sm text-muted">Loading plans…</div>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {plans.map((plan, i) => {
              const recommended = i === Math.floor((plans.length - 1) / 2);
              const active = plan.id === selectedId;
              const price = plan.prices[period];
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedId(plan.id)}
                  className={cn(
                    'flex flex-col rounded-xl bg-surface p-5 text-left shadow-(--shadow-border) transition-shadow',
                    active && 'shadow-(--shadow-border-hover) ring-2 ring-primary',
                  )}
                >
                  {recommended && (
                    <Badge variant="primary" className="mb-2 w-fit gap-1"><Sparkles size={11} /> Recommended</Badge>
                  )}
                  <div className="font-display text-2xl font-medium">{plan.name}</div>
                  <div className="mt-1 text-sm text-muted">{plan.tagline}</div>
                  <div className="mt-4">
                    {price ? (
                      <>
                        <span className="font-display text-3xl font-medium tabular-nums">{formatMoney(price, plan.currency)}</span>
                        <span className="text-sm text-muted"> / {period}</span>
                      </>
                    ) : (
                      <span className="text-sm text-subtle">Not offered {period}</span>
                    )}
                  </div>
                  {plan.trialDays > 0 && <div className="mt-1 text-xs text-primary">{plan.trialDays}-day free trial</div>}
                  <ul className="mt-4 flex flex-col gap-2 text-sm">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-primary" /> {f}</li>
                    ))}
                  </ul>
                  <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-xs text-subtle">
                    <span>{limitLabel(plan.limits.maxFarms, 'farms')}</span>
                    <span>{limitLabel(plan.limits.maxUsers, 'users')}</span>
                    <span>{limitLabel(plan.limits.maxUnits, 'units')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedPlan && (
          <div className="mt-6 rounded-xl bg-surface p-5 shadow-(--shadow-border)">
            <Field label="Discount code (optional)">
              <Input value={discountCode} onChange={(e) => setDiscountCode(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10" />
            </Field>
            {quoteError && <p className="mt-2 text-sm text-danger">{quoteError}</p>}
            {quote && (
              <dl className="mt-3 flex flex-col gap-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">List price</dt><dd>{formatMoney(quote.listPriceCents, selectedPlan.currency)}</dd></div>
                {quote.discountAmountCents > 0 && (
                  <div className="flex justify-between text-success"><dt>Discount</dt><dd>-{formatMoney(quote.discountAmountCents, selectedPlan.currency)}</dd></div>
                )}
                <div className="flex justify-between font-medium"><dt>Due now</dt><dd>{formatMoney(quote.amountDueCents, selectedPlan.currency)}</dd></div>
              </dl>
            )}
            <Button className="mt-4 w-full" size="lg" disabled={submitting || !selectedPlan.prices[period]} onClick={handleSubscribe}>
              {submitting ? 'Please wait…' : selectedPlan.trialDays > 0 ? `Start ${selectedPlan.trialDays}-day trial` : 'Continue to payment'}
            </Button>
            {variant === 'change' && (
              <Button className="mt-2 w-full" variant="ghost" onClick={goBack}>Cancel</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Non-owner gate screen (lead decision #1): calm, no dead-ends other than
// sign-out (via TopNav's own sign-out button — no owner name is available to
// a non-owner session anywhere in this codebase's API, so this deliberately
// says "the farm's owner" rather than guessing/inventing a name).
export function PlanGateWaitingScreen() {
  return (
    <div className="screen-content">
      <TopNav title="" showBell={false} />
      <div className="px-screen flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="font-display text-2xl font-medium">Your farm's plan needs attention</div>
        <p className="max-w-sm text-sm text-muted">
          Ask this farm's owner to choose a plan and add payment details before you can continue.
        </p>
      </div>
    </div>
  );
}
