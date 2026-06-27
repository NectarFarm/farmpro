'use client';
// One login for everyone. The server identifies the role from the DB record and
// signs it into the session; this page just routes to the right home afterwards.
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { cachePinHash, verifyPinOffline, hashPin } from '@/lib/offline/db';
import { useBranding } from '@/lib/useBranding';
import type { User, Role } from '@/lib/types';

const HOME: Record<string, string> = {
  super_admin: '/admin/dashboard', owner: '/owner/dashboard', manager: '/owner/dashboard',
  vet: '/vet/units', auditor: '/auditor/dashboard', worker: '/worker/home',
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const brand = useBranding();
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const year = new Date().getFullYear();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      let user: User;
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const res = await fetch('/api/auth/login', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: identifier.trim(), secret }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Login failed');
        user = data.user as User;
        login(user, 'session');
        // Cache a PBKDF2 PIN hash so workers can unlock offline later.
        if (user.role === 'worker') {
          try { await cachePinHash(identifier.trim(), user.id, await hashPin(identifier.trim(), secret), user.workerProfileId); } catch { /* ignore */ }
        }
      } else {
        // Offline: only a worker who has signed in online before can unlock.
        const cached = await verifyPinOffline(identifier.trim(), secret);
        if (!cached) throw new Error('You are offline and this PIN is not saved yet. Connect to the internet once to sign in.');
        user = { id: cached.userId, phone: identifier.trim(), role: 'worker' as Role, name: 'Worker', tenantId: '', language: 'en', workerProfileId: cached.workerProfileId } as User;
        login(user, 'offline');
      }
      router.replace(HOME[user.role] ?? '/owner/dashboard');
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-green-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {brand.logoUrl
            ?   <img src={brand.logoUrl} alt={brand.appName} className="w-16 h-16 object-contain mx-auto mb-3" />
            : <div className="text-5xl mb-3">🌾</div>}
          <h1 className="text-3xl font-bold text-white">{brand.appName}</h1>
          <p className="text-green-200/70 mt-1">{brand.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Sign in</h2>
          <p className="text-sm text-gray-500 mb-5">Owners, workers and admins all sign in here — we&apos;ll take you to the right place.</p>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Email or phone number</label>
              <input value={identifier} onChange={e => setIdentifier(e.target.value)} required autoComplete="username"
                placeholder="you@farm.com  ·  +2547…"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:border-green-600 outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Password or PIN</label>
              <div className="relative">
                <input type={showSecret ? 'text' : 'password'} value={secret} onChange={e => setSecret(e.target.value)} required autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 pr-16 text-base focus:border-green-600 outline-none" />
                <button type="button" onClick={() => setShowSecret(v => !v)}
                  className="absolute inset-y-0 right-3 my-auto h-fit text-xs font-semibold text-gray-500 hover:text-gray-800"
                  aria-label={showSecret ? 'Hide password' : 'Show password'}>
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm font-semibold">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-xl text-lg font-bold disabled:opacity-50 hover:bg-green-700">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-5">
            No account? Ask your farm owner or administrator to add you.
          </p>
        </div>

        <p className="text-center text-green-200/50 text-xs mt-6">© {year} {brand.appName} · Secure sign-in</p>
      </div>
    </div>
  );
}
