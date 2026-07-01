import { describe, it, expect } from 'vitest';
import { ageDays, expectedStage, dueToAdvance, defaultStages, STAGE_TEMPLATES, type StageDef } from '@/lib/lifecycle';

const broiler: StageDef[] = STAGE_TEMPLATES.broilers; // Brooding 0, Grower 14, Finisher 28, Ready 42
const DAY = 86400000;

describe('ageDays', () => {
  it('counts whole days since acquired', () => {
    const now = Date.UTC(2026, 0, 31);
    expect(ageDays('2026-01-01', 0, now)).toBe(30);
  });
  it('adds the age the batch already was on arrival', () => {
    const now = Date.UTC(2026, 0, 11);
    expect(ageDays('2026-01-01', 100, now)).toBe(110); // 10 days on farm + 100 at acquire
  });
  it('never negative; bad date falls back to ageAtAcquire', () => {
    expect(ageDays('2099-01-01', 0, Date.UTC(2026, 0, 1))).toBe(0);
    expect(ageDays('not-a-date', 7)).toBe(7);
  });
});

describe('expectedStage', () => {
  it('picks the stage whose window contains the age', () => {
    expect(expectedStage(broiler, 0)?.name).toBe('Brooding');
    expect(expectedStage(broiler, 13)?.name).toBe('Brooding');
    expect(expectedStage(broiler, 14)?.name).toBe('Grower');
    expect(expectedStage(broiler, 41)?.name).toBe('Finisher');
    expect(expectedStage(broiler, 60)?.name).toBe('Ready to sell');
  });
  it('is order-independent and null for no stages', () => {
    const shuffled = [...broiler].reverse();
    expect(expectedStage(shuffled, 30)?.name).toBe('Finisher');
    expect(expectedStage([], 30)).toBeNull();
  });
});

describe('dueToAdvance', () => {
  it('reports days remaining before the next phase', () => {
    const d = dueToAdvance(broiler, 'Brooding', 10);
    expect(d).toEqual({ due: false, nextStage: 'Grower', daysRemaining: 4, overdueDays: 0 });
  });
  it('is due exactly on the next stage start', () => {
    const d = dueToAdvance(broiler, 'Brooding', 14);
    expect(d.due).toBe(true);
    expect(d.nextStage).toBe('Grower');
    expect(d.daysRemaining).toBe(0);
  });
  it('reports overdue days past the boundary', () => {
    const d = dueToAdvance(broiler, 'Grower', 40); // Finisher starts at 28
    expect(d).toEqual({ due: true, nextStage: 'Finisher', daysRemaining: 0, overdueDays: 12 });
  });
  it('the last stage has nothing to advance to', () => {
    expect(dueToAdvance(broiler, 'Ready to sell', 90)).toEqual({ due: false, nextStage: null, daysRemaining: 0, overdueDays: 0 });
  });
  it('an unknown current stage never claims due', () => {
    expect(dueToAdvance(broiler, 'Nonsense', 100).due).toBe(false);
  });
});

describe('defaultStages', () => {
  it('returns a mutable copy per enterprise, empty for unknown', () => {
    const s = defaultStages('layers');
    expect(s[0].name).toBe('Brooding');
    s[0].name = 'X'; // must not mutate the template
    expect(STAGE_TEMPLATES.layers[0].name).toBe('Brooding');
    expect(defaultStages('unicorns')).toEqual([]);
    expect(defaultStages(null)).toEqual([]);
  });
  it('every template is strictly increasing in startDay and starts at 0', () => {
    for (const [, stages] of Object.entries(STAGE_TEMPLATES)) {
      expect(stages[0].startDay).toBe(0);
      for (let i = 1; i < stages.length; i++) expect(stages[i].startDay).toBeGreaterThan(stages[i - 1].startDay);
    }
  });
});
