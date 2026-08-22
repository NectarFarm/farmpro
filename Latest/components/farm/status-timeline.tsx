'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Clock, ChevronDown, ChevronUp } from './icons';
import { useRegional } from './settings';
import { formatDateTime, type DateFormat } from '@/lib/datetime';

// ── StatusTimeline ──────────────────────────────────────────────────────────
// Shared component that shows the latest N audit-log entries for any entity
// (task, batch, employee, etc.), fetched from GET /api/audit-log?entity=X&entityId=Y.

export type AuditEntry = {
  id: string;
  actor: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown> | null;
  at: string;
};

const ACTION_LABELS: Record<string, string> = {
  'task.created': 'Created',
  'task.started': 'Started work',
  'task.blocked': 'Blocked',
  'task.clarification_requested': 'Requested clarification',
  'task.completion_requested': 'Submitted for approval',
  'task.reopened': 'Reopened',
  'task.updated': 'Updated',
  'task.completed': 'Completed',
  'approval.approved': 'Approved',
  'approval.rejected': 'Rejected',
  'inventory.adjust': 'Quantity adjusted',
  'batch.created': 'Batch created',
  'batch.updated': 'Batch updated',
  'employee.created': 'Employee added',
  'employee.updated': 'Employee updated',
};

const ACTION_ICONS: Record<string, string> = {
  'task.created': '➕',
  'task.started': '▶️',
  'task.blocked': '🚫',
  'task.clarification_requested': '❓',
  'task.completion_requested': '✅',
  'task.reopened': '🔓',
  'task.updated': '✏️',
  'task.completed': '✔️',
  'approval.approved': '👍',
  'approval.rejected': '👎',
  'inventory.adjust': '📦',
  'batch.created': '🌱',
  'batch.updated': '🌱',
  'employee.created': '👤',
  'employee.updated': '👤',
};

// Recent entries (<24h) stay relative ("3h ago") regardless of settings —
// that part isn't timezone/format-sensitive. Anything older falls back to an
// absolute timestamp rendered in the TENANT's own timezone/date-format
// (settings-reorg — tenant_settings.timezone/dateFormat, via useRegional()
// below) instead of the hardcoded 'en-KE' locale this used before.
function formatTime(iso: string, regional: { timezone: string; dateFormat: DateFormat }): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return formatDateTime(d, regional);
}

export function StatusTimeline({
  tenantId,
  entity,
  entityId,
  limit = 5,
  className,
}: {
  tenantId: string;
  entity: string;
  entityId: string;
  limit?: number;
  className?: string;
}) {
  const regional = useRegional();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/audit-log?tenantId=${encodeURIComponent(tenantId)}&entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}&limit=${showAll ? 200 : limit}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) setEntries(json.data ?? []);
    } catch {
      // silently ignore — timeline is non-critical
    }
    setLoading(false);
  }, [tenantId, entity, entityId, limit, showAll]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const displayed = showAll ? entries : entries.slice(0, limit);
  const hasMore = entries.length > limit;

  if (loading && entries.length === 0) {
    return (
      <div className={className} style={{ padding: '10px 0', fontSize: 11, color: 'var(--text-dim)' }}>
        Loading timeline…
      </div>
    );
  }

  if (entries.length === 0) {
    return null; // Don't show empty timelines
  }

  return (
    <div className={className}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Clock size={11} color="var(--text-dim)" />
        Status History
      </div>
      <div style={{ position: 'relative', paddingLeft: 16 }}>
        {/* Vertical line */}
        <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: 'var(--border-subtle)', borderRadius: 1 }} />
        {displayed.map((entry, i) => {
          const label = ACTION_LABELS[entry.action] ?? entry.action.replace(/[._]/g, ' ');
          const icon = ACTION_ICONS[entry.action] ?? '📝';
          const actorName = entry.actorName ?? entry.actorEmail ?? 'System';
          const metaReason = entry.meta && typeof entry.meta === 'object' && 'reason' in entry.meta
            ? String((entry.meta as Record<string, unknown>).reason)
            : null;

          return (
            <div key={entry.id} style={{ position: 'relative', paddingBottom: i < displayed.length - 1 ? 12 : 0 }}>
              {/* Dot on the timeline */}
              <div style={{ position: 'absolute', left: -14, top: 3, width: 8, height: 8, borderRadius: '50%', background: entry.action.includes('rejected') || entry.action.includes('blocked') ? 'var(--status-critical)' : entry.action.includes('approved') || entry.action.includes('completed') ? 'var(--primary-green)' : 'var(--accent-blue)', border: '2px solid var(--surface)' }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11 }}>{icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>by {actorName}</span>
                  {entry.actorRole && (
                    <span style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'capitalize', background: 'var(--card)', padding: '1px 5px', borderRadius: 4 }}>{entry.actorRole}</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>{formatTime(entry.at, regional)}</div>
                {metaReason && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>"{metaReason}"</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          style={{ marginTop: 8, fontSize: 11, color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, padding: 0 }}
        >
          <ChevronDown size={12} /> More ({entries.length - limit} more)
        </button>
      )}
      {showAll && hasMore && (
        <button
          onClick={() => setShowAll(false)}
          style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, padding: 0 }}
        >
          <ChevronUp size={12} /> Show less
        </button>
      )}
    </div>
  );
}
