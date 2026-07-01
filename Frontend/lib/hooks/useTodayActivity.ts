'use client';
import { useCallback, useEffect, useState } from 'react';

export interface TodayItem { type: string; at: string; batchId: string | null }

// What the SIGNED-IN worker has already recorded today — so a page can show
// "done today" and warn before a likely duplicate. Reads /api/my-activity.
export function useTodayActivity() {
  const [items, setItems] = useState<TodayItem[]>([]);

  const refresh = useCallback(() => {
    fetch('/api/my-activity', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setItems)
      .catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Count + last time for a record type, optionally narrowed to one batch.
  const doneToday = useCallback((type: string, batchId?: string): { count: number; lastAt: string | null } => {
    const f = items.filter((i) => i.type === type && (!batchId || i.batchId === batchId));
    const lastAt = f.map((i) => i.at).sort().slice(-1)[0] ?? null;
    return { count: f.length, lastAt };
  }, [items]);

  return { items, doneToday, refresh };
}

// "8:15 AM" from an ISO timestamp (or '' if none).
export function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
}
