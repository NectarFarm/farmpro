'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Check } from './icons';

/* ── Guided tour ────────────────────────────────────────────────────────────
 * A first-run walkthrough: highlight one real control, say what it is for,
 * click through.
 *
 * Two decisions worth stating, because both are the difference between a
 * tour that helps and one that gets skipped on sight:
 *
 * 1. Steps point at REAL elements by `data-tour` attribute, and a step whose
 *    element isn't on the page is skipped rather than shown pointing at
 *    nothing. This app renders a different shell on mobile (BottomNav) and
 *    desktop (AppSidebar), and different tabs per role — a tour with a fixed
 *    script would spend half its steps highlighting empty space.
 *
 * 2. It never navigates for you. A tour that moves the app around while
 *    explaining it leaves people unsure what they clicked and what it did;
 *    this one highlights what is in front of them, and stops when the useful
 *    part is over.
 *
 * Completion is stored per user in localStorage rather than on the server:
 * it is a UI preference of this browser, it must survive a failed request,
 * and syncing it would mean a schema change to record something nobody will
 * ever query. `dismissed` and `completed` are stored the same way on
 * purpose — someone who closed the tour does not want it back on next load
 * either. Both are re-runnable from Settings.
 */

export interface TourStep {
  /** Matches a `data-tour="…"` attribute somewhere in the app. */
  target: string;
  title: string;
  body: string;
  /** Preferred side; flipped automatically when it would go off-screen. */
  placement?: 'top' | 'bottom';
}

const STORAGE_PREFIX = 'ifms.tour.';

export function tourStorageKey(tourId: string, userKey: string): string {
  return `${STORAGE_PREFIX}${tourId}.${userKey}`;
}

// Every read and write is guarded: private windows, disabled site data and
// embedded webviews can all throw on access rather than returning null, and
// a tour is never worth breaking a page load over.
export function hasSeenTour(tourId: string, userKey: string): boolean {
  try {
    return window.localStorage.getItem(tourStorageKey(tourId, userKey)) !== null;
  } catch {
    return true; // Can't tell — err towards not nagging.
  }
}

export function markTourSeen(tourId: string, userKey: string, how: 'completed' | 'dismissed'): void {
  try {
    window.localStorage.setItem(tourStorageKey(tourId, userKey), how);
  } catch {
    /* nothing to do — the tour just runs again next time */
  }
}

export function clearTourSeen(tourId: string, userKey: string): void {
  try {
    window.localStorage.removeItem(tourStorageKey(tourId, userKey));
  } catch {
    /* ignore */
  }
}

interface Rect { top: number; left: number; width: number; height: number }

// Both shells are mounted at once — the sidebar and the bottom bar carry the
// same `data-tour` ids and CSS hides one of them — so this looks for the
// first match that is actually VISIBLE rather than the first match in the
// document. Taking querySelector's answer would drop half the tour on
// whichever shell happens to render second.
function readRect(target: string): Rect | null {
  const candidates = document.querySelectorAll(`[data-tour="${CSS.escape(target)}"]`);
  for (const el of Array.from(candidates)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
  }
  return null;
}

