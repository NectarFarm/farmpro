'use client';
// Mobile navigation for AppShell — a single, unambiguous entry point (a menu
// icon in the header) opening a full-height drawer with every nav item,
// grouped. Replaces the old `mobileNavItems.slice(0, 6)` bottom bar, which
// silently dropped items once a role had more than 6 (the confirmed cause of
// a real navigation-discoverability bug).
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { AppShellNavItem } from './AppShell';

interface NavGroup {
  heading: string | null;
  items: AppShellNavItem[];
}

function groupNavItems(items: AppShellNavItem[]): NavGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, AppShellNavItem[]>();
  for (const item of items) {
    const key = item.group ?? '';
    if (!byGroup.has(key)) { byGroup.set(key, []); order.push(key); }
    byGroup.get(key)!.push(item);
  }
  return order.map((key) => ({ heading: key || null, items: byGroup.get(key)! }));
}

export interface NavDrawerProps {
  navItems: AppShellNavItem[];
  /** Plain text — the drawer's header is light, unlike the sidebar's `brand`
   *  node, so it can't reuse dark-background-tuned icon colors. */
  title: string;
  triggerClassName?: string;
}

export function NavDrawer({ navItems, title, triggerClassName }: NavDrawerProps) {
  const pathname = usePathname();
  const groups = groupNavItems(navItems);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          aria-label="Open menu"
          className={cn('md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 -ml-1.5', triggerClassName)}
        >
          <Menu className="w-5 h-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[280px] p-0 flex flex-col gap-0">
        <SheetHeader className="border-b border-gray-200 px-4 py-4">
          <SheetTitle className="text-base text-gray-900">{title}</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.heading ?? '_ungrouped'} className="flex flex-col gap-0.5">
              {group.heading && (
                <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">{group.heading}</p>
              )}
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors',
                        active ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-100'
                      )}
                    >
                      <item.Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                      {item.label}
                      {!!item.badge && (
                        <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">{item.badge}</span>
                      )}
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
