import { describe, it, expect } from 'vitest';
import { PLANS, ALL_FEATURE_KEYS, FEATURES } from '@/lib/features';

describe('subscription plans', () => {
  it('pro unlocks every feature', () => {
    expect([...PLANS.pro].sort()).toEqual([...ALL_FEATURE_KEYS].sort());
  });
  it('free is a strict subset of standard, standard a subset of pro', () => {
    expect(PLANS.free.every((f) => PLANS.standard.includes(f))).toBe(true);
    expect(PLANS.standard.every((f) => PLANS.pro.includes(f))).toBe(true);
    expect(PLANS.free.length).toBeLessThan(PLANS.pro.length);
  });
  it('every plan only references real feature keys', () => {
    const keys = new Set(FEATURES.map((f) => f.key));
    for (const plan of Object.values(PLANS)) for (const f of plan) expect(keys.has(f)).toBe(true);
  });
});
