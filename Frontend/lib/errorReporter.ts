'use client';
// Client-side error reporting — wired into every error.tsx boundary (root,
// global, and the 5 section-level ones) so crashes are visible somewhere
// other than a dev's console, without needing a third-party APM account.
// Best-effort only: never throws, never blocks the boundary's own render.
export function reportError(error: Error & { digest?: string }, context: string): void {
  try {
    const body = JSON.stringify({
      context,
      severity: 'error',
      message: error.message?.slice(0, 2000) ?? 'Unknown error',
      digest: error.digest,
      stack: error.stack?.slice(0, 4000),
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
    // A broken session (401) is exactly when this matters most, so it deliberately
    // does not require auth server-side — see app/api/errors/route.ts.
    void fetch('/api/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'include',
      keepalive: true,
    }).catch(() => {});
  } catch { /* never let error reporting itself throw */ }
}
