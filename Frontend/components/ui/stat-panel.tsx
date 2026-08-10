import * as React from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface StatPanelProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Semantic read on the value — drives text color, not the whole card. */
  tone?: 'neutral' | 'good' | 'bad';
  sub?: string;
  /** 'hero' is for a single large standout number (worker Pay/Profile) — bigger
   *  type, heavier weight, wider tracking, standing in for a serif treatment
   *  without loading a second font. */
  variant?: 'default' | 'hero';
  className?: string;
}

const TONE_TEXT: Record<NonNullable<StatPanelProps['tone']>, string> = {
  neutral: 'text-foreground',
  good: 'text-success',
  bad: 'text-destructive',
};

// Hairline-border card with a small ink-colored badge in place of the
// pastel-icon-circle + shadow pattern it replaces — reused as-is by both the
// owner/admin KPI rows and (via variant="hero") the worker Pay/Profile hero
// number, so it deliberately carries no pastel/tint styling of its own.
export function StatPanel({ label, value, icon: Icon, tone = 'neutral', sub, variant = 'default', className }: StatPanelProps) {
  const hero = variant === 'hero';
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 flex flex-col gap-3', hero && 'p-5 gap-4', className)}>
      <div className="flex items-center justify-between">
        <span className={cn('inline-flex items-center justify-center rounded-md bg-muted text-foreground', hero ? 'w-9 h-9' : 'w-8 h-8')}>
          <Icon className={hero ? 'w-[18px] h-[18px]' : 'w-4 h-4'} strokeWidth={2} />
        </span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
      <div>
        <p className={cn(
          '[font-variant-numeric:tabular-nums] tracking-tight',
          hero ? 'text-3xl font-extrabold tracking-[-0.01em]' : 'text-2xl font-bold',
          TONE_TEXT[tone],
        )}>{value}</p>
        <p className={cn('text-muted-foreground mt-0.5', hero ? 'text-xs font-semibold uppercase tracking-wide' : 'text-xs')}>{label}</p>
      </div>
    </div>
  );
}
