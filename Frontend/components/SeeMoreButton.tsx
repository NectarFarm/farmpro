'use client';
import { ChevronDown } from 'lucide-react';

interface SeeMoreButtonProps {
  remaining: number;
  onShowMore: () => void;
  onShowAll: () => void;
}

export function SeeMoreButton({ remaining, onShowMore, onShowAll }: SeeMoreButtonProps) {
  if (remaining <= 0) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-1">
      <button onClick={onShowMore}
        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
        <ChevronDown className="w-3.5 h-3.5" /> See more ({remaining} more)
      </button>
      <button onClick={onShowAll} className="text-xs font-semibold text-primary hover:underline">
        Show all
      </button>
    </div>
  );
}
