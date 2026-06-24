'use client';
import React from 'react';
import type { ConflictEntry } from '@/lib/types';
import { useSyncStore } from '@/lib/stores/sync';

interface Props { conflict: ConflictEntry; }

export function ConflictResolver({ conflict }: Props) {
  const { resolveConflict } = useSyncStore();
  return (
    <div className="bg-white border-2 border-red-400 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xl">⚠️</span>
        <h3 className="font-bold text-red-700">Conflict: {conflict.recordType}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs font-bold text-blue-700 mb-1">MY VERSION</p>
          <p className="text-xs text-gray-500">{conflict.capturedAtMine}</p>
          <pre className="text-xs text-gray-700 mt-1 overflow-auto max-h-24">{JSON.stringify(conflict.myVersion, null, 2)}</pre>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-bold text-amber-700 mb-1">SERVER VERSION</p>
          <p className="text-xs text-gray-500">{conflict.capturedAtServer}</p>
          <pre className="text-xs text-gray-700 mt-1 overflow-auto max-h-24">{JSON.stringify(conflict.serverVersion, null, 2)}</pre>
        </div>
      </div>
      <p className="text-xs text-gray-500">Last-write-wins by capture time. Loser preserved in conflict log (FR-M17-3). Owner can override.</p>
      <div className="flex gap-3">
        <button onClick={() => resolveConflict(conflict.id, 'kept_mine')}
          className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-semibold text-sm">Keep Mine</button>
        <button onClick={() => resolveConflict(conflict.id, 'kept_server')}
          className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl font-semibold text-sm">Keep Server</button>
      </div>
      {conflict.resolution && (
        <p className="text-xs text-green-600 font-semibold">✓ Resolved: {conflict.resolution} at {conflict.resolvedAt}</p>
      )}
    </div>
  );
}
