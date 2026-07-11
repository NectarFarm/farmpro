'use client';
// Shared desktop shell for role dashboards (owner, admin, ...): sidebar nav +
// sticky header (back button, breadcrumb) + mobile bottom nav.
// Each role keeps its own colors, brand block, and header/footer contents by
// passing them in as props/nodes — this component only owns the structural
// skeleton and the active-link / breadcrumb computation shared by all of them.
import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export interface AppShellNavItem {
  href: string;
  Icon: LucideIcon;
  label: string;
  badge?: number;
}

export interface AppShellTheme {
  /** Sidebar + mobile-nav background, e.g. 'bg-green-950' */
  sidebarBg: string;
  /** Border under the brand block / above the footer, e.g. 'border-green-800/70' */
  sidebarBorder: string;
  /** Active nav-link background, e.g. 'bg-green-600' */
  activeNavBg: string;
  /** Inactive nav-link text color, e.g. 'text-green-100/75' */
  inactiveNavText: string;
  /** Inactive nav-link hover background, e.g. 'hover:bg-green-800/60' */
  hoverNavBg: string;
  /** Mobile-nav active tab text color, e.g. 'text-green-400' */
  mobileActiveText: string;
  /** Mobile-nav inactive tab text color, e.g. 'text-green-200/70' */
  mobileInactiveText: string;
  /** Page background behind the shell, e.g. 'bg-gray-50' */
  pageBg: string;
}

export interface AppShellProps {
  theme: AppShellTheme;
  /** Logo + app name block at the top of the sidebar. */
  brand: React.ReactNode;
  /** Content under the brand block (user name/role, email, etc). */
  sidebarSubtitle?: React.ReactNode;
  /** Sidebar footer content (typically the logout button, optionally a language switcher). */
  sidebarFooter: React.ReactNode;
  navItems: AppShellNavItem[];
  /** Nav items shown in the mobile bottom bar. Defaults to `navItems`. */
  mobileNavItems?: AppShellNavItem[];
  homeHref: string;
  homeLabel: string;
  /** Label for the trailing "detail" breadcrumb segment, e.g. "Details". */
  detailLabel?: string;
  /** Whether to show the section's icon next to its breadcrumb label. */
  showSectionIcon?: boolean;
  /** Content on the right side of the header, after the breadcrumb (alerts bell, user label, logout button, etc). */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  /** Extra floating widgets rendered after main content (e.g. onboarding guide, AI advisor). */
  floatingContent?: React.ReactNode;
}

export function AppShell({
  theme,
  brand,
  sidebarSubtitle,
  sidebarFooter,
  navItems,
  mobileNavItems,
  homeHref,
  homeLabel,
  detailLabel = 'Details',
  showSectionIcon = true,
  headerRight,
  children,
  floatingContent,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const section = navItems.find((i) => pathname.startsWith(i.href));
  const isDetail = section ? pathname !== section.href : false;

  return (
    <div className={cn('flex min-h-screen', theme.pageBg)}>
      {/* Sidebar */}
      <aside className={cn('w-56 text-white flex-col shrink-0 hidden md:flex', theme.sidebarBg)}>
        <div className={cn('px-5 py-5 border-b', theme.sidebarBorder)}>
          {brand}
          {sidebarSubtitle}
        </div>
        <nav className="flex-1 py-3 px-2 flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}
                className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active ? cn(theme.activeNavBg, 'text-white shadow-sm') : cn(theme.inactiveNavText, theme.hoverNavBg, 'hover:text-white'))}>
                <item.Icon className="w-[18px] h-[18px]" strokeWidth={2} />{item.label}
                {!!item.badge && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{item.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className={cn('px-5 py-4 border-t flex flex-col gap-2', theme.sidebarBorder)}>
          {sidebarFooter}
        </div>
      </aside>

      {/* Mobile nav */}
      <div className={cn('md:hidden fixed bottom-0 left-0 right-0 text-white z-50 flex overflow-x-auto pb-[env(safe-area-inset-bottom)]', theme.sidebarBg)}>
        {(mobileNavItems ?? navItems).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}
              className={cn('flex flex-col items-center gap-1 px-3 py-2 text-[11px] shrink-0', active ? theme.mobileActiveText : theme.mobileInactiveText)}>
              <item.Icon className="w-5 h-5" strokeWidth={2} />{item.label}
            </Link>
          );
        })}
      </div>

      {/* Main column with top bar */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="Back"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 text-xl">‹</button>
          {/* Breadcrumb — where you are */}
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            <Link href={homeHref} className="text-gray-400 hover:text-gray-600">{homeLabel}</Link>
            {section && (
              <>
                <span className="text-gray-300">/</span>
                <Link href={section.href} className={cn('font-semibold truncate flex items-center gap-1.5', isDetail ? 'text-gray-500 hover:text-gray-700' : 'text-gray-900')}>
                  {showSectionIcon && <section.Icon className="w-4 h-4" />}{section.label}
                </Link>
              </>
            )}
            {isDetail && (<><span className="text-gray-300">/</span><span className="text-gray-900 font-semibold">{detailLabel}</span></>)}
          </nav>
          <div className="flex-1" />
          {headerRight}
        </header>

        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>
      </div>

      {floatingContent}
    </div>
  );
}
