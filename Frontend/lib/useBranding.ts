'use client';
import { useEffect, useState } from 'react';

export interface Branding { appName: string; tagline: string; logoUrl: string | null; tenantName: string | null }
const DEFAULT: Branding = { appName: 'IFMS', tagline: 'Integrated Farm Management System', logoUrl: null, tenantName: null };
let cache: Branding | null = null;

// Reads the platform branding (app name / tagline / logo) the super-admin set.
// When the visitor is signed in, /api/settings also resolves their tenant's name —
// in that case `appName` becomes the farm's own name (e.g. "Nectar Farm") so every
// existing call site that reads brand.appName shows the real farm name for free.
// Pre-login (no session), tenantName is null and appName stays the platform default.
// `tenantName` is also exposed raw for callers that need the farm name specifically.
// Cached per page load so it's fetched once and shared across components.
export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cache ?? DEFAULT);
  useEffect(() => {
    if (cache) return;
    fetch('/api/settings').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.appName) {
        const tenantName: string | null = d.tenantName || null;
        cache = { appName: tenantName || d.appName, tagline: d.tagline ?? DEFAULT.tagline, logoUrl: d.logoUrl ?? null, tenantName };
        setB(cache);
      }
    }).catch(() => {});
  }, []);
  return b;
}
