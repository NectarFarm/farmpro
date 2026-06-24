'use client';
import { create } from 'zustand';
import type { WorkerProfile, FieldPermission } from '@/lib/types';

interface WorkerProfileStore {
  profile: WorkerProfile | null;
  lang: 'en' | 'sw';
  highContrast: boolean;
  setProfile: (p: WorkerProfile) => void;
  setLang: (l: 'en' | 'sw') => void;
  toggleHighContrast: () => void;
  // Returns field permission for a given key; defaults 'editable' if not configured
  getFieldPermission: (key: string) => FieldPermission;
  isFieldVisible: (key: string) => boolean;
  isFieldRequired: (key: string) => boolean;
}

export const useWorkerProfileStore = create<WorkerProfileStore>()((set, get) => ({
  profile: null,
  lang: 'en',
  highContrast: false,
  setProfile: (profile) => set({ profile }),
  setLang: (lang) => set({ lang }),
  toggleHighContrast: () => set(s => ({ highContrast: !s.highContrast })),
  getFieldPermission: (key) => {
    const f = get().profile?.fields.find(f => f.fieldKey === key);
    return f?.permission ?? 'editable';
  },
  isFieldVisible: (key) => {
    const p = get().getFieldPermission(key);
    return p !== 'hidden';
  },
  isFieldRequired: (key) => {
    const f = get().profile?.fields.find(f => f.fieldKey === key);
    return f?.required ?? false;
  },
}));
