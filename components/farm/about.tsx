'use client';
import React from 'react';
import { TopNav } from './navigation';
import { Leaf, Home, Layers, CheckSquare, Package, DollarSign, CreditCard, Shield, CloudSun, Users, WifiOff } from './icons';
import { ENTERPRISE_REGISTRY } from './data';

// ── About IFMS (ui-polish-theme-weather; refreshed feat/email-notifications) ─
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
  { icon: Shield, label: 'Governance', desc: 'Role-based access, approval workflows and an audit trail' },
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
      <TopNav title="About IFMS" showBack />
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 32 }}>

        <div className="farm-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <Leaf size={28} color="var(--primary-green)" strokeWidth={2.2} />
          </div>
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--text-primary)' }}>IFMS</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Integrated Farm Management System</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginTop: 4 }}>Version {version}</div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>What it does</div>
          <div className="farm-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              IFMS runs the day-to-day of a multi-farm business from one app: batches and
              production units, stock and purchases, a double-entry ledger, payroll, tasks
              and approvals, all filtered per farm and gated by role — built to work on an
              ordinary Android phone in the field as well as at a desk.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Modules</div>
          <div className="farm-card" style={{ overflow: 'hidden' }}>
            {MODULES.map((m, i) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: i < MODULES.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--card-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <m.icon size={16} color="var(--primary-green)" />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{m.label}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 1 }}>{m.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Enterprises supported</div>
          <div className="farm-card" style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ENTERPRISES.map((label) => (
              <span key={label} className="chip chip-ok" style={{ fontSize: 'var(--fs-xs)' }}>{label}</span>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.6 }}>
          Version {version} · built on Next.js
        </div>
      </div>
    </div>
  );
}
