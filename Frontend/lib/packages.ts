// Pure package (plan) logic — no DB — so validation is unit-testable. A package is
// a named bundle of feature keys + a price; the admin edits these and assigns one
// to each farm (which copies its features onto the tenant). Defaults mirror the
// built-in free/standard/pro so behaviour is unchanged until the admin edits them.
import { PLANS } from './features';

export interface Package { id: string; name: string; features: string[]; price: number }

export const DEFAULT_PACKAGES: Package[] = Object.entries(PLANS).map(([id, features]) => ({
  id, name: id.charAt(0).toUpperCase() + id.slice(1), features: [...features], price: 0,
}));

export function slugifyPkg(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'plan';
}

// Validate & clean an admin-edited package list: each needs a name; ids are derived
// & de-duplicated; features are restricted to known keys; price is a non-negative
// number. Throws a user-facing message on the first invalid row.
export function normalizePackages(raw: ReadonlyArray<Partial<Package>>, validFeatureKeys: readonly string[]): Package[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Add at least one package.');
  const valid = new Set(validFeatureKeys);
  const seen = new Set<string>();
  return raw.map((p, i) => {
    const name = (p.name ?? '').trim();
    if (!name) throw new Error(`Package ${i + 1} needs a name.`);
    const base = p.id && p.id.trim() ? slugifyPkg(p.id) : slugifyPkg(name);
    let id = base;
    for (let n = 2; seen.has(id); n++) id = `${base}_${n}`;
    seen.add(id);
    const features = Array.isArray(p.features)
      ? [...new Set((p.features as unknown[]).filter((f): f is string => typeof f === 'string' && valid.has(f)))]
      : [];
    const price = Math.max(0, Math.round((Number(p.price) || 0) * 100) / 100);
    return { id, name, features, price };
  });
}

// The features a package id unlocks (empty if the package no longer exists).
export function packageFeatures(packages: readonly Package[], id: string): string[] {
  return packages.find((p) => p.id === id)?.features.slice() ?? [];
}
