'use client';
// ── Select (ui-kit) — a real listbox, not a restyled native <select>. Same
// reasoning as MasterPicker's datalist replacement in components/farm/
// ui-shared.tsx: a native <select>'s open list is drawn by the browser (a
// blue system list on desktop Chrome) and CSS cannot reach it. This draws
// the popup with our own tokens/roles/44px rows so the two feel like one
// family.
//
// Authoring API stays close to <select>: pass <option value=...>Label
// </option> children (parsed below into a plain option list) and a plain
// string `value` + `onChange(value)` — the one deliberate difference from
// native <select>, which hands back an event. Callers adapt with
// `onChange={(v) => setX(v)}` instead of `onChange={(e) => setX(e.target.
// value)}`; everything else about a call site (state, validation, disabled
// rules, option order) is unchanged.
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { controlClass } from './field';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return;
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    options.push({
      value: props.value === undefined ? '' : String(props.value),
      label: props.children,
      disabled: props.disabled,
    });
  });
  return options;
}

function labelText(label: ReactNode): string {
  return typeof label === 'string' || typeof label === 'number' ? String(label) : '';
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  title?: string;
  style?: CSSProperties;
}

export function Select({
  value,
  onChange,
  children,
  placeholder,
  disabled,
  className,
  id,
  name,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  title,
  style,
}: SelectProps) {
  const options = optionsFromChildren(children);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeBuf = useRef('');
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactId = useId();
  const listboxId = id ? `${id}-listbox` : `select-${reactId}-listbox`;
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function firstEnabled(from: number, dir: 1 | -1) {
    let i = from;
    while (i >= 0 && i < options.length) {
      if (!options[i].disabled) return i;
      i += dir;
    }
    return -1;
  }

  // Anchored with position:fixed (computed from the trigger's viewport
  // rect) rather than absolute-inside-the-sheet: a sheet body scrolls with
  // overflow-y-auto, which clips an absolutely-positioned popover but not a
  // fixed one, and nothing in this app puts a transform on a sheet's
  // ancestors (see ui-kit/dialog.tsx's comment) so fixed positioning here
  // isn't itself trapped. Flips upward when there isn't room below.
  function place() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estHeight = Math.min(options.length * 44 + 8, 288);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estHeight && rect.top > spaceBelow;
    setPos({ top: rect.top, left: rect.left, width: rect.width, openUp });
  }

  function openList() {
    if (disabled || options.length === 0) return;
    place();
    const start = selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1);
    setHighlight(start >= 0 ? start : 0);
    setOpen(true);
  }

  function closeList(refocus = false) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    closeList(true);
  }

  // Outside click, scroll-away and resize all close the list — the phone
  // case ("closes on scroll-away or backdrop tap") falls out of the same
  // scroll handler as the desktop clipping case.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) closeList();
    }
    function onScroll(e: Event) {
      if (listRef.current && listRef.current.contains(e.target as Node)) return;
      closeList();
    }
    function onResize() {
      closeList();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${highlight}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const i = firstEnabled(highlight + 1, 1);
        if (i >= 0) setHighlight(i);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const i = firstEnabled(highlight - 1, -1);
        if (i >= 0) setHighlight(i);
        break;
      }
      case 'Home': {
        e.preventDefault();
        const i = firstEnabled(0, 1);
        if (i >= 0) setHighlight(i);
        break;
      }
      case 'End': {
        e.preventDefault();
        const i = firstEnabled(options.length - 1, -1);
        if (i >= 0) setHighlight(i);
        break;
      }
      case 'Enter':
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        commit(highlight);
        break;
      case 'Escape':
        e.preventDefault();
        closeList(true);
        break;
      case 'Tab':
        closeList();
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          if (typeTimer.current) clearTimeout(typeTimer.current);
          typeBuf.current += e.key.toLowerCase();
          const buf = typeBuf.current;
          typeTimer.current = setTimeout(() => {
            typeBuf.current = '';
          }, 600);
          const match = options.findIndex((o) => !o.disabled && labelText(o.label).toLowerCase().startsWith(buf));
          if (match >= 0) setHighlight(match);
        }
    }
  }

  const triggerLabel = selected ? selected.label : <span className="text-subtle">{placeholder ?? 'Select…'}</span>;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        id={id}
        name={name}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && highlight >= 0 ? optionId(highlight) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        style={style}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          controlClass,
          'flex items-center justify-between gap-2 text-left disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && pos && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top + 4,
            bottom: pos.openUp ? window.innerHeight - pos.top + 4 : undefined,
            left: pos.left,
            width: pos.width,
          }}
          className="z-50 max-h-64 overflow-y-auto rounded-xl bg-surface py-1 shadow-(--shadow-raised) ring-1 ring-border"
        >
          {options.map((opt, i) => (
            <li key={`${opt.value}-${i}`} data-index={i}>
              <button
                type="button"
                id={optionId(i)}
                role="option"
                aria-selected={opt.value === value}
                disabled={opt.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(i)}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm',
                  opt.disabled ? 'cursor-not-allowed text-subtle opacity-50' : 'cursor-pointer hover:bg-primary-soft',
                  i === highlight && !opt.disabled && 'bg-primary-soft',
                  opt.value === value ? 'font-medium text-primary' : 'text-fg',
                )}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === value && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
