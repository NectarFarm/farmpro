// Pure lifecycle/growth-stage math — no DB, no I/O — so it's unit-testable and usable
// on both client (Farm badges) and server (alerts, advance). A batch moves through
// ordered STAGES, each starting at a given AGE (days). The farmer configures the stage
// set per enterprise; a batch's age tells him the period before the next phase.

export interface StageDef { name: string; startDay: number }

export interface DueInfo {
  due: boolean;            // age has reached the next stage's start
  nextStage: string | null;
  daysRemaining: number;   // days until the next stage is due (0 once due)
  overdueDays: number;     // days past due (0 until due)
}

// Sensible starting stage sets per enterprise (in DAYS), matching the enterprise keys
// used by productTemplates. The farmer edits these; a farmer who hatches on-farm can
// add an "Incubation" first stage at day 0.
export const STAGE_TEMPLATES: Record<string, StageDef[]> = {
  broilers:   [{ name: 'Brooding', startDay: 0 }, { name: 'Grower', startDay: 14 }, { name: 'Finisher', startDay: 28 }, { name: 'Ready to sell', startDay: 42 }],
  layers:     [{ name: 'Brooding', startDay: 0 }, { name: 'Grower', startDay: 56 }, { name: 'Layer', startDay: 126 }, { name: 'Spent', startDay: 504 }],
  pig_fatten: [{ name: 'Weaner', startDay: 0 }, { name: 'Grower', startDay: 70 }, { name: 'Finisher', startDay: 112 }, { name: 'Market', startDay: 168 }],
  pig_breed:  [{ name: 'Piglet', startDay: 0 }, { name: 'Weaner', startDay: 56 }, { name: 'Gilt/Boar', startDay: 140 }, { name: 'Breeding', startDay: 240 }],
  tilapia:    [{ name: 'Fingerling', startDay: 0 }, { name: 'Juvenile', startDay: 28 }, { name: 'Grow-out', startDay: 84 }, { name: 'Harvest', startDay: 168 }],
  catfish:    [{ name: 'Fingerling', startDay: 0 }, { name: 'Juvenile', startDay: 28 }, { name: 'Grow-out', startDay: 84 }, { name: 'Harvest', startDay: 140 }],
  maize:      [{ name: 'Seedling', startDay: 0 }, { name: 'Vegetative', startDay: 14 }, { name: 'Tasseling', startDay: 56 }, { name: 'Maturity', startDay: 90 }, { name: 'Harvest', startDay: 120 }],
};

export const STAGE_ENTERPRISES = Object.keys(STAGE_TEMPLATES);

// A fresh, mutable copy of an enterprise's default stages (empty if unknown enterprise).
export function defaultStages(enterprise: string | null | undefined): StageDef[] {
  const t = enterprise ? STAGE_TEMPLATES[enterprise] : undefined;
  return t ? t.map((s) => ({ ...s })) : [];
}

// True age of the batch in days = days since acquired + the age it already was on arrival.
export function ageDays(acquiredDate: string, ageAtAcquire = 0, now: number = Date.now()): number {
  const t = new Date(acquiredDate).getTime();
  if (isNaN(t)) return Math.max(0, ageAtAcquire);
  return Math.max(0, Math.floor((now - t) / 86400000) + Math.max(0, ageAtAcquire || 0));
}

function ordered(stages: readonly StageDef[]): StageDef[] {
  return [...stages].sort((a, b) => a.startDay - b.startDay);
}

// The stage a batch of this age SHOULD be in per the config (null if no stages).
export function expectedStage(stages: readonly StageDef[], age: number): StageDef | null {
  const s = ordered(stages);
  if (!s.length) return null;
  let cur = s[0];
  for (const st of s) { if (age >= st.startDay) cur = st; else break; }
  return cur;
}

// Given the batch's CURRENT (farmer-set) stage and its age, whether it's due to move on.
export function dueToAdvance(stages: readonly StageDef[], currentStageName: string | null | undefined, age: number): DueInfo {
  const s = ordered(stages);
  const idx = s.findIndex((st) => st.name === currentStageName);
  if (idx < 0 || idx >= s.length - 1) return { due: false, nextStage: null, daysRemaining: 0, overdueDays: 0 };
  const next = s[idx + 1];
  return {
    due: age >= next.startDay,
    nextStage: next.name,
    daysRemaining: Math.max(0, next.startDay - age),
    overdueDays: Math.max(0, age - next.startDay),
  };
}
