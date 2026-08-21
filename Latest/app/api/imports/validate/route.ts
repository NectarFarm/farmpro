import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { batches, farms } from '@/db/schemas'
import { getSessionUser } from '@/lib/auth'
import { isValidPhone, normalizePhone } from '@/lib/validation'

// ── CSV import validation (server-authoritative) ────────────────────────────
// The import preview used to validate rows in the browser against STATIC MOCK
// ARRAYS in components/farm/data.ts — EMPLOYEES_DATA / BATCHES_DATA /
// TASKS_DATA. Two things were wrong with that:
//
//   1. It checked references against fixtures, not the tenant's real rows, so
//      a farmer uploading their own batch codes (LYR-2401, ...) had every row
//      rejected, while codes that exist only in the fixtures passed.
//   2. It validated concepts the database does not have. `employees` and
//      `tasks` have no `code` column at all, so "Employee code is required"
//      demanded a value with nowhere to go.
//
// Validation now happens here, against the caller's own data, and the client
// renders what this returns. Cheap format checks may still run in the browser
// for instant feedback while typing, but this endpoint is the authority.
//
// Note this is preview validation. The actual writes (POST /api/employees,
// POST /api/purchases) validate independently — a caller that skips the
// preview is still checked.

const bad = (msg: string, status = 400) =>
  NextResponse.json({ success: false, error: msg }, { status })

type Severity = 'error' | 'warning' | 'info'
interface CellIssue {
  col: string
  severity: Severity
  message: string
  suggestion?: string
  autoFix?: boolean
}

const IMPORT_ENTITIES = new Set(['employees', 'inventory'])

// Roles the app actually recognises for a farm worker record. `employees.role`
// is free text in the schema (same loose-text convention as users.role), so
// this list is the app's, not the database's — an unknown value is a warning,
// not a hard error, because a tenant may legitimately use its own job titles.
const KNOWN_EMPLOYEE_ROLES = ['worker', 'supervisor', 'manager', 'vet', 'driver', 'storekeeper']

const str = (row: Record<string, unknown>, col: string): string =>
  typeof row[col] === 'string' ? (row[col] as string).trim() : ''

function validateEmployeeRow(
  row: Record<string, unknown>,
  index: number,
  all: Record<string, unknown>[],
  batchCodes: Set<string>,
  farmCodes: Set<string>,
): CellIssue[] {
  const issues: CellIssue[] = []
  const name = str(row, 'name')

  if (!name) {
    issues.push({ col: 'name', severity: 'error', message: 'Name is required' })
  } else if (name.length < 2) {
    issues.push({ col: 'name', severity: 'warning', message: 'Name looks too short — is it complete?' })
  }

  // Duplicate NAME within the upload. Employees have no code column, so the
  // name is the only human identifier a CSV can carry.
  if (name && all.some((r, i) => i !== index && str(r, 'name').toLowerCase() === name.toLowerCase())) {
    issues.push({ col: 'name', severity: 'warning', message: 'This name appears more than once in the file — two records will be created' })
  }

  const role = str(row, 'role')
  if (role && !KNOWN_EMPLOYEE_ROLES.includes(role.toLowerCase())) {
    issues.push({
      col: 'role', severity: 'warning',
      message: `"${role}" is not one of the usual roles (${KNOWN_EMPLOYEE_ROLES.join(', ')}) — it will be saved as typed`,
    })
  }

  const phone = str(row, 'phone')
  if (phone && !isValidPhone(normalizePhone(phone))) {
    issues.push({
      col: 'phone', severity: 'error',
      message: 'Enter a valid phone (+2547XXXXXXXX or 07XXXXXXXX). A worker cannot sign in without one.',
    })
  }

  // Batch codes are checked against the tenant's REAL batches.
  const batchField = str(row, 'batches')
  if (batchField) {
    for (const code of batchField.split('|').map(c => c.trim()).filter(Boolean)) {
      if (!batchCodes.has(code)) {
        issues.push({ col: 'batches', severity: 'error', message: `No batch "${code}" on this farm — it will not be assigned` })
      }
    }
  }

  const farmCode = str(row, 'farmCode')
  if (farmCode && !farmCodes.has(farmCode)) {
    issues.push({ col: 'farmCode', severity: 'error', message: `No farm with code "${farmCode}"` })
  }

  const active = str(row, 'active').toLowerCase()
  if (active && !['true', 'false', 'yes', 'no', ''].includes(active)) {
    issues.push({ col: 'active', severity: 'warning', message: 'Use true or false — anything else is treated as active', suggestion: 'true', autoFix: true })
  }

  return issues
}

