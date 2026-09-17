'use client';
import React, { useEffect } from 'react';
import { TopNav, useNav } from './navigation';
import { SetupChecklist } from './setup-progress';
import { ONBOARDING_GUIDE_STEPS } from '@/lib/onboarding-guide';
import { Info } from './icons';

// ── Getting Started (onboarding-guide follow-up; live progress added by the
// setup-sequence task) ──────────────────────────────────────────────────────
// Renders the exact same list the approval email sends (lib/onboarding-guide.ts)
// — reachable from Manage for anyone who deleted that email, or who wants to
// check what's next without digging through their inbox. See that file's
// header for why the copy lives there instead of being duplicated here.
//
// What this screen adds over the email is the thing an email cannot know:
// which steps are already DONE. That comes from GET /api/setup-state, fetched
// once in NavProvider and shared with the dashboard's setup card so the two
// can never disagree. Refreshed on mount below, because the usual way of
// arriving here is straight after doing one of the steps.
export function GettingStartedScreen() {
  const { navigate, setupState, refreshSetupState, role } = useNav();

  // Re-read progress every time this screen opens. Someone who just added
  // their first unit and came back to see it ticked is the expected journey,
  // and a stale list would tell them their work did not register.
  useEffect(() => { refreshSetupState(); }, [refreshSetupState]);

  return (
    <div className="screen-content">
      <TopNav title="Set up your farm" showBack />
      <div className="px-screen" style={{ paddingTop: 16, paddingBottom: 32 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          The same steps we emailed you when your application was approved, in the order that actually gets a farm running.
        </div>

        {setupState ? (
          <SetupChecklist state={setupState} onNavigate={navigate} />
        ) : (
          <>
            {/* No progress to show — either it hasn't arrived yet, or this
             * role never fetches it (only owner/manager do; see NavProvider).
             * The steps themselves are still worth reading, so they render
             * plainly, with NO ticks and NO counts. Showing an unticked list
             * and calling it progress would be a lie in the other direction:
             * a farm that is fully set up must not be told it has done
             * nothing because a request failed. */}
            <div className="farm-card" style={{ padding: '11px 13px', marginBottom: 12, display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <Info size={15} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {role === 'owner' || role === 'manager'
                  ? 'Your progress through these steps isn’t available right now, so the list below is shown without it rather than guessing.'
                  : 'These steps are the farm owner’s to complete, so no progress is shown here.'}
              </div>
            </div>
            <div className="farm-card" style={{ overflow: 'hidden' }}>
              {ONBOARDING_GUIDE_STEPS.map((step, i) => (
                <div
                  key={step.id}
                  style={{
                    display: 'flex', gap: 12, padding: 14,
                    borderBottom: i < ONBOARDING_GUIDE_STEPS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <div
                    style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: 'rgba(var(--primary-rgb),0.12)', border: '1px solid rgba(var(--primary-rgb),0.3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--primary-green)',
                    }}
                  >
                    {i + 1}
                  </div>
                  {/* ── Why the detail is folded away ──────────────────────
                      Every step used to render its whole paragraph at once.
                      Nine of them ran four phone-screens deep, so the one
                      thing this page exists to answer — what do I do next —
                      was buried under prose nobody setting up a farm for the
                      first time is going to read standing up.
                      The body is still here in full, one tap away, because
                      the detail is genuinely useful the moment you are stuck.
                      <details> rather than React state: it is keyboard- and
                      screen-reader-operable for free, and it survives with no
                      JavaScript. */}
                  <div style={{ minWidth: 0 }}>
                    <details>
                      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--text-primary)' }}>{step.title}</span>
                        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--primary-green)', fontWeight: 700, flexShrink: 0 }}>Why</span>
                      </summary>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.55 }}>{step.body}</div>
                    </details>
                    {step.screen && (
                      /* Sentence case, not tracked-out caps. This is a place
                         you can go, so it should read like one. */
                      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 6, fontWeight: 700 }}>
                        {step.screen}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
