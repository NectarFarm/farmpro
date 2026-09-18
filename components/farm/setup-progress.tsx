'use client';
import React from 'react';
import { Check, ArrowRight, ClipboardList, CheckCircle2 } from './icons';
import { useNav, type ScreenId } from './navigation';
import type { SetupState, SetupStepState } from '@/lib/setup-state';

/* ── Setup progress UI ──────────────────────────────────────────────────────
 * The owner's complaint, verbatim: "that navigation does not show the
 * sequential process in the app. Like I expect once someone opens the app he
 * should just know: am going to Farm setting this up, going to Employees
 * setting this up."
 *
 * The sequence itself is not new and is not written here — it lives once in
 * lib/onboarding-guide.ts and reaches this file already annotated with real
 * done/not-done from GET /api/setup-state (derived in lib/setup-state.ts).
 * Nothing in this file decides whether a step is finished; it only draws what
 * the server said.
 *
 * Two hard constraints shaped the design:
 *
 *  1. It has to GET OUT OF THE WAY. A permanent checklist on a farm that has
 *     been running for two years is clutter, and the owner asked for the
 *     opposite of clutter. So `SetupStrip` renders NOTHING once every step is
 *     done — not a collapsed row, not a "100%" badge. The Getting Started
 *     screen stays reachable from Manage for anyone who wants to re-read it,
 *     and shows an all-done state there because that screen was deliberately
 *     opened.
 *
 *  2. It must not become a SECOND navigation system. The strip is one card
 *     with one button that deep-links to the single next step. It does not
 *     list every destination, does not stick to the viewport, and does not
 *     duplicate the tab bar. The full checklist lives on one screen
 *     (Getting Started), which is where somebody goes when they want the
 *     whole list rather than the next thing.
 */

/** Response envelope of GET /api/setup-state. */
export type SetupStateResponse = SetupState;

/** How far round the ring, 0–1. Guarded against a zero total so a future
 *  empty guide can never produce NaN in a stroke-dasharray. */
export function setupFraction(completed: number, total: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, completed / total));
}

/* A ring rather than a bar. At 360px a progress bar spanning the card reads as
 * decoration; a 44px ring with "4/9" inside it is the same information in a
 * fixed footprint next to the text it belongs to, and it cannot reflow. */
