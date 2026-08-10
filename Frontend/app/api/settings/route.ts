import { getSettings } from '@/app/api/admin/settings/route';
import { ok } from '@/lib/server/http';
import { getSession } from '@/lib/server/session';
import { db } from '@/db';
import { tenants } from '@/db/schemas';
import { eq } from 'drizzle-orm';

// Public branding (app name, tagline, logo) — used by the login page and shells.
// No auth required: this stays functional for signed-out visitors (e.g. the login
// page before anyone is signed in). When a session exists, we also resolve the
// signed-in user's tenant name so each farm can see its own name instead of the
// generic platform appName — see lib/useBranding.ts for how it's applied.
export async function GET() {
  const s = await getSettings();
  let tenantName: string | null = null;
  const session = await getSession();
  if (session) {
    const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    tenantName = tenant?.name ?? null;
  }
  return ok({ appName: s.appName, tagline: s.tagline, logoUrl: s.logoUrl, tenantName });
}
