import { db } from '@/db';
import { errorLogs } from '@/db/schemas';
import { getSession } from '@/lib/server/session';
import { ok, badRequest } from '@/lib/server/http';
import { parseBody, zNonEmpty } from '@/lib/server/validate';
import { writeRateLimited } from '@/lib/server/rateLimit';
import { z } from 'zod';

const errorSchema = z.object({
  context: zNonEmpty.max(200),
  severity: z.enum(['error', 'warning', 'info']).default('error'),
  message: zNonEmpty.max(2000),
  digest: z.string().max(200).optional(),
  stack: z.string().max(4000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(500).optional(),
});

// POST /api/errors — client-side crash reports from the error.tsx boundaries.
// Deliberately lenient on auth: a broken/expired session is exactly one of
// the situations this needs to keep working in, so it never requires one —
// only IP rate-limited to keep it from being an open write sink.
export async function POST(req: Request) {
  const limited = writeRateLimited(req);
  if (limited) return limited;

  const parsed = await parseBody(req, errorSchema);
  if ('error' in parsed) return parsed.error;
  const { context, severity, message, digest, stack, url, userAgent } = parsed.data;

  const session = await getSession();

  try {
    await db.insert(errorLogs).values({
      id: crypto.randomUUID(),
      tenantId: session?.tenantId ?? null,
      userId: session?.userId ?? null,
      context,
      severity,
      message,
      digest: digest ?? null,
      stack: stack ?? null,
      url: url ?? null,
      userAgent: userAgent ?? null,
    });
  } catch {
    // Never let a broken error-reporting pipeline surface its own error to the client.
  }

  return ok({ success: true });
}

export async function GET() {
  return badRequest('Use POST to report an error.');
}
