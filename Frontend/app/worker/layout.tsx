'use client';
// Mobile-first PWA shell — header (back + title + logout), offline badge, bottom tabs.
// NOTE: this lives in app/worker/ (not a route group) so it actually wraps /worker/* pages.
import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useSyncStore } from '@/lib/stores/sync';
import { useSync } from '@/lib/offline/sync';
import { SyncBadge } from '@/components/worker/SyncBadge';
import { cn } from '@/lib/utils';
import { Home, ClipboardList, User, type LucideIcon } from 'lucide-react';

const tabs: { href: string; Icon: LucideIcon; label: string }[] = [
  { href: '/worker/home', Icon: Home, label: 'Home' },
  { href: '/worker/record/morning-round', Icon: ClipboardList, label: 'Record' },
  { href: '/worker/profile', Icon: User, label: 'Profile' },
];

const TITLES: Record<string, string> = {
  '/worker/home': 'Home',
  '/worker/profile': 'Profile',
  '/worker/record/collect': 'Collect Products',
  '/worker/record/morning-round': 'Morning Round',
  '/worker/record/mortality': 'Record Mortality',
  '/worker/record/feeding': 'Feeding Log',
  '/worker/record/health': 'Health & Vaccination',
  '/worker/record/weight-sampling': 'Weight Sampling',
  '/worker/record/physical-count': 'Physical Count',
  '/worker/record/closing-stock': 'Closing Stock',
};

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOnline } = useSyncStore();
  const { logout } = useAuthStore();

  // Drain the offline queue to the server (mount / online / interval).
  useSync();

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [setOnline]);

  if (pathname === '/worker/login') return <>{children}</>;

  const title = TITLES[pathname] ?? 'IFMS';
  const isHome = pathname === '/worker/home';
  const handleLogout = () => { logout(); router.replace('/worker/login'); };

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto bg-gray-50">
      {/* Header: back · title · sync · logout */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-3 py-3 flex items-center gap-2">
        {isHome ? (
          <span className="text-2xl pl-1">🌾</span>
        ) : (
          <button onClick={() => router.back()} aria-label="Back"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 text-xl">
            ‹
          </button>
        )}
        <span className="text-base font-bold text-green-800 truncate flex-1">{title}</span>
        <SyncBadge />
        <button onClick={handleLogout} aria-label="Log out"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 text-lg">
          ⏻
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">{children}</main>

      {/* Bottom tab bar — DS-5: one-thumb reachable */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 z-40">
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
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
