import { getSettings } from '@/app/api/admin/settings/route';
import { ok } from '@/lib/server/http';

// Public branding (app name, tagline, logo) — used by the login page and shells.
// No auth: this is just the visible brand, not sensitive.
export async function GET() {
  const s = await getSettings();
  return ok({ appName: s.appName, tagline: s.tagline, logoUrl: s.logoUrl });
}
