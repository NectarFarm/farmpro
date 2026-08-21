'use client';
/**
 * DataTable – mobile-first, large-data-capable table for the IFMS app.
 *
 * Features
 * ─────────
 * • Virtual window rendering – only ~40 rows around the viewport are in the DOM.
 * • Sticky header with sort indicators (click to sort asc/desc).
 * • Drag-to-reorder columns – grab the ⠿ grip on any header; a highlight shows
 *   the insertion target; drop to commit; order persisted to localStorage.
 * • Summary totals footer – each ColDef may declare summary:"sum"|"avg"|"count"|
 *   "min"|"max" or a custom renderer; values are computed over ALL filtered rows
 *   (not just the current page) and shown in a sticky <tfoot> row.
 * • Density toggle: Normal (44 px rows) ↔ Compact (28 px rows); persisted.
 * • Rows-per-page selector with pagination controls; persisted.
 * • tableId prop: density, page-size, and column order are saved under
 *   localStorage key "dt:<tableId>:*".  Pass a stable string per table.
 * • Zebra-stripe option (off by default to match dark-farm theme).
 * • Count footer: "1–20 of 847 rows".
 */

import React, {
  useCallback, useMemo, useRef, useState, useEffect, DragEvent,
} from 'react';
import { ChevronUp, ChevronDown } from './icons';

/* ── Types ───────────────────────────────────────────────────────────────── */

export type ColAlign = 'left' | 'right' | 'center';
export type SummaryType = 'sum' | 'avg' | 'count' | 'min' | 'max';

export interface ColDef<T extends Record<string, unknown>> {
  key: keyof T | string;
  header: string;
  minWidth?: number;
  align?: ColAlign;
  sortable?: boolean;
  render?: (row: T, idx: number) => React.ReactNode;
  pinned?: boolean;
  /**
   * How to aggregate this column in the tfoot summary row.
   * Use a SummaryType string for numeric columns, or a function for custom
   * rendering (e.g. show "Total" label in the first column).
   */
  summary?: SummaryType | ((rows: T[]) => React.ReactNode);
}

export interface DataTableProps<T extends Record<string, unknown>> {
  rows: T[];
  columns: ColDef<T>[];
  rowKey?: (row: T, idx: number) => string | number;
  onRowClick?: (row: T, idx: number) => void;
  pageSizes?: number[];
  defaultPageSize?: number;
  bodyHeight?: number;
  zebra?: boolean;
  emptyText?: string;
  className?: string;
  /**
   * Stable identifier used to persist column order, density, and page-size in
   * localStorage.  If omitted state is not persisted.
   */
  tableId?: string;
}

/* ── Constants ───────────────────────────────────────────────────────────── */

const WIN = 40;
const RH_NORMAL = 44;
const RH_COMPACT = 28;
const DEFAULT_SIZES = [20, 50, 100, 200];

/* ── localStorage helpers ────────────────────────────────────────────────── */

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch { /* ignore */ }
}

/* ── Numeric summary helpers ─────────────────────────────────────────────── */

function numVals<T extends Record<string, unknown>>(rows: T[], key: string): number[] {
  return rows.map(r => {
    const v = r[key as keyof T];
    return typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  }).filter(n => !isNaN(n));
}

function calcSummary<T extends Record<string, unknown>>(
  col: ColDef<T>,
  rows: T[],
): React.ReactNode {
  if (!col.summary) return null;
  if (typeof col.summary === 'function') return col.summary(rows);
  const nums = numVals(rows, col.key as string);
  if (!nums.length) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  let val: number;
  switch (col.summary) {
    case 'sum':   val = nums.reduce((a, b) => a + b, 0); break;
    case 'avg':   val = nums.reduce((a, b) => a + b, 0) / nums.length; break;
    case 'count': val = nums.length; break;
    case 'min':   val = Math.min(...nums); break;
    case 'max':   val = Math.max(...nums); break;
  }
  return (
    <span style={{ fontWeight: 700, color: 'var(--primary-green)', fontSize: 11 }}>
      {col.summary === 'avg'
        ? val.toLocaleString(undefined, { maximumFractionDigits: 1 })
        : val.toLocaleString()}
    </span>
  );
}

/* ── Sort helper ─────────────────────────────────────────────────────────── */

