import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { reportSnapshots } from '@/db/schemas'
import type { ReportPayload } from '@/lib/report-types'

export type SnapshotStatus = 'GENERATED' | 'ATTESTED' | 'SHARED'

function canonicalPayload(payload: ReportPayload): string {
  return JSON.stringify(payload)
}

export function hashReportPayload(payload: ReportPayload): string {
  return createHash('sha256').update(canonicalPayload(payload)).digest('hex')
}

export function newPublicReportToken(): string {
  return randomBytes(24).toString('base64url')
}

export async function createReportSnapshot(input: {
  tenantId: string; reportType: string; farmId?: string; purpose: string; payload: ReportPayload; createdBy: string;
}) {
  const now = new Date()
  const row = {
    id: randomUUID(), tenantId: input.tenantId, reportType: input.reportType,
    farmId: input.farmId || null, purpose: input.purpose, payload: input.payload,
    payloadHash: hashReportPayload(input.payload), publicToken: newPublicReportToken(),
    createdBy: input.createdBy, createdAt: now,
  }
  await db.insert(reportSnapshots).values(row)
  return row
}

export async function listReportSnapshots(tenantId: string, limit = 20) {
  return db.select().from(reportSnapshots).where(eq(reportSnapshots.tenantId, tenantId)).orderBy(desc(reportSnapshots.createdAt)).limit(limit)
}

export async function attestReportSnapshot(input: { tenantId: string; id: string; name: string; role: string }) {
  const now = new Date()
  const result = await db.update(reportSnapshots)
    .set({ status: 'ATTESTED', attestedBy: input.name, attestedRole: input.role, attestedAt: now })
    .where(and(eq(reportSnapshots.id, input.id), eq(reportSnapshots.tenantId, input.tenantId)))
    .returning()
  return result[0] ?? null
}

export async function getPublicReportSnapshot(token: string) {
  const rows = await db.select().from(reportSnapshots).where(eq(reportSnapshots.publicToken, token)).limit(1)
  return rows[0] ?? null
}
