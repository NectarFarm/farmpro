'use client';
// ── DateField (ui-kit) ──────────────────────────────────────────────────────
// A native <input type="date"> always renders in the BROWSER's locale, so the
// farm's Date format setting (DD/MM/YYYY etc.) could never show through. This
// shows and accepts the date in the farm's format as text, keeps a real ISO
// "YYYY-MM-DD" as the value, and a calendar button opens the native picker
// (a hidden <input type="date"> + showPicker(), so phones still get their
// own wheel/calendar). value/onChange are ISO in and out — nothing stored or
// sent changes shape.
import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIsoDay, parseDateInput } from '@/lib/datetime';
import { useRegional } from '@/components/farm/settings';

interface DateFieldProps {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

export function DateField({ value, onChange, min, max, disabled, required, className, id, invalid, ...rest }: DateFieldProps) {
  const { dateFormat } = useRegional();
  const shown = value ? formatIsoDay(value, dateFormat) : '';
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(shown); setBad(false); }, [shown]);

  function commit(raw: string) {
    if (!raw.trim()) { setBad(false); if (value) onChange(''); return; }
    const iso = parseDateInput(raw, dateFormat);
    if (!iso || (min && iso < min) || (max && iso > max)) { setBad(true); return; }
    setBad(false);
    if (iso !== value) onChange(iso);
    setText(formatIsoDay(iso, dateFormat));
  }

  function openPicker() {
    const el = picker.current;
    if (!el || disabled) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }

  return (
    <div className={cn('relative w-full', className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={dateFormat.toLowerCase()}
        value={text}
        disabled={disabled}
        required={required}
        aria-invalid={bad || invalid || undefined}
        aria-describedby={rest['aria-describedby']}
        aria-label={rest['aria-label']}
        data-slot="input"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        className={cn(
          'h-10 w-full min-w-0 rounded-md bg-surface pl-3 pr-10 text-sm text-fg shadow-(--shadow-border) outline-none placeholder:text-subtle',
          'transition-[box-shadow,background-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/30',
          'disabled:pointer-events-none disabled:opacity-50',
          (bad || invalid) && 'ring-2 ring-red-500/50',
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Pick a date"
        disabled={disabled}
        onClick={openPicker}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-muted hover:text-fg disabled:opacity-50"
      >
        <CalendarDays size={16} />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
    </div>
  );
}
