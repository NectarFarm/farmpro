'use client';
// Shared page-number pagination control — same visual language across every
// paginated list in the app (was previously hand-rolled per-page, drifting).
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PagerProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  prevLabel?: string;
  nextLabel?: string;
}

// First/last + up-to-2 neighbors of the current page, ellipsis-collapsed once
// there are more than 7 pages — matches how most list UIs page through data.
function pageWindow(total: number, current: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, -1, total];
  if (current >= total - 3) return [1, -1, total - 4, total - 3, total - 2, total - 1, total];
  return [1, -1, current - 1, current, current + 1, -1, total];
}

export function Pager({ page, totalPages, onPageChange, prevLabel = 'Prev', nextLabel = 'Next' }: PagerProps) {
  if (totalPages <= 1) return null;
  const safePage = Math.min(Math.max(1, page), totalPages);

  return (
    <div className="flex items-center justify-center gap-2">
      <button onClick={() => onPageChange(Math.max(1, safePage - 1))} disabled={safePage <= 1}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
        <ChevronLeft className="w-3.5 h-3.5" /> {prevLabel}
      </button>
      {pageWindow(totalPages, safePage).map((p, idx) =>
        p === -1
          ? <span key={`ellipsis-${idx}`} className="px-1 text-gray-300 text-xs">···</span>
          : (
            <button key={p} onClick={() => onPageChange(p)}
              className={`min-w-[44px] h-[44px] text-xs font-semibold rounded-lg transition-colors ${p === safePage ? 'bg-green-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
              {p}
            </button>
          )
      )}
      <button onClick={() => onPageChange(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
        {nextLabel} <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
