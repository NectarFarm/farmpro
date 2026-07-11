'use client';
import React from 'react';
import { AlertTriangle, Check, Clock } from 'lucide-react';

export interface Conflict {
  id: string; recordType: string; recordId: string;
  myVersion: unknown; serverVersion: unknown;
  capturedAtMine: string | null; capturedAtServer: string | null; resolution: string | null;
}

interface Props { conflict: Conflict; onResolve: (id: string, resolution: 'accept' | 'kept_mine' | 'kept_server') => void; busy?: boolean }

// Fields that are plumbing, not something an owner needs to compare — every other
// key in the record is shown, humanized, so this stays correct for any record shape
// (production, mortality, etc.) instead of hardcoding one record's fields.
const HIDDEN_KEYS = new Set(['tenantId', 'clientUuid', 'recordedBy', 'batchId', 'capturedAt']);
const LABELS: Record<string, string> = { qty: 'Quantity', type: 'Product', weightKg: 'Weight (kg)', count: 'Count', cause: 'Cause' };

const humanizeKey = (key: string) => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const humanizeValue = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

function VersionFields({ value, otherValue }: { value: unknown; otherValue: unknown }) {
  if (!value || typeof value !== 'object') return <p className="text-xs text-gray-400 italic">No data</p>;
  const obj = value as Record<string, unknown>;
  const other = (otherValue && typeof otherValue === 'object' ? otherValue as Record<string, unknown> : {});
  const keys = Object.keys(obj).filter((k) => !HIDDEN_KEYS.has(k));
  return (
    <dl className="flex flex-col gap-1">
      {keys.map((k) => {
        const differs = JSON.stringify(obj[k]) !== JSON.stringify(other[k]);
        return (
          <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-gray-500 shrink-0">{humanizeKey(k)}</dt>
            <dd className={differs ? 'font-bold text-gray-900' : 'font-medium text-gray-400'}>{humanizeValue(obj[k])}</dd>
          </div>
        );
      })}
    </dl>
  );
}

const fmtTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : null);

// Shows one sync edit-conflict (two workers recorded the same day's production for a
// batch). The server already kept one by last-write-wins; the owner can accept that,
// or override to the other version. Values are humanized field-by-field (not raw
// JSON) with differing fields bolded, so a non-technical owner can actually read it.
export function ConflictResolver({ conflict, onResolve, busy }: Props) {
  return (
    <div className="bg-white border-2 border-red-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
        <h3 className="font-bold text-red-700 text-sm capitalize">{conflict.recordType} conflict</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-[11px] font-bold text-blue-700 mb-1.5 flex items-center gap-1">
            Version A
            {conflict.capturedAtMine && <span className="text-gray-400 font-normal flex items-center gap-0.5"><Clock className="w-3 h-3" /> {fmtTime(conflict.capturedAtMine)}</span>}
          </p>
          <VersionFields value={conflict.myVersion} otherValue={conflict.serverVersion} />
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-[11px] font-bold text-amber-700 mb-1.5 flex items-center gap-1">
            Version B (kept)
            {conflict.capturedAtServer && <span className="text-gray-400 font-normal flex items-center gap-0.5"><Clock className="w-3 h-3" /> {fmtTime(conflict.capturedAtServer)}</span>}
          </p>
          <VersionFields value={conflict.serverVersion} otherValue={conflict.myVersion} />
        </div>
      </div>
      <p className="text-[11px] text-gray-400">The later entry was kept automatically. Bolded values differ between the two. Accept that, or override to a specific version.</p>
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={() => onResolve(conflict.id, 'accept')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold text-xs disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> Accept kept
        </button>
        <button disabled={busy} onClick={() => onResolve(conflict.id, 'kept_mine')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold text-xs disabled:opacity-50">Use Version A</button>
        <button disabled={busy} onClick={() => onResolve(conflict.id, 'kept_server')} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-semibold text-xs disabled:opacity-50">Use Version B</button>
      </div>
    </div>
  );
}
