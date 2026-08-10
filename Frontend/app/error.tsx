'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '@/lib/errorReporter';

// Root-segment error boundary: catches crashes in any route under app/ that
// doesn't have its own closer error.tsx (e.g. app/page.tsx, app/login).
// It renders *inside* the root layout, so nav/shell chrome for whichever
// section the user was in is already gone by the time this shows — this is
// the last boundary before global-error.tsx takes over the whole document.
//
// i18n choice: every existing segment boundary (owner/admin/worker/manager/
// auditor error.tsx) hardcodes English rather than calling useTranslation().
// The root layout (app/layout.tsx) has no i18n/context provider either way,
// so t() isn't structurally unsafe here — but since this boundary can catch
// errors from ANY section, including public/unauthenticated routes like
// /login where a worker-profile language preference may not be meaningful,
// and to stay consistent with the app-wide convention, this file also
// hardcodes bilingual (EN/SW) strings instead of using t().
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root page error:', error);
    reportError(error, 'root');
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Something went wrong / Kuna hitilafu
        </h1>
        <p className="text-gray-500 text-sm mb-6">
          Your saved records are safe on this phone. / Rekodi zako
          zimehifadhiwa kwenye simu hii.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full min-h-[48px] px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700"
          >
            Try again / Jaribu tena
          </button>
          <Link
            href="/"
            className="w-full min-h-[48px] flex items-center justify-center px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
          >
            Go Home / Nenda Nyumbani
          </Link>
        </div>
        {error.digest && (
          <p className="text-xs text-gray-400 mt-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
