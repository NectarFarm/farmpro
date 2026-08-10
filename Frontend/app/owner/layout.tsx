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
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useBranding } from '@/lib/useBranding';
import { LayoutDashboard, Tractor, Boxes, Wallet, Users, ClipboardList, Settings, BarChart3, Bell, Wheat, type LucideIcon } from 'lucide-react';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { AppShell, type AppShellTheme } from '@/components/layout/AppShell';

const ALL_NAV: { href: string; Icon: LucideIcon; label: string; feature?: string; group: string }[] = [
  { href: '/owner/dashboard', Icon: LayoutDashboard, label: 'Dashboard', group: 'Overview' },
  { href: '/owner/alerts',    Icon: Bell,            label: 'Alerts', feature: 'alerts', group: 'Overview' },
  { href: '/owner/farm',      Icon: Tractor,         label: 'Farm', group: 'Farm' },
  { href: '/owner/tasks',     Icon: ClipboardList,   label: 'Tasks', group: 'Farm' },
  { href: '/owner/inventory', Icon: Boxes,           label: 'Inventory', group: 'Farm' },
  { href: '/owner/finance',   Icon: Wallet,          label: 'Finance', feature: 'finance', group: 'Money & People' },
  { href: '/owner/payroll',   Icon: Wallet,          label: 'Payroll', feature: 'finance', group: 'Money & People' },
  { href: '/owner/people',    Icon: Users,           label: 'People', group: 'Money & People' },
  { href: '/owner/activity',  Icon: ClipboardList,   label: 'Activity', feature: 'activity_log', group: 'Records' },
  { href: '/owner/reports',   Icon: BarChart3,       label: 'Reports', feature: 'reports', group: 'Records' },
  { href: '/owner/config',    Icon: Settings,        label: 'Config', group: 'Setup' },
];

const OWNER_THEME: AppShellTheme = {
  sidebarBg: 'bg-green-950',
  sidebarBorder: 'border-green-800/70',
  activeNavBg: 'bg-green-600',
  inactiveNavText: 'text-green-100/75',
  hoverNavBg: 'hover:bg-green-800/60',
  mobileActiveText: 'text-green-400',
  mobileInactiveText: 'text-green-200/70',
  pageBg: 'bg-gray-50',
};

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const brand = useBranding();
  const { t } = useTranslation();
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

  const navItems = ALL_NAV
    .filter((i) => !i.feature || features.includes(i.feature))
    .map((i) => (i.href === '/owner/alerts' ? { ...i, badge: alertCount } : i));
  const handleLogout = () => { logout(); router.replace('/owner/login'); };

  return (
    <AppShell
      theme={OWNER_THEME}
      navItems={navItems}
      drawerTitle={brand.appName}
      homeHref="/owner/dashboard"
      homeLabel={t('home')}
      detailLabel={t('details')}
      brand={
        <div className="flex items-center gap-2 mb-1">
          {brand.logoUrl
            ? <img src={brand.logoUrl} alt={brand.appName} className="w-7 h-7 object-contain" />
            : <Wheat className="w-6 h-6 text-green-300" />}
          <span className="font-bold text-lg">{brand.appName}</span>
        </div>
      }
      sidebarSubtitle={
        user && (
          <>
            <p className="text-green-200/80 text-xs">{user.name}</p>
            <span className="text-xs bg-green-700/60 text-green-100 px-2 py-0.5 rounded-full capitalize">{user.role}</span>
          </>
        )
      }
      sidebarFooter={
        <button onClick={handleLogout} className="text-sm text-green-200/80 hover:text-white flex items-center gap-2">⏻ {t('logout')}</button>
      }
      headerRight={
        <>
          {features.includes('alerts') && (
            <Link href="/owner/alerts" aria-label="Alerts" className="relative p-2 rounded-lg hover:bg-gray-100">
              <Bell className="w-5 h-5 text-gray-600" />
              {alertCount > 0 && (
                <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">{alertCount > 9 ? '9+' : alertCount}</span>
              )}
            </Link>
          )}
          <span className="hidden sm:inline text-xs text-gray-400 capitalize">{user?.name} · {user?.role}</span>
          <LanguageSwitcher compact />
          <button onClick={handleLogout}
            className="text-sm font-semibold text-gray-600 hover:text-red-600 border border-gray-200 rounded-lg px-3 py-1.5">{t('logout')}</button>
        </>
      }
      floatingContent={
        <>
          {/* Floating onboarding guide + AI advisor — gated by the farm's plan */}
          {features.includes('setup_guide') && <SetupGuide />}
          {features.includes('ai_advisor') && <AIAdvisor />}
          {/* Acceptance-testing panel — self-hides unless the admin enabled testing. */}
          <TestingGuide />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