function validateInventoryRow(row: Record<string, unknown>, index: number, all: Record<string, unknown>[]): CellIssue[] {
  const issues: CellIssue[] = []

  if (!str(row, 'name')) issues.push({ col: 'name', severity: 'error', message: 'Item name is required' })
  if (!str(row, 'unit')) issues.push({ col: 'unit', severity: 'error', message: 'Unit is required (kg, litre, dose, ...)' })

  const qty = Number(str(row, 'qty'))
  if (!str(row, 'qty')) {
    issues.push({ col: 'qty', severity: 'error', message: 'Quantity is required' })
  } else if (!Number.isFinite(qty) || qty <= 0) {
    issues.push({ col: 'qty', severity: 'error', message: 'Quantity must be a number greater than zero' })
  } else if (!Number.isInteger(qty)) {
    issues.push({ col: 'qty', severity: 'warning', message: 'Quantity is stored whole — this will be truncated', suggestion: String(Math.trunc(qty)), autoFix: true })
  }

  const cost = str(row, 'costPerUnit')
  if (cost && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) {
    issues.push({ col: 'costPerUnit', severity: 'error', message: 'Cost per unit must be a number of 0 or more' })
  }

  const reorder = str(row, 'reorder')
  if (reorder && (!Number.isFinite(Number(reorder)) || Number(reorder) < 0)) {
    issues.push({ col: 'reorder', severity: 'error', message: 'Reorder level must be a number of 0 or more' })
  }

  const expiry = str(row, 'expiryDate')
  if (expiry && Number.isNaN(new Date(expiry).getTime())) {
    issues.push({ col: 'expiryDate', severity: 'error', message: 'Not a date we can read — use YYYY-MM-DD' })
  }

  const lot = str(row, 'lotNumber')
  if (lot && all.some((r, i) => i !== index && str(r, 'lotNumber') === lot)) {
    issues.push({ col: 'lotNumber', severity: 'warning', message: 'This lot number appears more than once in the file' })
  }

  return issues
}

// POST /api/imports/validate — { entity, rows } -> per-row issues.
export async function POST(req: Request) {
  const session = await getSessionUser()
  if (!session) return bad('Unauthorized', 401)
  // Tenant comes from the session only. Never from the body: this reads the
  // caller's batches and farms, so a body-supplied tenant would leak them.
  const tenantId = session.tenantId
  if (!tenantId) return bad('This account is not scoped to a farm tenant', 403)

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return bad('Invalid JSON body')
  }
  const body = (raw ?? {}) as Record<string, unknown>
  const entity = typeof body.entity === 'string' ? body.entity : ''
  if (!IMPORT_ENTITIES.has(entity)) {
    return NextResponse.json(
      { success: false, error: `entity must be one of: ${Array.from(IMPORT_ENTITIES).join(', ')}`, fields: { entity: 'Unsupported import type' } },
      { status: 400 },
    )
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ success: false, error: 'rows must be an array', fields: { rows: 'rows must be an array' } }, { status: 400 })
  }
  // Bound the work: a preview is interactive, and an unbounded array here is
  // an easy way to tie up a request thread.
  if (body.rows.length > 2000) {
    return NextResponse.json({ success: false, error: 'Too many rows — split the file into batches of 2000 or fewer', fields: { rows: 'At most 2000 rows per file' } }, { status: 400 })
  }
  const rows = body.rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')

  let batchCodes = new Set<string>()
  let farmCodes = new Set<string>()
  if (entity === 'employees') {
    const [batchRows, farmRows] = await Promise.all([
      db.select({ code: batches.code }).from(batches).where(eq(batches.tenantId, tenantId)),
      db.select({ code: farms.code }).from(farms).where(eq(farms.tenantId, tenantId)),
    ])
    batchCodes = new Set(batchRows.map(b => b.code))
    farmCodes = new Set(farmRows.map(f => f.code))
  }

  const results = rows.map((row, index) => ({
    index,
    issues: entity === 'employees'
      ? validateEmployeeRow(row, index, rows, batchCodes, farmCodes)
      : validateInventoryRow(row, index, rows),
  }))

  return NextResponse.json({
    success: true,
    data: {
      rows: results,
      errorCount: results.reduce((n, r) => n + r.issues.filter(i => i.severity === 'error').length, 0),
    },
  }, { status: 200 })
}
