'use client';
// Registers the service worker so the app is installable + app-shell offline.
// Production-only to avoid dev caching headaches.
import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // When a new build's SW activates and takes control, reload ONCE so the page
    // runs on fresh assets — this is what stops a remote device getting stuck on a
    // stale build (the cause of "login does nothing" after a deploy).
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update?.();                          // check for a newer SW on every load
      setInterval(() => reg.update?.(), 60 * 60 * 1000); // and hourly while open
    }).catch(() => {
      /* registration failure is non-fatal; app still works online */
    });
  }, []);
  return null;
}
