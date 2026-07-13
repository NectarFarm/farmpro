'use client';
// Shared desktop shell for role dashboards (owner, admin, ...): sidebar nav +
// sticky header (back button, breadcrumb) + mobile bottom nav.
// Each role keeps its own colors, brand block, and header/footer contents by
// passing them in as props/nodes — this component only owns the structural
// skeleton and the active-link / breadcrumb computation shared by all of them.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { WifiOff, type LucideIcon } from 'lucide-react';
import { NavDrawer } from './NavDrawer';

export interface AppShellNavItem {
  href: string;
  Icon: LucideIcon;
  label: string;
  badge?: number;
  /** Groups items under a heading in the mobile nav drawer. Ungrouped items
   *  (no `group`) render under no heading, before any grouped ones. Doesn't
   *  affect the desktop sidebar, which already shows every item flat. */
  group?: string;
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
  /** Logo + app name block at the top of the sidebar. Styled for the sidebar's
   *  own dark background (e.g. `text-green-300` icons) — not reused in the
   *  mobile nav drawer, which has a light header of its own. */
  brand: React.ReactNode;
  /** Plain-text app/section name for the mobile nav drawer's light-background
   *  header, e.g. "Kutswa's Farm" or "IFMS Admin". */
  drawerTitle: string;
  /** Content under the brand block (user name/role, email, etc). */
  sidebarSubtitle?: React.ReactNode;
  /** Sidebar footer content (typically the logout button, optionally a language switcher). */
  sidebarFooter: React.ReactNode;
  navItems: AppShellNavItem[];
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

// Compact connectivity indicator for the owner/admin shell. Owners on farms have
// the same spotty connectivity as workers, but there's no Dexie outbox to drain
// here (that's a worker-only offline-first flow via useSync()/SyncBadge) — so
// this only ever needs to say ONLINE vs OFFLINE, driven by the browser's own
// online/offline events. Deliberately no sync machinery.
function ConnectivityIndicator() {
  // Starts `true` so server-rendered/pre-hydration markup never flashes an
  // "Offline" pill for a page that's actually online — navigator.onLine is
  // read client-side only, in the effect below.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) {
    return <span className="hidden sm:inline-block w-2 h-2 rounded-full bg-green-500" aria-hidden="true" title="Online" />;
  }
  return (
    <span className="inline-flex items-center gap-1 bg-gray-200 text-gray-700 border border-gray-300 rounded-full px-2.5 py-1 text-xs font-bold">
      <WifiOff className="w-3.5 h-3.5" /> Offline
    </span>
  );
}

export function AppShell({
  theme,
  brand,
  drawerTitle,
  sidebarSubtitle,
  sidebarFooter,
  navItems,
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

      {/* Main column with top bar */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] flex items-center gap-3">
          {/* Mobile: hamburger at the section root (switch sections), back
              button once drilled into a detail (retreat) — there isn't room
              for both, and this matches the depth the user is actually at.
              Desktop always shows back; the sidebar covers section-switching. */}
          {isDetail ? (
            <button onClick={() => router.back()} aria-label="Back"
              className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 text-xl">‹</button>
          ) : (
            <NavDrawer navItems={navItems} title={drawerTitle} />
          )}
          <button onClick={() => router.back()} aria-label="Back"
            className="hidden md:flex min-w-[44px] min-h-[44px] items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 text-xl">‹</button>
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
          <ConnectivityIndicator />
          {headerRight}
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {floatingContent}
    </div>
  );
}
