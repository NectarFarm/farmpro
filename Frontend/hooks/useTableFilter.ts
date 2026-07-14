'use client';
// Shared search + client-side pagination for long, unbounded list tables —
// factors out the pattern already hand-rolled per-page in owner/finance and
// admin/farms (sort → filter by search text → slice into PAGE_SIZE chunks),
// so every list gets the same behavior instead of a slightly different
// one-off implementation.
import { useMemo, useState } from 'react';

const DEFAULT_PAGE_SIZE = 20;

interface UseTableFilterOptions<T> {
  /** Row keys to search across (case-insensitive substring match), or a
   *  function returning the searchable text for a row — use a function when
   *  the match needs a derived/nested value (e.g. a joined name). */
  searchFields: (keyof T)[] | ((item: T) => string);
  pageSize?: number;
  /** Applied before search/pagination — e.g. newest-first by date. */
  sortFn?: (a: T, b: T) => number;
}

export function useTableFilter<T>(data: T[], opts: UseTableFilterOptions<T>) {
  const [search, setSearchRaw] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;

  // Typing a new search term should always jump back to page 1 — otherwise a
  // narrower result set can leave the view on a now-nonexistent page.
  const setSearch = (v: string) => { setSearchRaw(v); setPage(1); };

  const getSearchText = useMemo(() => {
    if (typeof opts.searchFields === 'function') return opts.searchFields;
    const fields = opts.searchFields;
    return (item: T) => fields.map((f) => String(item[f] ?? '')).join(' ');
  }, [opts.searchFields]);

  const filtered = useMemo(() => {
    const sorted = opts.sortFn ? [...data].sort(opts.sortFn) : data;
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => getSearchText(item).toLowerCase().includes(q));
  }, [data, search, opts.sortFn, getSearchText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  return { search, setSearch, page: safePage, setPage, totalPages, paged, filteredCount: filtered.length };
}
