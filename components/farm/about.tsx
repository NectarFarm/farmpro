'use client';
import React from 'react';
import { TopNav } from './navigation';
import { Leaf, Home, Layers, CheckSquare, Package, DollarSign, CreditCard, Shield, CloudSun, Users, WifiOff } from './icons';
import { ENTERPRISE_REGISTRY } from './data';
import { PageHeader } from '@/components/ui-kit/page-header';
import { Badge } from '@/components/ui-kit/badge';

// ── About IFMS (ui-polish-theme-weather; refreshed feat/email-notifications;
// restyled onto ui-kit for settings-redesign, package G) ────────────────────
// Settings' "About IFMS" row used to be a single non-tappable line: "About
// IFMS · Version X.Y.Z". Real, but not a page — just a fact with nowhere to
// go. This is that page, reached from Settings → About IFMS.
//
// Every fact on this screen is real and sourced from something that already
// exists in the codebase, on purpose: no invented company name, support
// address, copyright line or fake rating/testimonial — the same discipline
// settings.tsx already applies elsewhere (Sync Now, Help & Support and
// Privacy Policy were removed rather than wired to placeholders; About's own
// version line reads the real build-time package.json version). This screen
// extends that: modules listed are real, shipped screens; enterprises listed
// are ENTERPRISE_REGISTRY's real config (components/farm/data.ts), not demo
// batch names. "Offline-friendly recording" below is deliberately worded to
// match what actually exists — a per-tenant "Offline Mode: cache data for
// use without internet" setting (components/farm/settings.tsx) — not a
// background sync engine; there is no service worker or write queue
// anywhere in this codebase (checked next.config.ts and grepped the repo),
// and this screen doesn't claim one.
const MODULES = [
  { icon: Home, label: 'Farms', desc: 'Multiple farms per account, filtered per-farm across every screen' },
  { icon: Layers, label: 'Batches & units', desc: 'Production units and batches per enterprise, acquisition to close-out' },
  { icon: Package, label: 'Inventory', desc: 'Stock, lots, purchases and low-stock alerts' },
  { icon: DollarSign, label: 'Finance', desc: 'Sales, purchases and a real double-entry ledger' },
  { icon: CreditCard, label: 'Payroll', desc: 'Employees, payroll runs and payslips' },
  { icon: CheckSquare, label: 'Tasks', desc: 'Assign, track and approve day-to-day work' },
  { icon: Shield, label: 'Approvals', desc: 'Role-based access, approval workflows and an audit trail' },
  { icon: CloudSun, label: 'Weather', desc: 'Live forecast for each farm, via Open-Meteo' },
  { icon: Users, label: 'People', desc: 'Employees, worker accounts and PIN sign-in' },
  { icon: WifiOff, label: 'Offline-friendly recording', desc: 'Cache data for use in low-connectivity fields' },
];

// De-duplicated, real enterprise types the app currently models — pulled
// from the same registry CropScheduleScreen/BatchDetailScreen/
// WorkerRecordScreen read, not a marketing list maintained separately.
const ENTERPRISES = [...new Set(ENTERPRISE_REGISTRY.map((e) => e.label))];

export function AboutScreen() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? '—';

  return (
    <div className="screen-content">
      <TopNav title="" showBack />
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 32 }}>
        <PageHeader kicker="About" title="IFMS" lede="Integrated Farm Management System" />

        <div className="mt-5 flex flex-col items-center gap-2 rounded-xl bg-surface p-6 text-center shadow-(--shadow-border)">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2">
            <Leaf size={28} className="text-primary" strokeWidth={2.2} />
          </div>
          <div className="mt-1 text-xs text-subtle">Version {version}</div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium tracking-widest text-muted uppercase">What it does</p>
          <div className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            <p className="text-sm leading-relaxed text-fg">
              IFMS runs the day-to-day of a multi-farm business from one app: batches and
              production units, stock and purchases, a double-entry ledger, payroll, tasks
              and approvals, all filtered per farm and gated by role — built to work on an
              ordinary Android phone in the field as well as at a desk.
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Modules</p>
          <div className="overflow-hidden rounded-xl bg-surface shadow-(--shadow-border)">
            {MODULES.map((m, i) => (
              <div key={m.label} className={i < MODULES.length - 1 ? 'flex items-center gap-3 border-b border-border/70 px-4 py-3' : 'flex items-center gap-3 px-4 py-3'}>
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                  <m.icon size={16} className="text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="mt-0.5 text-xs text-muted">{m.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium tracking-widest text-muted uppercase">Enterprises supported</p>
          <div className="flex flex-wrap gap-1.5 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
            {ENTERPRISES.map((label) => (
              <Badge key={label} variant="success">{label}</Badge>
            ))}
          </div>
        </div>

        <div className="mt-5 text-center text-xs text-subtle">
          Version {version} · built on Next.js
        </div>
      </div>
    </div>
  );
}
