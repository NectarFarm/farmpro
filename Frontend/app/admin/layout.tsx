'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LayoutDashboard, Tractor, ScrollText, Settings, type LucideIcon } from 'lucide-react';
import { AppShell, type AppShellTheme } from '@/components/layout/AppShell';

const ADMIN_NAV: { href: string; Icon: LucideIcon; label: string }[] = [
  { href: '/admin/dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/admin/farms',     Icon: Tractor,         label: 'Farms' },
  { href: '/admin/audit',     Icon: ScrollText,      label: 'Audit' },
  { href: '/admin/settings',  Icon: Settings,        label: 'Settings' },
];

const ADMIN_THEME: AppShellTheme = {
  sidebarBg: 'bg-gray-900',
  sidebarBorder: 'border-gray-700/70',
  activeNavBg: 'bg-gray-700',
  inactiveNavText: 'text-gray-300/80',
  hoverNavBg: 'hover:bg-gray-800/60',
  mobileActiveText: 'text-green-400',
  mobileInactiveText: 'text-gray-400',
  pageBg: 'bg-gray-100',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => { logout(); router.replace('/login'); };

  // No nav item currently targets /admin/alerts, and the `alerts` resource is
  // scoped to owner/manager/auditor (lib/server/resources.ts) — `admin` isn't
  // included, so an alert-count fetch here would always 403. Not wiring one up
  // until an actual admin-facing alerts feature exists.
  const navItems = ADMIN_NAV;

  return (
    <AppShell
      theme={ADMIN_THEME}
      navItems={navItems}
      homeHref="/admin/dashboard"
      homeLabel="Admin"
      showSectionIcon={false}
      brand={
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🛡️</span>
          <span className="font-bold text-lg">IFMS Admin</span>
        </div>
      }
      sidebarSubtitle={user && <p className="text-gray-400 text-xs">{user.email}</p>}
      sidebarFooter={
        <>
          <LanguageSwitcher compact />
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white flex items-center gap-2">⏻ Logout</button>
        </>
      }
      headerRight={<span className="hidden sm:inline text-xs text-gray-400">{user?.email}</span>}
    >
      {children}
    </AppShell>
  );
}