function sortRows<T extends Record<string, unknown>>(rows: T[], key: string, dir: 'asc' | 'desc'): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key as keyof T];
    const bv = b[key as keyof T];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = (typeof av === 'number' && typeof bv === 'number')
      ? av - bv
      : String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
}

/* ── getCell helper ──────────────────────────────────────────────────────── */

function getCell<T extends Record<string, unknown>>(row: T, col: ColDef<T>, idx: number): React.ReactNode {
  if (col.render) return col.render(row, idx);
  const v = row[col.key as keyof T];
  if (v === null || v === undefined) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  return String(v);
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function DataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  rowKey,
  onRowClick,
  pageSizes = DEFAULT_SIZES,
  defaultPageSize = 20,
  bodyHeight = 340,
  zebra = false,
  emptyText = 'No data to display.',
  className = '',
  tableId,
}: DataTableProps<T>) {

  /* ── persisted state initialisation (lazy initialisers for SSR safety) ── */

  /** Column order stored as array of col.key strings */
  const [colOrder, setColOrder] = useState<string[]>(() => {
    const saved = tableId ? lsGet(`dt:${tableId}:colOrder`) : null;
    const keys = columns.map(c => c.key as string);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[];
        if (parsed.length === keys.length && parsed.every(k => keys.includes(k))) return parsed;
      } catch { /* ignore */ }
    }
    return keys;
  });

  const [sortKey,   setSortKey]  = useState<string | null>(null);
  const [sortDir,   setSortDir]  = useState<'asc' | 'desc'>('asc');
  const [page,      setPage]     = useState(0);
  const [pageSize,  setPageSize] = useState<number>(() => {
    const saved = tableId ? lsGet(`dt:${tableId}:pageSize`) : null;
    if (saved) { const n = Number(saved); if (n > 0) return n; }
    return defaultPageSize;
  });
  const [density,   setDensity]  = useState<'normal' | 'compact'>(() => {
    const saved = tableId ? lsGet(`dt:${tableId}:density`) : null;
    return saved === 'compact' ? 'compact' : 'normal';
  });
  const [scrollTop, setScrollTop] = useState(0);

  /* drag state – refs to avoid re-renders during drag */
  const dragSrcIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const rowH = density === 'compact' ? RH_COMPACT : RH_NORMAL;

  /* ── persist on change ── */
  useEffect(() => { if (tableId) lsSet(`dt:${tableId}:density`, density); }, [density, tableId]);
  useEffect(() => { if (tableId) lsSet(`dt:${tableId}:pageSize`, String(pageSize)); }, [pageSize, tableId]);
  useEffect(() => { if (tableId) lsSet(`dt:${tableId}:colOrder`, JSON.stringify(colOrder)); }, [colOrder, tableId]);

  /* ── ordered columns ── */
  const orderedCols = useMemo<ColDef<T>[]>(() => {
    const map = new Map(columns.map(c => [c.key as string, c]));
    return colOrder.map(k => map.get(k)).filter(Boolean) as ColDef<T>[];
  }, [columns, colOrder]);

  /* ── sorted + paged rows ── */
  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    if (!col?.sortable) return rows;
    return sortRows(rows, sortKey, sortDir);
  }, [rows, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage   = Math.min(page, totalPages - 1);

  const pageRows = useMemo(
    () => sorted.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [sorted, safePage, pageSize]
  );

  /* ── virtual window ── */
  const startIdx     = Math.max(0, Math.floor(scrollTop / rowH) - WIN);
  const endIdx       = Math.min(pageRows.length, Math.ceil((scrollTop + bodyHeight) / rowH) + WIN);
  const visibleRows  = pageRows.slice(startIdx, endIdx);
  const paddingTop   = startIdx * rowH;
  const paddingBottom = (pageRows.length - endIdx) * rowH;

  /* ── handlers ── */
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleSort = useCallback((col: ColDef<T>) => {
    if (!col.sortable) return;
    const k = col.key as string;
    setSortKey(prev => {
      if (prev === k) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir('asc');
      return k;
    });
    setPage(0);
  }, []);

  useEffect(() => { setPage(0); }, [rows]);

  const goTo = (p: number) => {
    setPage(Math.max(0, Math.min(p, totalPages - 1)));
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    setScrollTop(0);
  };

  /* ── drag reorder ── */
  function onDragStart(e: DragEvent<HTMLTableCellElement>, idx: number) {
    dragSrcIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    // ghost image: use the th itself
    e.dataTransfer.setDragImage(e.currentTarget, 20, 10);
  }
  function onDragOver(e: DragEvent<HTMLTableCellElement>, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  }
  function onDragLeave() { setDragOverIdx(null); }
  function onDrop(e: DragEvent<HTMLTableCellElement>, toIdx: number) {
    e.preventDefault();
    const fromIdx = dragSrcIdx.current;
    if (fromIdx === null || fromIdx === toIdx) { setDragOverIdx(null); return; }
    setColOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  }
  function onDragEnd() {
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  }

  /* ── summary row values (over all sorted rows, not just page) ── */
  const hasSummary = orderedCols.some(c => c.summary);

  /* ── render <th> ── */
  function renderTh(col: ColDef<T>, visIdx: number) {
    const isActive   = sortKey === col.key;
    const isDragOver = dragOverIdx === visIdx;
    return (
      <th
        key={String(col.key) + visIdx}
        draggable
        onDragStart={e => onDragStart(e, visIdx)}
        onDragOver={e  => onDragOver(e, visIdx)}
        onDragLeave={onDragLeave}
        onDrop={e      => onDrop(e, visIdx)}
        onDragEnd={onDragEnd}
        onClick={() => handleSort(col)}
        style={{
          padding: density === 'compact' ? '5px 8px' : '9px 10px',
          textAlign: col.align ?? 'left',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: isActive ? 'var(--primary-green)' : 'var(--text-muted)',
          whiteSpace: 'nowrap',
          borderBottom: '1px solid var(--border-subtle)',
          borderLeft: isDragOver ? '2px solid var(--primary-green)' : '2px solid transparent',
          background: isDragOver
            ? 'rgba(74,222,128,0.08)'
            : 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: col.pinned ? 20 : 10,
          cursor: 'grab',
          userSelect: 'none',
          minWidth: col.minWidth ?? 60,
          transition: 'background 0.1s, border-left 0.1s',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {/* drag grip */}
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-dim)',
              opacity: 0.5,
              lineHeight: 1,
              flexShrink: 0,
              cursor: 'grab',
            }}
            title="Drag to reorder"
          >
            ⠿
          </span>
          {col.header}
          {col.sortable && (
            <span style={{ opacity: isActive ? 1 : 0.25 }}>
              {isActive && sortDir === 'desc'
                ? <ChevronDown size={9} />
                : <ChevronUp size={9} />}
            </span>
          )}
        </span>
      </th>
    );
  }

  /* ── render data row ── */
  function renderRow(row: T, absIdx: number) {
    const key  = rowKey ? rowKey(row, absIdx) : ((row._id as string | number) ?? absIdx);
    const isEven = absIdx % 2 === 0;
    const bg   = zebra && isEven ? 'rgba(255,255,255,0.02)' : 'transparent';
    return (
      <tr
        key={key}
        onClick={() => onRowClick?.(row, absIdx)}
        style={{ height: rowH, background: bg, cursor: onRowClick ? 'pointer' : 'default', transition: 'background 0.1s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(74,222,128,0.05)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = bg; }}
      >
        {orderedCols.map((col, ci) => (
          <td
            key={ci}
            style={{
              padding: density === 'compact' ? '3px 10px' : '9px 12px',
              verticalAlign: 'middle',
              color: 'var(--text-primary)',
              fontSize: density === 'compact' ? 11 : 12,
              textAlign: col.align ?? 'left',
              borderBottom: '1px solid var(--border-subtle)',
              minWidth: col.minWidth ?? 60,
            }}
          >
            {getCell(row, col, absIdx)}
          </td>
        ))}
      </tr>
    );
  }

  /* ── render summary <tfoot> row ── */
  function renderSummaryRow() {
    if (!hasSummary) return null;
    return (
      <tfoot>
        <tr>
          {orderedCols.map((col, ci) => {
            const cell = calcSummary(col, sorted);
            return (
              <td
                key={ci}
                style={{
                  padding: density === 'compact' ? '4px 10px' : '8px 12px',
                  textAlign: col.align ?? 'left',
                  fontSize: density === 'compact' ? 10 : 11,
                  borderTop: '2px solid var(--border-subtle)',
                  background: 'rgba(74,222,128,0.05)',
                  color: 'var(--text-secondary)',
                  fontWeight: 700,
                  minWidth: col.minWidth ?? 60,
                  position: 'sticky',
                  bottom: 0,
                }}
              >
                {cell ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}
              </td>
            );
          })}
        </tr>
      </tfoot>
    );
  }

  const firstIdx = sorted.length ? safePage * pageSize + 1 : 0;
  const lastIdx  = Math.min(sorted.length, safePage * pageSize + pageSize);

  /* ── JSX ── */
  return (
    <div
      className={className}
      style={{ borderRadius: 12, border: '1px solid var(--border-subtle)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* ── toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface)', gap: 8, flexShrink: 0 }}>
        {/* density */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          {(['normal','compact'] as const).map(d => (
            <button key={d} onClick={() => setDensity(d)} style={{
              padding: '3px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer',
              border: density === d ? '1px solid rgba(74,222,128,0.4)' : '1px solid transparent',
              background: density === d ? 'rgba(74,222,128,0.12)' : 'transparent',
              color: density === d ? 'var(--primary-green)' : 'var(--text-dim)',
            }}>
              {d === 'normal' ? '≡ Normal' : '⊟ Compact'}
            </button>
          ))}
        </div>
        {/* hint */}
        <span style={{ fontSize: 9, color: 'var(--text-dim)', flex: 1, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          ⠿ drag headers to reorder
        </span>
        {/* page size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Rows</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
            style={{ background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, padding: '2px 5px', cursor: 'pointer' }}>
            {pageSizes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* ── scrollable body ── */}
      <div ref={bodyRef} onScroll={handleScroll}
        style={{ overflowX: 'auto', overflowY: 'auto', height: bodyHeight, flex: '1 1 auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto' }}>
          <thead>
            <tr>{orderedCols.map((col, i) => renderTh(col, i))}</tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr style={{ height: paddingTop }}><td colSpan={orderedCols.length} style={{ padding: 0, border: 'none' }} /></tr>
            )}
            {pageRows.length === 0 ? (
              <tr><td colSpan={orderedCols.length} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>{emptyText}</td></tr>
            ) : (
              visibleRows.map((row, i) => renderRow(row, startIdx + i))
            )}
            {paddingBottom > 0 && (
              <tr style={{ height: paddingBottom }}><td colSpan={orderedCols.length} style={{ padding: 0, border: 'none' }} /></tr>
            )}
          </tbody>
          {renderSummaryRow()}
        </table>
      </div>

      {/* ── footer: count + pagination ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface)', flexShrink: 0, gap: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {sorted.length === 0 ? '0 rows' : `${firstIdx}–${lastIdx} of ${sorted.length}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <PagerBtn onClick={() => goTo(0)}            disabled={safePage === 0}              label="«" />
          <PagerBtn onClick={() => goTo(safePage - 1)} disabled={safePage === 0}              label="‹" />
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '0 4px', whiteSpace: 'nowrap' }}>
            {safePage + 1} / {totalPages}
          </span>
          <PagerBtn onClick={() => goTo(safePage + 1)} disabled={safePage >= totalPages - 1} label="›" />
          <PagerBtn onClick={() => goTo(totalPages - 1)} disabled={safePage >= totalPages - 1} label="»" />
        </div>
      </div>
    </div>
  );
}

/* ── PagerBtn ─────────────────────────────────────────────────────────────── */

function PagerBtn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: 22, height: 22, borderRadius: 5, border: '1px solid var(--border-subtle)',
      background: 'var(--card)', color: disabled ? 'var(--text-dim)' : 'var(--text-secondary)',
      fontSize: 11, cursor: disabled ? 'default' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: disabled ? 0.35 : 1, flexShrink: 0,
    }}>{label}</button>
  );
}

/* ── usePersistedView – hook for card/table toggle per screen ───────────────
 *
 * Usage:
 *   const [view, setView] = usePersistedView("people", "card");
 *
 * Saves to localStorage under key "vm:<screenId>".
 */
export function usePersistedView<V extends string>(
  screenId: string,
  defaultView: V,
): [V, (v: V) => void] {
  const key = `vm:${screenId}`;
  const [view, setViewState] = useState<V>(() => {
    const saved = lsGet(key);
    return (saved as V) ?? defaultView;
  });
  const setView = useCallback((v: V) => {
    lsSet(key, v);
    setViewState(v);
  }, [key]);
  return [view, setView];
}
