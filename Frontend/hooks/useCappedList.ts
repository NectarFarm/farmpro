'use client';
// Shared "top N + See more" pattern for long, unbounded lists that don't
// warrant full page-number pagination (Pager) — a farmer scanning inventory
// or alerts on a phone wants the most relevant N items and a single tap to
// reveal more, not a page-number control. Same search/sort shape as
// useTableFilter so the two hooks read the same way at call sites.
import { useMemo, useState } from 'react';

const DEFAULT_INITIAL = 10;
const DEFAULT_STEP = 10;

interface UseCappedListOptions<T> {
  /** Row keys to search across (case-insensitive substring match), or a
   *  function returning the searchable text for a row. Omit if the list has
   *  no search box. */
  searchFields?: (keyof T)[] | ((item: T) => string);
  /** Applied before search/cap — e.g. low-stock-first, or newest-first. */
  sortFn?: (a: T, b: T) => number;
  initial?: number;
  step?: number;
}

export function useCappedList<T>(data: T[], opts: UseCappedListOptions<T> = {}) {
  const [search, setSearchRaw] = useState('');
  const [count, setCount] = useState(opts.initial ?? DEFAULT_INITIAL);
  const step = opts.step ?? DEFAULT_STEP;

  // A new search term should always reset how many rows are revealed —
  // otherwise a narrower result set can leave "See more" showing 0 remaining
  // while a stale broader count lingers from before the search.
  const setSearch = (v: string) => { setSearchRaw(v); setCount(opts.initial ?? DEFAULT_INITIAL); };

  const getSearchText = useMemo(() => {
    if (!opts.searchFields) return null;
    if (typeof opts.searchFields === 'function') return opts.searchFields;
    const fields = opts.searchFields;
    return (item: T) => fields.map((f) => String(item[f] ?? '')).join(' ');
  }, [opts.searchFields]);

  const filtered = useMemo(() => {
    const sorted = opts.sortFn ? [...data].sort(opts.sortFn) : data;
    if (!getSearchText) return sorted;
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => getSearchText(item).toLowerCase().includes(q));
  }, [data, search, opts.sortFn, getSearchText]);

  const visible = useMemo(() => filtered.slice(0, count), [filtered, count]);
  const remaining = Math.max(0, filtered.length - count);

  return {
    search, setSearch, visible, remaining, filteredCount: filtered.length,
    showMore: () => setCount((c) => c + step),
    showAll: () => setCount(filtered.length),
  };
}
