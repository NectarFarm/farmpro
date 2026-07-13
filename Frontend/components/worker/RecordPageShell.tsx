import { CheckCircle2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// The 8 worker record pages each hand-roll a solid-color hero banner and (most
// of them) an identical "saved, will sync" success screen. These two pieces
// are pulled out here — everything else (form fields, validation, submit
// wiring, camera capture) stays exactly where it is, per page.

const ACCENT_BG: Record<string, string> = {
  red: 'bg-red-700', green: 'bg-green-700', blue: 'bg-blue-700',
  purple: 'bg-purple-700', orange: 'bg-orange-700', teal: 'bg-teal-700',
};
const ACCENT_SUBTLE: Record<string, string> = {
  red: 'text-red-200', green: 'text-green-200', blue: 'text-blue-200',
  purple: 'text-purple-200', orange: 'text-orange-200', teal: 'text-teal-200',
};

export type RecordAccent = keyof typeof ACCENT_BG;

interface RecordHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  accent: RecordAccent;
  /** morning-round's "start" screen uses a taller, more padded hero than the
   *  other 7 pages' compact banner — same shape, different scale. */
  size?: 'default' | 'lg';
  className?: string;
}

export function RecordHeader({ icon: Icon, title, subtitle, accent, size = 'default', className }: RecordHeaderProps) {
  return (
    <div className={cn(ACCENT_BG[accent], 'text-white rounded-2xl', size === 'lg' ? 'p-6' : 'px-5 py-4', className)}>
      <h1 className={cn('font-bold flex items-center gap-2 text-2xl', size === 'lg' && 'mb-1')}>
        <Icon className="w-6 h-6 shrink-0" /><span>{title}</span>
      </h1>
      {subtitle && <p className={cn(ACCENT_SUBTLE[accent], 'text-sm')}>{subtitle}</p>}
    </div>
  );
}

interface RecordSavedScreenProps {
  message: string;
  doneLabel: string;
  onDone: () => void;
  sub?: string;
}

// The full-page "saved, will sync" success state used by mortality, health,
// weight-sampling and physical-count — the pages with no running list to keep
// adding to, so a dead-end confirmation + explicit "back home" is the right
// shape (feeding/collect use a different "stay in flow, add another" pattern
// and don't use this).
export function RecordSavedScreen({ message, doneLabel, onDone, sub }: RecordSavedScreenProps) {
  return (
    <div className="p-4 flex flex-col gap-5 md:max-w-lg md:mx-auto">
      <div className="bg-success/10 border border-success/30 rounded-2xl p-6 text-center">
        <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-2" />
        <h1 className="text-xl font-bold text-success">{message}</h1>
        {sub && <p className="text-sm text-success/90 mt-1">{sub}</p>}
      </div>
      <button onClick={onDone} className="w-full min-h-[56px] bg-primary text-primary-foreground rounded-xl text-xl font-bold">
        {doneLabel}
      </button>
    </div>
  );
}
