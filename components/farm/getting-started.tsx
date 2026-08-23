'use client';
import React from 'react';
import { TopNav } from './navigation';
import { ONBOARDING_GUIDE_STEPS } from '@/lib/onboarding-guide';

// ── Getting Started (onboarding-guide follow-up) ────────────────────────────
// Renders the exact same list the approval email sends (lib/onboarding-guide.ts)
// — reachable from Settings for anyone who deleted that email, or who wants to
// check what's next without digging through their inbox. See that file's
// header for why the copy lives there instead of being duplicated here.
export function GettingStartedScreen() {
  return (
    <div className="screen-content">
      <TopNav title="Getting Started" showBack />
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 32 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
          The same steps we emailed you when your application was approved, in the order that actually gets a farm running.
        </div>
        <div className="farm-card" style={{ overflow: 'hidden' }}>
          {ONBOARDING_GUIDE_STEPS.map((step, i) => (
            <div
              key={step.title}
              style={{
                display: 'flex', gap: 12, padding: 14,
                borderBottom: i < ONBOARDING_GUIDE_STEPS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <div
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--primary-green)',
                }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{step.title}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{step.body}</div>
                {step.screen && (
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                    {step.screen}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
