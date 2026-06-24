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

const DEMO = [
  { id: 'kutswa@ifms.farm', secret: 'demo1234', label: 'Owner' },
  { id: 'admin@ifms.app', secret: 'demo1234', label: 'Platform Admin' },
  { id: '+254700333444', secret: '1234', label: 'Worker' },
  { id: 'investor@fund.ke', secret: 'demo1234', label: 'Auditor' },
];

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const brand = useBranding();
  const [identifier, setIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={brand.logoUrl} alt={brand.appName} className="w-16 h-16 object-contain mx-auto mb-3" />
            : <div className="text-5xl mb-3">🌾</div>}
          <h1 className="text-3xl font-bold text-white">{brand.appName}</h1>
          <p className="text-green-200/70 mt-1">{brand.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Sign in</h2>
          <p className="text-sm text-gray-500 mb-5">Owners, workers and admins all sign in here — we&apos;ll take you to the right place.</p>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-5">
            <p className="text-xs font-semibold text-gray-500 mb-2">Demo accounts (tap to fill):</p>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO.map(a => (
                <button key={a.id} type="button" onClick={() => { setIdentifier(a.id); setSecret(a.secret); }}
                  className="px-2 py-1.5 bg-gray-100 rounded-lg text-xs font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200">
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Email or phone number</label>
              <input value={identifier} onChange={e => setIdentifier(e.target.value)} required autoComplete="username"
                placeholder="you@farm.com  ·  +2547…"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:border-green-600 outline-none" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Password or PIN</label>
              <input type="password" value={secret} onChange={e => setSecret(e.target.value)} required autoComplete="current-password"
                placeholder="••••••••"
                className="border-2 border-gray-300 rounded-xl px-4 py-3 text-base focus:border-green-600 outline-none" />
            </div>

            {error && <p className="text-red-600 bg-red-50 rounded-xl px-4 py-3 text-sm font-semibold">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-xl text-lg font-bold disabled:opacity-50 hover:bg-green-700">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
