import { db } from '@/db';
import { photos } from '@/db/schemas';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/server/session';

// GET /api/photos/<id> — serves a worker-captured photo (tenant-scoped, non-worker roles).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (session.role === 'worker') return new Response('forbidden', { status: 403 });
  const { id } = await ctx.params;

  const [photo] = await db.select().from(photos)
    .where(and(eq(photos.tenantId, session.tenantId), eq(photos.id, id))).limit(1);
  if (!photo) return new Response('not found', { status: 404 });

  const m = photo.data.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!m) return new Response('unsupported', { status: 415 });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { 'content-type': m[1], 'cache-control': 'private, max-age=3600' } });
}
