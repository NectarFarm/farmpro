'use client';
// Mobile-first PWA shell — header (back + title + logout), offline badge, bottom tabs.
// NOTE: this lives in app/worker/ (not a route group) so it actually wraps /worker/* pages.
import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useTranslation, type TranslationKey } from '@/lib/i18n/useTranslation';
import { useSyncStore } from '@/lib/stores/sync';
import { useSync } from '@/lib/offline/sync';
import { SyncBadge } from '@/components/worker/SyncBadge';
import { cn } from '@/lib/utils';
import { useBranding } from '@/lib/useBranding';
import { Toaster } from '@/components/ui/toaster';
import { Home, ClipboardList, Wallet, User, Wheat, ChevronLeft, LogOut, type LucideIcon } from 'lucide-react';

const tabs = [
  { href: '/worker/home', Icon: Home, labelKey: 'home' },
  { href: '/worker/record', Icon: ClipboardList, labelKey: 'record' },
  { href: '/worker/pay', Icon: Wallet, labelKey: 'myPay' },
  { href: '/worker/profile', Icon: User, labelKey: 'profile' },
] as const;

const TITLE_KEYS: Record<string, TranslationKey> = {
  '/worker/home': 'home',
  '/worker/pay': 'myPay',
  '/worker/profile': 'profile',
  '/worker/record': 'record',
  '/worker/record/collect': 'collectProducts',
  '/worker/record/morning-round': 'morningRound',
  '/worker/record/mortality': 'recordMortality',
  '/worker/record/feeding': 'feedingLog',
  '/worker/record/health': 'healthVaccination',
  '/worker/record/weight-sampling': 'weightSample',
  '/worker/record/physical-count': 'physicalCount',
  '/worker/record/closing-stock': 'closingStock',
};

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { setOnline } = useSyncStore();
  const { logout } = useAuthStore();
  const brand = useBranding();

  // Drain the offline queue to the server (mount / online / interval).
  useSync();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    // Warm the offline read-cache once per app load so record-form dropdowns
    // have data before the worker walks out of coverage.
    if (navigator.onLine) void import('@/lib/offline/refCache').then(m => m.warmRefCache());
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [setOnline]);

  if (pathname === '/worker/login') return <>{children}</>;

  const titleKey: TranslationKey = TITLE_KEYS[pathname] ?? 'home';
  const title = t(titleKey) ?? brand.appName;
  const isHome = pathname === '/worker/home';
  const handleLogout = () => { logout(); router.replace('/worker/login'); };

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto bg-gray-50">
      {/* Header: back · title · sync · logout */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-3 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] flex items-center gap-2">
        {isHome ? (
          brand.logoUrl
             
            ? <img src={brand.logoUrl} alt={brand.appName} className="w-7 h-7 object-contain pl-1" />
            : <Wheat className="w-6 h-6 text-green-700 pl-1" />
        ) : (
          <button onClick={() => router.back()} aria-label="Back"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <span className="text-base font-bold text-green-800 truncate flex-1">{title}</span>
        <SyncBadge />
        <button onClick={handleLogout} aria-label="Log out"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))]">{children}</main>

      {/* Bottom tab bar — DS-5: one-thumb reachable */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {tabs.map((tab) => {
            const active = pathname.startsWith(tab.href.split('/').slice(0, 3).join('/'));
            return (
              <Link key={tab.href} href={tab.href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center py-3 gap-0.5 min-h-[60px] text-xs font-semibold transition-colors',
                  active ? 'text-green-700 bg-green-50' : 'text-gray-500 hover:text-gray-700'
                )}>
                <tab.Icon className="w-5 h-5" strokeWidth={2} />
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </div>
      </nav>

      <Toaster />
    </div>
  );
}
