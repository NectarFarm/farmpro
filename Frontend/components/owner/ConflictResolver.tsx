'use client';
import React from 'react';

export interface Conflict {
  id: string; recordType: string; recordId: string;
  myVersion: unknown; serverVersion: unknown;
  capturedAtMine: string | null; capturedAtServer: string | null; resolution: string | null;
}

interface Props { conflict: Conflict; onResolve: (id: string, resolution: 'accept' | 'kept_mine' | 'kept_server') => void; busy?: boolean }

// Shows one sync edit-conflict (two workers recorded the same day's production for a
// batch). The server already kept one by last-write-wins; the owner can accept that,
// or override to the other version.
export function ConflictResolver({ conflict, onResolve, busy }: Props) {
  return (
    <div className="bg-white border-2 border-red-300 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span>⚠️</span>
        <h3 className="font-bold text-red-700 text-sm">Conflict — {conflict.recordType} <span className="text-gray-400 font-normal">({conflict.recordId})</span></h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
          <p className="text-[11px] font-bold text-blue-700 mb-0.5">VERSION A {conflict.capturedAtMine && <span className="text-gray-400 font-normal">· {conflict.capturedAtMine.slice(0, 16).replace('T', ' ')}</span>}</p>
          <pre className="text-[11px] text-gray-700 overflow-auto max-h-20">{JSON.stringify(conflict.myVersion, null, 1)}</pre>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <p className="text-[11px] font-bold text-amber-700 mb-0.5">VERSION B (kept) {conflict.capturedAtServer && <span className="text-gray-400 font-normal">· {conflict.capturedAtServer.slice(0, 16).replace('T', ' ')}</span>}</p>
          <pre className="text-[11px] text-gray-700 overflow-auto max-h-20">{JSON.stringify(conflict.serverVersion, null, 1)}</pre>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">The later entry was kept automatically. Accept that, or override to a specific version.</p>
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy} onClick={() => onResolve(conflict.id, 'accept')} className="px-3 py-1.5 bg-green-600 text-white rounded-lg font-semibold text-xs disabled:opacity-50">Accept kept</button>
        <button disabled={busy} onClick={() => onResolve(conflict.id, 'kept_mine')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold text-xs disabled:opacity-50">Use Version A</button>
        <button disabled={busy} onClick={() => onResolve(conflict.id, 'kept_server')} className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-semibold text-xs disabled:opacity-50">Use Version B</button>
      </div>
    </div>
  );
}