export function TourOverlay({ steps, onFinish }: { steps: TourStep[]; onFinish: (how: 'completed' | 'dismissed') => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Only steps whose element is actually on the page right now. Recomputed
  // when the viewport changes, so rotating a phone or resizing a window
  // between the two shells doesn't strand the tour on a step that vanished.
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>([]);

  const recompute = useCallback(() => {
    const present = steps.filter((s) => readRect(s.target) !== null);
    setVisibleSteps(present);
    setIndex((current) => Math.min(current, Math.max(present.length - 1, 0)));
  }, [steps]);

  useEffect(() => {
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [recompute]);

  const step = visibleSteps[index];

  useEffect(() => {
    if (!step) return;
    const update = () => setRect(readRect(step.target));
    update();
    // Scroll the highlighted control into view before measuring it, or the
    // spotlight lands off-screen on a long page.
    const el = Array.from(document.querySelectorAll(`[data-tour="${CSS.escape(step.target)}"]`))
      .find((candidate) => candidate.getBoundingClientRect().height > 0);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = window.setTimeout(update, 320);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  // Escape closes it, like every other dismissible layer in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFinish('dismissed');
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, visibleSteps.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onFinish, visibleSteps.length]);

  const cardPosition = useMemo(() => {
    if (!rect) return null;
    const margin = 12;
    const cardHeight = cardRef.current?.offsetHeight ?? 170;
    const below = rect.top + rect.height + margin;
    const wantsAbove = step?.placement === 'top' || below + cardHeight > window.innerHeight;
    const top = wantsAbove
      ? Math.max(margin, rect.top - cardHeight - margin)
      : below;
    // Kept fully on screen horizontally even when the target is at an edge.
    const width = Math.min(340, window.innerWidth - margin * 2);
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - margin
    );
    return { top, left, width, pointingUp: !wantsAbove };
  }, [rect, step]);

  if (!step || visibleSteps.length === 0) return null;

  const isLast = index === visibleSteps.length - 1;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400 }} role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* The spotlight: one box over the target, with the dimming done by an
         enormous spread shadow so there is a genuine hole rather than four
         panels that never quite line up. */}
      {rect && (
        <div
          style={{
            position: 'fixed',
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
            border: '2px solid var(--primary-green)',
            pointerEvents: 'none',
            transition: 'top 0.2s, left 0.2s, width 0.2s, height 0.2s',
          }}
        />
      )}

      {/* Clicking the dimmed area does nothing on purpose: a mis-tap that
         silently ended the tour would read as the app breaking. Skip is a
         button. */}
      <div style={{ position: 'fixed', inset: 0 }} onClick={(e) => e.stopPropagation()} />

      {cardPosition && (
        <div
          ref={cardRef}
          style={{
            position: 'fixed', top: cardPosition.top, left: cardPosition.left, width: cardPosition.width,
            background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 14,
            padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
          }}
        >
          {/* The pointer — the "arrow thing" that ties the card to the
             control it is describing. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: Math.max(14, Math.min((rect?.left ?? 0) + (rect?.width ?? 0) / 2 - cardPosition.left - 7, cardPosition.width - 28)),
              [cardPosition.pointingUp ? 'top' : 'bottom']: -7,
              width: 13, height: 13, background: 'var(--surface)',
              borderLeft: '1px solid var(--border-subtle)', borderTop: '1px solid var(--border-subtle)',
              transform: cardPosition.pointingUp ? 'rotate(45deg)' : 'rotate(225deg)',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 'var(--fs-base)', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>{step.title}</div>
            <button className="btn-icon" aria-label="Skip tour" onClick={() => onFinish('dismissed')}><X size={14} /></button>
          </div>

          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 14 }}>{step.body}</div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4 }} aria-label={`Step ${index + 1} of ${visibleSteps.length}`}>
              {visibleSteps.map((s, i) => (
                <span key={s.target} style={{
                  width: i === index ? 16 : 6, height: 6, borderRadius: 100,
                  background: i === index ? 'var(--primary-green)' : 'var(--border-subtle)',
                  transition: 'width 0.15s',
                }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {index > 0 && (
                <button className="btn-secondary" style={{ padding: '7px 10px' }} onClick={() => setIndex((i) => i - 1)}>
                  <ChevronLeft size={13} /> Back
                </button>
              )}
              <button
                className="btn-primary"
                style={{ padding: '7px 12px' }}
                onClick={() => (isLast ? onFinish('completed') : setIndex((i) => i + 1))}
              >
                {isLast ? <><Check size={13} /> Got it</> : <>Next <ChevronRight size={13} /></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── The tours themselves ───────────────────────────────────────────────────
 * Ordered as the setup actually goes, not as the menu happens to be laid
 * out: what you keep, who works for you, what they have to do, then the
 * things that read from those. A step whose element is missing for this role
 * or this screen size drops out silently (see TourOverlay), so one script
 * covers both shells.
 */
const OWNER_TOUR: TourStep[] = [
  {
    target: 'nav-dashboard',
    title: 'Start here each morning',
    body: 'The dashboard totals up production, money and anything overdue across your farms. It fills in as you record work — an empty dashboard means nothing has been entered yet, not that something is broken.',
  },
  {
    target: 'farm-switcher',
    title: 'One farm, or all of them',
    body: 'Every figure in the app follows this. Leave it on “All farms” to see the whole business, or pick one to narrow every screen to it.',
  },
  {
    target: 'nav-crops',
    title: 'Set up what you keep',
    body: 'Houses, fields and batches live here. This is the first thing to fill in — production, feed and costs all attach to a batch, so the rest of the app has little to show until at least one exists.',
  },
  {
    target: 'nav-people',
    title: 'Add your workers — and give them a way in',
    body: 'Add each person, then open them and use the Sign-in card to give them a phone number and a 4-digit PIN. That pair is how they log in on their own phone; without it they have a record here but no access.',
  },
  {
    target: 'nav-tasks',
    title: 'Plan the work',
    body: 'Assign a job to a person, set when it is due, and let it repeat if it happens every day or week. The Schedule view shows the month at a glance, including the days nobody is booked to do anything.',
  },
  {
    target: 'nav-weather',
    title: 'Weather for your actual location',
    body: 'This reads the GPS pin on your farm. If the forecast looks wrong or missing, the pin is what to check — you can set it in Settings.',
  },
  {
    target: 'nav-settings',
    title: 'Everything else, and this tour again',
    body: 'Farm details, roles and permissions, worker PINs and your own preferences. You can restart this walkthrough from here any time.',
    placement: 'top',
  },
];

const WORKER_TOUR: TourStep[] = [
  {
    target: 'nav-worker-home',
    title: 'Your jobs for today',
    body: 'Whatever has been assigned to you shows up here. Tap one to record what you did.',
  },
  {
    target: 'nav-worker-record',
    title: 'Record as you go',
    body: 'Log production, feed and any deaths from here. Record it while you are at the house — it is quicker than remembering it later, and the totals your employer sees come straight from this.',
  },
  {
    target: 'nav-worker-pay',
    title: 'Your pay',
    body: 'Payslips appear here once your employer runs payroll.',
  },
];

export const TOURS: Record<string, TourStep[]> = {
  owner: OWNER_TOUR,
  manager: OWNER_TOUR,
  worker: WORKER_TOUR,
};

// One id per script, so changing the owner tour later doesn't re-show the
// worker one to people who already dismissed it.
export function tourIdForRole(role: string): string | null {
  if (role === 'owner' || role === 'manager') return 'owner-v1';
  if (role === 'worker') return 'worker-v1';
  // vet, auditor and super_admin land on a single restricted screen — there
  // is nothing to walk through.
  return null;
}

/* ── Controller ─────────────────────────────────────────────────────────────
 * Mounted once inside the app shell. Decides whether the walkthrough should
 * run at all, and listens for a request to run it again.
 *
 * The delay before the first step is not decoration: the shell mounts before
 * its data arrives, and highlighting a nav item while the page is still
 * laying out puts the spotlight over the wrong rectangle.
 */
export const START_TOUR_EVENT = 'ifms:start-tour';

// Settings (and anything else) asks for the tour without importing state:
// same decoupling as the global logout hook in navigation.tsx.
export function requestTour(): void {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
}

export function TourController({ role, userKey }: { role: string; userKey: string }) {
  const [running, setRunning] = useState(false);
  const tourId = tourIdForRole(role);
  const steps = TOURS[role] ?? [];

  useEffect(() => {
    if (!tourId) return;
    if (hasSeenTour(tourId, userKey)) return;
    const timer = window.setTimeout(() => setRunning(true), 900);
    return () => window.clearTimeout(timer);
  }, [tourId, userKey]);

  useEffect(() => {
    const onRequest = () => setRunning(true);
    window.addEventListener(START_TOUR_EVENT, onRequest);
    return () => window.removeEventListener(START_TOUR_EVENT, onRequest);
  }, []);

  const finish = useCallback((how: 'completed' | 'dismissed') => {
    setRunning(false);
    if (tourId) markTourSeen(tourId, userKey, how);
  }, [tourId, userKey]);

  if (!running || !tourId || steps.length === 0) return null;
  return <TourOverlay steps={steps} onFinish={finish} />;
}
