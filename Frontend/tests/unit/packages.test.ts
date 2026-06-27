import { describe, it, expect } from 'vitest';
import { DEFAULT_PACKAGES, normalizePackages, packageFeatures, slugifyPkg } from '@/lib/packages';
import { ALL_FEATURE_KEYS } from '@/lib/features';

describe('DEFAULT_PACKAGES', () => {
  it('mirrors the built-in plans (free/standard/pro)', () => {
    const ids = DEFAULT_PACKAGES.map((p) => p.id);
    expect(ids).toEqual(['free', 'standard', 'pro']);
    expect(DEFAULT_PACKAGES.find((p) => p.id === 'pro')!.features).toEqual(ALL_FEATURE_KEYS);
  });
});

describe('slugifyPkg', () => {
  it('makes a safe id and never returns empty', () => {
    expect(slugifyPkg('Pro Plus!')).toBe('pro_plus');
    expect(slugifyPkg('—')).toBe('plan');
  });
});

describe('normalizePackages', () => {
  it('derives ids, restricts features to known keys, and floors price at 0', () => {
    const out = normalizePackages([
      { name: 'Starter', features: ['finance', 'reports', 'bogus'], price: -5 },
    ], ALL_FEATURE_KEYS);
    expect(out).toEqual([{ id: 'starter', name: 'Starter', features: ['finance', 'reports'], price: 0 }]);
  });

  it('de-duplicates colliding ids and feature keys', () => {
    const out = normalizePackages([
      { name: 'Gold', features: ['finance', 'finance'] },
      { name: 'Gold' },
    ], ALL_FEATURE_KEYS);
    expect(out.map((p) => p.id)).toEqual(['gold', 'gold_2']);
    expect(out[0].features).toEqual(['finance']);
  });

  it('keeps the price (rounded to cents)', () => {
    expect(normalizePackages([{ name: 'P', price: 1500.005 }], ALL_FEATURE_KEYS)[0].price).toBe(1500.01);
  });

  it('rejects an empty list or a nameless package', () => {
    expect(() => normalizePackages([], ALL_FEATURE_KEYS)).toThrow(/at least one/i);
    expect(() => normalizePackages([{ name: '' }], ALL_FEATURE_KEYS)).toThrow(/needs a name/i);
  });
});

describe('packageFeatures', () => {
  it('returns a package\'s features, or [] for an unknown id', () => {
    const pkgs = [{ id: 'a', name: 'A', features: ['finance'], price: 0 }];
    expect(packageFeatures(pkgs, 'a')).toEqual(['finance']);
    expect(packageFeatures(pkgs, 'nope')).toEqual([]);
  });
});
