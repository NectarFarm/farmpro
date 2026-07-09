import { describe, it, expect } from 'vitest';
import { slugifyPkg, normalizePackages, packageFeatures, DEFAULT_PACKAGES, type Package } from '@/lib/packages';

const ALL_KEYS = ['setup_guide', 'ai_advisor', 'reports', 'activity_log', 'alerts', 'finance'];

describe('slugifyPkg', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(slugifyPkg('Pro Plan')).toBe('pro_plan');
    expect(slugifyPkg('Basic!@#')).toBe('basic');
    expect(slugifyPkg('  Spaces  ')).toBe('spaces');
  });

  it('returns "plan" for empty or all-punctuation input', () => {
    expect(slugifyPkg('')).toBe('plan');
    expect(slugifyPkg('   ')).toBe('plan');
    expect(slugifyPkg('!@#$')).toBe('plan');
  });
});

describe('normalizePackages', () => {
  it('returns valid packages from minimal input', () => {
    const out = normalizePackages([{ name: 'Basic', features: ['finance'] }], ALL_KEYS);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Basic');
    expect(out[0].id).toBe('basic');
    expect(out[0].features).toEqual(['finance']);
    expect(out[0].price).toBe(0);
  });

  it('filters out unknown feature keys', () => {
    const out = normalizePackages([{ name: 'Test', features: ['finance', 'nonexistent', '', 'alerts'] }], ALL_KEYS);
    expect(out[0].features).toEqual(['finance', 'alerts']);
  });

  it('de-duplicates features within a package', () => {
    const out = normalizePackages([{ name: 'Dup', features: ['finance', 'alerts', 'finance'] }], ALL_KEYS);
    expect(out[0].features).toEqual(['finance', 'alerts']);
  });

  it('derives unique ids when names collide', () => {
    const out = normalizePackages([{ name: 'Same' }, { name: 'Same' }], ALL_KEYS);
    expect(out[0].id).toBe('same');
    expect(out[1].id).toBe('same_2');
  });

  it('rejects empty input', () => {
    expect(() => normalizePackages([], ALL_KEYS)).toThrow(/at least one package/i);
    expect(() => normalizePackages([], ALL_KEYS)).toThrow();
  });

  it('throws when a package has no name', () => {
    expect(() => normalizePackages([{ name: '' }], ALL_KEYS)).toThrow(/needs a name/i);
  });

  it('clamps price to non-negative and rounds to 2 decimal places', () => {
    const out = normalizePackages([{ name: 'Paid', price: 19.999 }], ALL_KEYS);
    expect(out[0].price).toBe(20);
    const neg = normalizePackages([{ name: 'Free', price: -5 }], ALL_KEYS);
    expect(neg[0].price).toBe(0);
  });

  it('respects an explicit id rather than deriving from name', () => {
    const out = normalizePackages([{ name: 'Full Access', id: 'premium-v2', features: ALL_KEYS }], ALL_KEYS);
    expect(out[0].id).toBe('premium_v2');
  });

  it('slugifies the id separately from the name', () => {
    const out = normalizePackages([{ name: 'Basic', id: '  Starter  ', features: [] }], ALL_KEYS);
    expect(out[0].id).toBe('starter');
  });

  it('handles an array with only partial objects', () => {
    const out = normalizePackages([{ name: 'Mini', features: undefined } as Partial<Package>], ALL_KEYS);
    expect(out[0].features).toEqual([]);
  });

  it('handles non-array features (safe fallback)', () => {
    const out = normalizePackages([{ name: 'Bad', features: null as unknown as string[] }], ALL_KEYS);
    expect(out[0].features).toEqual([]);
  });
});

describe('packageFeatures', () => {
  const pkgs: Package[] = [
    { id: 'free', name: 'Free', features: ['finance'], price: 0 },
    { id: 'pro', name: 'Pro', features: ['finance', 'alerts', 'reports'], price: 5000 },
  ];

  it('returns features for an existing package id', () => {
    expect(packageFeatures(pkgs, 'pro')).toEqual(['finance', 'alerts', 'reports']);
  });

  it('returns a COPY (mutating the result does not affect the source)', () => {
    const f = packageFeatures(pkgs, 'free');
    f.push('alerts');
    expect(pkgs[0].features).toEqual(['finance']);
  });

  it('returns empty array for unknown package id', () => {
    expect(packageFeatures(pkgs, 'nonexistent')).toEqual([]);
    expect(packageFeatures(pkgs, '')).toEqual([]);
  });
});

describe('DEFAULT_PACKAGES', () => {
  it('matches the built-in free/standard/pro plans', () => {
    expect(DEFAULT_PACKAGES).toHaveLength(3);
    const free = DEFAULT_PACKAGES.find((p) => p.id === 'free');
    expect(free).toBeDefined();
    expect(free!.features).toContain('finance');
    const pro = DEFAULT_PACKAGES.find((p) => p.id === 'pro');
    expect(pro).toBeDefined();
    expect(pro!.features).toEqual(ALL_KEYS);
  });
});
