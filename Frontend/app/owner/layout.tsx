'use client';
// Owner/manager/auditor shell. Lives in app/owner/ so it actually wraps /owner/* pages.
// Sidebar (where you are) + top bar (back, breadcrumb, logout).
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { SetupGuide } from '@/components/SetupGuide';
import { TestingGuide } from '@/components/TestingGuide';
import { AIAdvisor } from '@/components/AIAdvisor';
import { ALL_FEATURE_KEYS } from '@/lib/features';
import { useBranding } from '@/lib/useBranding';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Tractor, Boxes, Wallet, Users, ClipboardList, Settings, BarChart3, Bell, type LucideIcon } from 'lucide-react';

const ALL_NAV: { href: string; Icon: LucideIcon; label: string; feature?: string }[] = [
  { href: '/owner/dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/owner/farm',      Icon: Tractor,         label: 'Farm' },
  { href: '/owner/inventory', Icon: Boxes,           label: 'Inventory' },
  { href: '/owner/finance',   Icon: Wallet,          label: 'Finance', feature: 'finance' },
  { href: '/owner/people',    Icon: Users,           label: 'People' },
  { href: '/owner/tasks',     Icon: ClipboardList,   label: 'Tasks' },
  { href: '/owner/payroll',   Icon: Wallet,          label: 'Payroll', feature: 'finance' },
  { href: '/owner/activity',  Icon: ClipboardList,   label: 'Activity', feature: 'activity_log' },
  { href: '/owner/config',    Icon: Settings,        label: 'Config' },
  { href: '/owner/reports',   Icon: BarChart3,       label: 'Reports', feature: 'reports' },
  { href: '/owner/alerts',    Icon: Bell,            label: 'Alerts', feature: 'alerts' },
];

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const brand = useBranding();
  const [features, setFeatures] = useState<string[]>(ALL_FEATURE_KEYS);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(d => { if (d?.features) setFeatures(d.features); }).catch(() => {});
  }, []);

  // Live count of unacknowledged alerts → red badge on the bell. Refreshes on navigation.
  useEffect(() => {
    fetch('/api/data/alerts', { credentials: 'include' }).then(r => r.ok ? r.json() : [])
      .then(a => setAlertCount(Array.isArray(a) ? a.filter((x: { acknowledged?: boolean }) => !x.acknowledged).length : 0)).catch(() => {});
  }, [pathname]);

  if (pathname === '/owner/login' || pathname === '/owner/setup') return <>{children}</>;

  const navItems = ALL_NAV.filter((i) => !i.feature || features.includes(i.feature));
  const section = navItems.find((i) => pathname.startsWith(i.href));
  const isDetail = section ? pathname !== section.href : false; // e.g. /owner/farm/[batchId]
  const handleLogout = () => { logout(); router.replace('/owner/login'); };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-green-950 text-white flex-col shrink-0 hidden md:flex">
        <div className="px-5 py-5 border-b border-green-800/70">
          <div className="flex items-center gap-2 mb-1">
            {brand.logoUrl
              ?   <img src={brand.logoUrl} alt={brand.appName} className="w-7 h-7 object-contain" />
              : <span className="text-2xl">🌾</span>}
            <span className="font-bold text-lg">{brand.appName}</span>
          </div>
          {user && <p className="text-green-200/80 text-xs">{user.name}</p>}
          {user && <span className="text-xs bg-green-700/60 text-green-100 px-2 py-0.5 rounded-full capitalize">{user.role}</span>}
        </div>
        <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active ? 'bg-green-600 text-white shadow-sm' : 'text-green-100/75 hover:bg-green-800/60 hover:text-white')}>
                <item.Icon className="w-[18px] h-[18px]" strokeWidth={2} />{item.label}
                {item.href === '/owner/alerts' && alertCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{alertCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-green-800/70">
          <button onClick={handleLogout} className="text-sm text-green-200/80 hover:text-white flex items-center gap-2">⏻ Logout</button>
        </div>
      </aside>

      {/* Mobile nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-green-950 text-white z-50 flex overflow-x-auto">
        {navItems.slice(0, 6).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}
              className={cn('flex flex-col items-center gap-1 px-3 py-2 text-[11px] shrink-0', active ? 'text-green-400' : 'text-green-200/70')}>
              <item.Icon className="w-5 h-5" strokeWidth={2} />{item.label}
            </Link>
          );
        })}
      </div>

      {/* Main column with top bar */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="Back"
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 text-xl">‹</button>
          {/* Breadcrumb — where you are */}
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            <Link href="/owner/dashboard" className="text-gray-400 hover:text-gray-600">Home</Link>
            {section && (
              <>
                <span className="text-gray-300">/</span>
                <Link href={section.href} className={cn('font-semibold truncate flex items-center gap-1.5', isDetail ? 'text-gray-500 hover:text-gray-700' : 'text-gray-900')}>
                  <section.Icon className="w-4 h-4" /> {section.label}
                </Link>
              </>
            )}
            {isDetail && (<><span className="text-gray-300">/</span><span className="text-gray-900 font-semibold">Detail</span></>)}
          </nav>
          <div className="flex-1" />
          {features.includes('alerts') && (
            <Link href="/owner/alerts" aria-label="Alerts" className="relative p-2 rounded-lg hover:bg-gray-100">
              <Bell className="w-5 h-5 text-gray-600" />
              {alertCount > 0 && (
                <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">{alertCount > 9 ? '9+' : alertCount}</span>
              )}
            </Link>
          )}
          <span className="hidden sm:inline text-xs text-gray-400 capitalize">{user?.name} · {user?.role}</span>
          <button onClick={handleLogout}
            className="text-sm font-semibold text-gray-600 hover:text-red-600 border border-gray-200 rounded-lg px-3 py-1.5">Logout</button>
        </header>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
      </div>

      {/* Floating onboarding guide + AI advisor — gated by the farm's plan */}
      {features.includes('setup_guide') && <SetupGuide />}
      {features.includes('ai_advisor') && <AIAdvisor />}
      {/* Acceptance-testing panel — self-hides unless the admin enabled testing. */}
      <TestingGuide />
    </div>
  );
}
