'use client';
import { useEffect, useState } from 'react';

export interface Branding { appName: string; tagline: string; logoUrl: string | null }
const DEFAULT: Branding = { appName: 'IFMS', tagline: 'Integrated Farm Management System', logoUrl: null };
let cache: Branding | null = null;

// Reads the platform branding (app name / tagline / logo) the super-admin set.
// Cached per page load so it's fetched once and shared across components.
export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cache ?? DEFAULT);
  useEffect(() => {
    if (cache) return;
    fetch('/api/settings').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.appName) { cache = { appName: d.appName, tagline: d.tagline ?? DEFAULT.tagline, logoUrl: d.logoUrl ?? null }; setB(cache); }
    }).catch(() => {});
  }, []);
  return b;
}