function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const filled = setupFraction(completed, total) * circumference;
  return (
    <svg
      width={44}
      height={44}
      viewBox="0 0 44 44"
      role="img"
      aria-label={`${completed} of ${total} setup steps done`}
      style={{ flexShrink: 0 }}
    >
      <circle cx={22} cy={22} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={4} />
      <circle
        cx={22} cy={22} r={r} fill="none"
        stroke="var(--primary-green)" strokeWidth={4} strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference - filled}`}
        transform="rotate(-90 22 22)"
      />
      <text
        x={22} y={22} textAnchor="middle" dominantBaseline="central"
        fontSize={13} fontWeight={800} fill="var(--text-primary)"
        aria-hidden="true"
      >
        {completed}/{total}
      </text>
    </svg>
  );
}

/**
 * The dashboard's setup card: where you are, what is next, and a button that
 * goes there. Renders null when there is nothing useful to say — still
 * loading, the fetch failed, or setup is finished — because an empty or
 * apologetic card in the first slot of the dashboard is worse than no card.
 *
 * A failed fetch specifically renders nothing rather than "couldn't load your
 * progress": this is an aid, not a figure anybody is deciding on, and the rest
 * of the dashboard is unaffected. That is a different call from the KPI grid
 * below it, which DOES say when it failed — because there a blank number would
 * be read as "your farm earned nothing".
 */
export function SetupStrip({ state, onNavigate }: {
  state: SetupState | null;
  onNavigate: (screen: ScreenId, params?: Record<string, string>) => void;
}) {
  if (!state || state.complete) return null;

  const next = state.steps.find((s) => s.id === state.nextStepId) ?? null;
  if (!next) return null;

  const remaining = state.total - state.completed;

  return (
    <div
      className="farm-card"
      data-tour="setup-progress"
      style={{ padding: 14, marginBottom: 12, border: '1px solid rgba(var(--primary-rgb),0.28)' }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <ProgressRing completed={state.completed} total={state.total} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="section-eyebrow" style={{ marginBottom: 2 }}>Setting up your farm</div>
          {/* The count in words, because "4/9" alone says how much but not
              what kind of thing — and this is the line a first-time owner
              reads before anything else on the screen. */}
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {remaining === 1 ? 'One step left before your farm is fully set up.' : `${remaining} steps left before your farm is fully set up.`}
          </div>
        </div>
      </div>

      {/* The next step, named. Not "continue setup" — the whole complaint was
          that nothing told you what you were about to do. */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
          Next
        </div>
        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 750, color: 'var(--text-primary)', marginTop: 3, lineHeight: 1.35 }}>
          {next.title}
        </div>
        {/* The real state of that step from the server — "No production units
            yet", "3 employees, none with a login yet". This is the honest
            version of a progress indicator: it shows the number the tick was
            derived from, so a wrong tick is visible rather than trusted. */}
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{next.detail}</div>

        <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          {next.goTo && (
            <button
              type="button"
              onClick={() => onNavigate(next.goTo!.screen as ScreenId, next.goTo!.params)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11,
                background: 'rgba(var(--primary-rgb),0.12)', border: '1px solid rgba(var(--primary-rgb),0.35)',
                color: 'var(--primary-green)', fontWeight: 750, fontSize: 'var(--fs-sm)', cursor: 'pointer',
              }}
            >
              Do this now <ArrowRight size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('getting-started')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11,
              background: 'transparent', border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)', fontWeight: 650, fontSize: 'var(--fs-sm)', cursor: 'pointer',
            }}
          >
            <ClipboardList size={13} aria-hidden="true" /> All {state.total} steps
          </button>
        </div>
      </div>
    </div>
  );
}

/* One row of the full checklist. Tappable only when the step has somewhere to
 * go — the sign-in and farm steps have no screen (see lib/onboarding-guide.ts),
 * and a button that does nothing is worse than plain text. */
function StepRow({ step, index, isNext, last, onNavigate }: {
  step: SetupStepState;
  index: number;
  isNext: boolean;
  last: boolean;
  onNavigate: (screen: ScreenId, params?: Record<string, string>) => void;
}) {
  const marker = step.done ? (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      background: 'rgba(var(--primary-rgb),0.14)', border: '1px solid rgba(var(--primary-rgb),0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-green)',
    }}>
      <Check size={14} aria-hidden="true" />
    </div>
  ) : (
    <div style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      background: isNext ? 'rgba(var(--primary-rgb),0.12)' : 'var(--card)',
      border: isNext ? '1px solid rgba(var(--primary-rgb),0.45)' : '1px solid var(--border-subtle)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 'var(--fs-xs)', fontWeight: 700,
      color: isNext ? 'var(--primary-green)' : 'var(--text-dim)',
    }}>
      {index + 1}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: 14,
        borderBottom: last ? 'none' : '1px solid var(--border-subtle)',
        // The next step is the only one tinted. Highlighting every unfinished
        // step would make eight of nine rows shout at a brand-new owner.
        background: isNext ? 'rgba(var(--primary-rgb),0.05)' : 'transparent',
      }}
    >
      {marker}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 'var(--fs-base)', fontWeight: 700,
            // A finished step steps back rather than disappearing: you can
            // still read what you did, it just stops competing for attention.
            color: step.done ? 'var(--text-muted)' : 'var(--text-primary)',
          }}>
            {step.title}
          </span>
          {isNext && (
            <span className="chip" style={{ fontSize: 'var(--fs-2xs)', fontWeight: 800, color: 'var(--primary-green)' }}>
              You are here
            </span>
          )}
        </div>
        {/* Real counts from the server, not a status word. */}
        <div style={{ fontSize: 'var(--fs-xs)', color: step.done ? 'var(--text-dim)' : 'var(--text-secondary)', marginTop: 3, fontWeight: 600 }}>
          {step.detail}
        </div>
        {/* The instructions for a step you have already done are dead weight:
            nine full paragraphs made this list four screens long on a phone,
            most of it explaining work already finished. A done step keeps its
            title and its real count (which is the evidence for the tick) and
            drops the how-to. An unfinished one keeps everything, because that
            is the one you are about to do. */}
        {!step.done && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{step.body}</div>
        )}
        {step.done ? null : step.goTo ? (
          <button
            type="button"
            onClick={() => onNavigate(step.goTo!.screen as ScreenId, step.goTo!.params)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '7px 11px', borderRadius: 10,
              background: 'transparent', border: '1px solid var(--border-subtle)',
              color: 'var(--primary-green)', fontWeight: 700, fontSize: 'var(--fs-xs)', cursor: 'pointer',
            }}
          >
            {step.screen ?? 'Open'} <ArrowRight size={12} aria-hidden="true" />
          </button>
        ) : step.screen ? (
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
            {step.screen}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The full checklist, for the Getting Started screen.
 *
 * `state === null` is "not loaded" and renders the guide with no ticks at all
 * (see GettingStartedScreen, which passes the plain guide through in that
 * case) — never a guessed or optimistic tick. This component only draws ticks
 * it was given.
 */
export function SetupChecklist({ state, onNavigate }: {
  state: SetupState;
  onNavigate: (screen: ScreenId, params?: Record<string, string>) => void;
}) {
  return (
    <>
      {state.complete ? (
        <div className="farm-card" style={{ padding: 14, marginBottom: 12, display: 'flex', gap: 11, alignItems: 'center', border: '1px solid rgba(var(--primary-rgb),0.28)' }}>
          <CheckCircle2 size={20} color="var(--primary-green)" aria-hidden="true" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Every setup step is done. This list stays here for reference — it no longer appears on your dashboard.
          </div>
        </div>
      ) : (
        <div className="farm-card" style={{ padding: 14, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', border: '1px solid rgba(var(--primary-rgb),0.28)' }}>
          <ProgressRing completed={state.completed} total={state.total} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 750, color: 'var(--text-primary)' }}>
              {state.completed} of {state.total} done
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
              Counted from your own records, not from what you have clicked.
            </div>
          </div>
        </div>
      )}
      <div className="farm-card" style={{ overflow: 'hidden' }}>
        {state.steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            isNext={step.id === state.nextStepId}
            last={i === state.steps.length - 1}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Convenience wrapper for screens that already sit inside NavProvider: pulls
 * the shared setup state and navigate() off the context so a caller does not
 * have to thread both. The state itself is fetched ONCE, in NavProvider, and
 * shared — three screens read it (dashboard strip, sidebar row, Getting
 * Started), and three independent fetches of the same ten counts is exactly
 * the kind of duplication this endpoint exists to avoid.
 */
export function useSetupProgress() {
  const { setupState, refreshSetupState, navigate } = useNav();
  return { setupState, refreshSetupState, navigate };
}
