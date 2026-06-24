'use client';
// Registers the service worker so the app is installable + app-shell offline.
// Production-only to avoid dev caching headaches.
import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registration failure is non-fatal; app still works online */
    });
  }, []);
  return null;
}
