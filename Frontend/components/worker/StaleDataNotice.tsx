'use client';
import React from 'react';
import { CloudOff } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';

// Short relative age (e.g. "2 h") — cachedAt is only ever a few hours to a
// few days old (warmed on every online mount/sync), so minutes/hours/days
// is enough resolution.
function ageLabel(cachedAt: string): string {
  const mins = Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000);
  if (mins < 1) return '<1 m';
  if (mins < 60) return `${mins} m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function StaleDataNotice({ cachedAt }: { cachedAt: string | null }) {
  const { t } = useTranslation();
  if (!cachedAt) return null;
  return (
    <p className="flex items-center gap-1.5 text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm font-semibold">
      <CloudOff className="w-4 h-4 shrink-0" />
      {t('showingSavedData')} ({ageLabel(cachedAt)} {t('ago')})
    </p>
  );
}
