import { getSession } from '@/lib/server/session';
import { issueAuditorLink, revokeAuditorLink, listAuditorLinks } from '@/lib/server/auditorLinks';
import { ok, unauthorized, forbidden, badRequest } from '@/lib/server/http';
import { parseBody, auditorLinkSchema } from '@/lib/server/validate';

// POST /api/auditor-link  { email?, days? } — owner generates an expiring read-only link (max 14 days).
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();

  const parsed = await parseBody(req, auditorLinkSchema);
  if ('error' in parsed) return parsed.error;
  const { email, days } = parsed.data;
  const origin = new URL(req.url).origin;
  const issued = await issueAuditorLink({
    tenantId: session.tenantId,
    createdBy: session.userId,
    email: typeof email === 'string' ? email : undefined,
    days,
    origin,
  });
  return ok(issued);
}

// GET /api/auditor-link — list links for this tenant (owner).
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();
  const links = await listAuditorLinks(session.tenantId);
  return ok(links);
}

// DELETE /api/auditor-link?id=... — revoke a link.
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (session.role !== 'owner') return forbidden();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return badRequest('id required');
  const revoked = await revokeAuditorLink(session.tenantId, id);
  if (!revoked) return badRequest('Link not found or already revoked.');
  return ok({ id, revoked: true });
}
