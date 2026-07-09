'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin page error:', error);
  }, [error]);

  return (
    <div className="h-full min-h-[60vh] flex items-center justify-center bg-gray-100 p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
        <div className="text-5xl mb-4">🛡️</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-gray-500 text-sm mb-6">
          This page couldn&apos;t load. This is usually a temporary issue — try again, or go back to the dashboard.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 mb-4 font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700"
          >
            Try again
          </button>
          <Link
            href="/admin/dashboard"
            className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
