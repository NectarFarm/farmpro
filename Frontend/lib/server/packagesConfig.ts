import 'server-only';
import { db } from '@/db';
import { platformSettings } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { DEFAULT_PACKAGES, type Package } from '@/lib/packages';

// Admin-defined packages, or the built-in defaults when none are saved yet.
export async function getActivePackages(): Promise<Package[]> {
  const [row] = await db.select({ p: platformSettings.packages }).from(platformSettings)
    .where(eq(platformSettings.id, 'global')).limit(1);
  const p = row?.p;
  return Array.isArray(p) && p.length > 0 ? p : DEFAULT_PACKAGES;
}

export async function saveActivePackages(packages: Package[]): Promise<void> {
  await db.insert(platformSettings).values({ id: 'global', packages })
    .onConflictDoUpdate({ target: platformSettings.id, set: { packages } });
}
