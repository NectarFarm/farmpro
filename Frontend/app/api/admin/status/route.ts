import { db } from '@/db';
import { auditLog } from '@/db/schemas';
import { sql, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';
import { ok, unauthorized, forbidden } from '@/lib/server/http';

function safeStr(row: unknown, key: string): string {
  return String((row as Record<string, unknown>)[key] ?? '');
}
function safeNum(row: unknown, key: string): number {
  return Number((row as Record<string, unknown>)[key] ?? 0);
}

// GET /api/admin/status — platform health & system info for the admin status page.
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'super_admin') return forbidden();

  // DB health — lightweight ping
  let dbOk = false;
  let dbVersion = '';
  let dbError: string | null = null;
  try {
    const [row] = await db.execute(sql`SELECT version()`);
    dbOk = true;
    dbVersion = safeStr(row, 'version').split(',')[0] ?? '';
  } catch (e) {
    dbError = (e as Error).message;
  }

  // Count recent audit entries (last 7 days)
  let auditCount = 0;
  let errorCount = 0;
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const [countRow] = await db.execute(
      sql`SELECT count(*)::int AS cnt FROM ${sql.raw('audit_log')} WHERE ${sql.raw('at')} >= ${weekAgo}`,
    );
    auditCount = safeNum(countRow, 'cnt');

    const [errRow] = await db.execute(
      sql`SELECT count(*)::int AS cnt FROM ${sql.raw('audit_log')}
          WHERE ${sql.raw('at')} >= ${weekAgo}
            AND (${sql.raw('action')} LIKE '%.delete' OR ${sql.raw('action')} LIKE '%.fail')`,
    );
    errorCount = safeNum(errRow, 'cnt');
  } catch {
    /* best-effort */
  }

  // R2 / object storage
  const r2Configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
  const r2Bucket = process.env.R2_BUCKET_NAME ?? 'ifms-photos';

  // Environment info (safe — no secrets)
  const envInfo = {
    nodeVersion: process.version,
    runtime: typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers' ? 'workerd' : 'node',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    pid: process.pid,
  };

  // Rate limit config
  const rateLimit = {
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 5,
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  };

  // Migration version from journal
  let migrationVersion = 'unknown';
  try {
    const journal = await import('@/drizzle/meta/_journal.json').then(m => m.default ?? m);
    const entries = (journal.entries ?? []) as Array<{ idx: number }>;
    if (entries?.length) {
      migrationVersion = String(entries[entries.length - 1].idx).padStart(4, '0');
    }
  } catch {
    /* best-effort */
  }

  return ok({
    healthy: dbOk,
    database: { ok: dbOk, version: dbVersion, error: dbError },
    storage: { configured: r2Configured, bucket: r2Bucket },
    environment: envInfo,
    rateLimit,
    migrationVersion,
    recentActivity: { auditEntries7d: auditCount, errors7d: errorCount },
    ts: new Date().toISOString(),
  });
}
