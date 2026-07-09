import { db } from '@/db';
import { platformSettings } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { audit, actorLabel } from '@/lib/server/audit';
import { ok, unauthorized, forbidden } from '@/lib/server/http';
import { readRateLimited, writeRateLimited } from '@/lib/server/rateLimit';

const DEFAULTS = { id: 'global', appName: 'IFMS', tagline: 'Integrated Farm Management System', logoUrl: null as string | null };

export async function getSettings() {
  const [s] = await db.select().from(platformSettings).where(eq(platformSettings.id, 'global')).limit(1);
  return s ?? DEFAULTS;
}

// GET — current platform branding (super_admin).
export async function GET(req: Request) {
  const limited = readRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const s = await getSettings();
  return ok({ appName: s.appName, tagline: s.tagline, logoUrl: s.logoUrl });
}

// PATCH { appName?, tagline?, logoUrl? } — rebrand the whole platform (super_admin).
export async function PATCH(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();
  const body = (await req.json().catch(() => ({}))) as { appName?: string; tagline?: string; logoUrl?: string | null };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.appName === 'string' && body.appName.trim()) patch.appName = body.appName.trim();
  if (typeof body.tagline === 'string') patch.tagline = body.tagline.trim();
  if (body.logoUrl === null || typeof body.logoUrl === 'string') patch.logoUrl = body.logoUrl || null;

  await db.insert(platformSettings).values({ ...DEFAULTS, ...patch })
    .onConflictDoUpdate({ target: platformSettings.id, set: patch });
  await audit({ tenantId: 'platform', actor: actorLabel(session), action: 'branding.update', meta: { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') } });
  return ok({ ok: true });
}
