import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { postingPolicies } from '@/db/schemas'
import { requireTenantSession } from '@/lib/api-auth'

const ok = <T>(data: T) => NextResponse.json({ success: true, data }, { status: 200 })
const notFound = () => NextResponse.json({ success: false, error: 'That threshold is not on this business.' }, { status: 404 })

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(req.url)
  const auth = await requireTenantSession({
    roles: ['owner', 'super_admin'],
    explicitTenantId: url.searchParams.get('tenantId') ?? undefined,
  })
  if ('error' in auth) return auth.error
  const { id } = await params
  const [row] = await db
    .delete(postingPolicies)
    .where(and(eq(postingPolicies.id, id), eq(postingPolicies.tenantId, auth.tenantId)))
    .returning()
  if (!row) return notFound()
  return ok(row)
}
