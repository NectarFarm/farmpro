'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/errorReporter';

// Root-layout-level error boundary. Next.js only renders this when the root
// layout itself throws, so it must supply its own <html>/<body> — the normal
// layout (and globals.css) never mounts. Inline styles only: no Tailwind, no
// stylesheet. No useTranslation() either — the crash may be inside the i18n
// system itself, so all copy here is hardcoded bilingual (EN/SW).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error:', error);
    reportError(error, 'global-error');
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: '16px',
        }}
      >
        <div
          style={{
            maxWidth: '400px',
            width: '100%',
            backgroundColor: '#ffffff',
            border: '1px solid #fecaca',
            borderRadius: '16px',
            padding: '32px 24px',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <h1
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#166534',
              margin: '0 0 8px',
            }}
          >
            Something went wrong / Kuna hitilafu
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: '#4b5563',
              margin: '0 0 24px',
              lineHeight: 1.5,
            }}
          >
            Your saved records are safe on this phone. / Rekodi zako
            zimehifadhiwa kwenye simu hii.
          </p>
          <button
            onClick={() => reset()}
            style={{
              width: '100%',
              minHeight: '48px',
              backgroundColor: '#16a34a',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again / Jaribu tena
          </button>
          {error.digest && (
            <p
              style={{
                fontSize: '11px',
                color: '#9ca3af',
                marginTop: '16px',
                marginBottom: 0,
                fontFamily: 'monospace',
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
