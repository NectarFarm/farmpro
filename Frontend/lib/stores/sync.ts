'use client';
import { create } from 'zustand';
import type { ConflictEntry } from '@/lib/types';

type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncStore {
  isOnline: boolean;
  status: SyncStatus;
  pendingCount: number;
  // Records the server explicitly refused (failed validation, etc.) — distinct
  // from `conflicts` (both sides were valid). Non-zero means the worker has
  // data that did NOT save and will not save on its own; surfaced in the badge
  // so it isn't silently lost from view once the sync loop moves on.
  rejectedCount: number;
  conflicts: ConflictEntry[];
  lastSynced: string | null;
  setOnline: (v: boolean) => void;
  setPendingCount: (n: number) => void;
  setRejectedCount: (n: number) => void;
  setStatus: (s: SyncStatus) => void;
  addConflict: (c: ConflictEntry) => void;
  resolveConflict: (id: string, resolution: 'kept_mine' | 'kept_server') => void;
  setSynced: () => void;
}

export const useSyncStore = create<SyncStore>()((set) => ({
  isOnline: true,
  status: 'idle',
  pendingCount: 0,
  rejectedCount: 0,
  conflicts: [],
  lastSynced: null,
  setOnline: (isOnline) => set({ isOnline, status: isOnline ? 'idle' : 'offline' }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setRejectedCount: (rejectedCount) => set({ rejectedCount }),
  setStatus: (status) => set({ status }),
  addConflict: (c) => set(s => ({ conflicts: [...s.conflicts, c] })),
  resolveConflict: (id, resolution) => set(s => ({
    conflicts: s.conflicts.map(c => c.id === id ? { ...c, resolution, resolvedAt: new Date().toISOString() } : c),
  })),
  setSynced: () => set({ lastSynced: new Date().toISOString(), pendingCount: 0, status: 'idle' }),
}));
