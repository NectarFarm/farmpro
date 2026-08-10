'use client';
// Shared search box for list/table pages — the icon-decorated input pattern
// already used in app/admin/farms/page.tsx, factored out so every long list
// gets the same look instead of a slightly different one-off each time.
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TableToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Extra controls (status filters, dropdowns) rendered after the search box. */
  children?: React.ReactNode;
}

export function TableToolbar({ search, onSearchChange, placeholder = 'Search…', className, children }: TableToolbarProps) {
  return (
    <div className={cn('flex items-center gap-3 flex-wrap', className)}>
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
        />
      </div>
      {children}
    </div>
  );
}
