'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function WorkerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Worker page error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 max-w-md mx-auto">
      <div className="w-full bg-white rounded-2xl border border-red-200 shadow-sm p-6 text-center">
        <div className="text-5xl mb-4">😔</div>
        <h1 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h1>
        <p className="text-gray-500 text-sm mb-6">
          This page couldn&apos;t load. Try again, or head back home.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400 mb-4 font-mono">Error ID: {error.digest}</p>
        )}
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
      </div>
    </div>
  );
}
