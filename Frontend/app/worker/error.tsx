'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { reportError } from '@/lib/errorReporter';

export default function WorkerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    console.error('Worker page error:', error);
    reportError(error, 'worker');
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 max-w-md mx-auto">
      <div className="w-full bg-white rounded-2xl border border-red-200 shadow-sm p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-gray-500 text-sm mb-6">
          {t('errorRecordsSafe')}
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full min-h-[44px] px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700"
          >
            Try again
          </button>
          <Link
            href="/worker/home"
            className="w-full min-h-[44px] flex items-center justify-center px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
          >
            Go to Home
          </Link>
        </div>
        {error.digest && (
          <p className="text-xs text-gray-400 mt-4 font-mono">Error ID: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
