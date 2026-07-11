'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/lib/types';

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  // Zustand's persist middleware reads localStorage asynchronously, so `user`
  // is null on every page's very first render even for an already-logged-in
  // visitor — a component that redirects on `!user` without checking this
  // flag first will bounce a genuinely signed-in owner/worker to the login
  // screen on every refresh, which reads as "did my data get wiped?".
  hasHydrated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      hasHydrated: false,
      login: (user, accessToken) => set({ user, accessToken }),
      logout: () => set({ user: null, accessToken: null }),
    }),
    {
      name: 'ifms_auth',
      // Runs once rehydration finishes — whether or not there was anything in
      // localStorage to restore (a brand-new visitor still needs this to flip,
      // or hasHydrated would stay false forever for them).
      onRehydrateStorage: () => () => { useAuthStore.setState({ hasHydrated: true }); },
    }
  )
);
