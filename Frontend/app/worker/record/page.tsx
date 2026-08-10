'use client';
// Worker "Record" bottom-tab landing page — a menu of all record types.
// Reuses the exact tile pattern (icons, translated labels, doneToday badge)
// from the "Quick Record Links" section on app/worker/home/page.tsx, so the
// tab has somewhere sensible to land instead of jumping straight into
// Morning Round (Phase 6 item 3).
import React from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useTodayActivity, timeLabel } from '@/lib/hooks/useTodayActivity';
import {
  Egg, Sunrise, Skull, Wheat, Syringe, Scale, ListOrdered, PackageOpen, Check,
} from 'lucide-react';

// Grouped by real operational cadence rather than an arbitrary list — daily
// routine work first, event-triggered records next, periodic stock
// reconciliation last. Same tile-tap interaction, just organized.
const RECORD_GROUPS = [
  { headingKey: 'recordGroupEveryDay', links: [
    { href: '/worker/record/morning-round', Icon: Sunrise, labelKey: 'morningRound', type: 'morning_round' },
    { href: '/worker/record/feeding', Icon: Wheat, labelKey: 'feedingLog', type: 'feeding' },
    { href: '/worker/record/collect', Icon: Egg, labelKey: 'collectProducts', type: 'production' },
  ] },
  { headingKey: 'recordGroupAsNeeded', links: [
    { href: '/worker/record/mortality', Icon: Skull, labelKey: 'recordMortality', type: 'mortality' },
    { href: '/worker/record/health', Icon: Syringe, labelKey: 'healthVaccination', type: 'health' },
  ] },
  { headingKey: 'recordGroupStockCounts', links: [
    { href: '/worker/record/weight-sampling', Icon: Scale, labelKey: 'weightSample', type: 'weight_sample' },
    { href: '/worker/record/physical-count', Icon: ListOrdered, labelKey: 'physicalCount', type: 'physical_count' },
    { href: '/worker/record/closing-stock', Icon: PackageOpen, labelKey: 'closingStock', type: 'closing_stock' },
  ] },
] as const;

export default function RecordMenuPage() {
  const { t } = useTranslation();
  const { doneToday } = useTodayActivity();

  return (
    <div className="p-4 flex flex-col gap-6 md:max-w-2xl md:mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t('record')}</h1>
        <p className="text-sm text-gray-500">{t('recordMenuSubtitle')}</p>
      </div>
      {RECORD_GROUPS.map(group => (
        <div key={group.headingKey} className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{t(group.headingKey)}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {group.links.map(r => {
              const d = doneToday(r.type);
              return (
                <Link key={r.href} href={r.href}>
                  <div className={`bg-white border rounded-xl px-4 py-3 flex items-center gap-3 active:bg-gray-50 min-h-[56px] ${d.count > 0 ? 'border-success/40' : 'border-gray-200'}`}>
                    <span className="w-9 h-9 rounded-lg bg-muted text-foreground flex items-center justify-center shrink-0"><r.Icon className="w-5 h-5" strokeWidth={2} /></span>
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-gray-700 block">{t(r.labelKey)}</span>
                      {d.count > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-success font-semibold"><Check className="w-3 h-3" /> {d.count} {t('today')} · {timeLabel(d.lastAt)}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
