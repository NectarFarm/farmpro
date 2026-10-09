// Turns a run body into the payslips that will be stored. Shared by the
// preview and the save so the two cannot drift. Does not write.
import 'server-only'
import { and, eq, gt, inArray, lt } from 'drizzle-orm'
import { db } from '@/db'
import { employees, payrollRuns, payslips, statutoryRates } from '@/db/schemas'
import {
  computePayroll, isStatutoryCode,
  type BracketBand, type ExtraLine, type PayrollFigures, type PersonInput, type StatutoryRate,
} from '@/lib/payroll-calc'

const EXTRA = new Set(['allowance', 'bonus', 'advance', 'loan_repayment'])

export interface PreparedEmployee {
  id: string
  name: string
  farmId: string | null
  input: PersonInput
}

export interface PreparedPayroll {
  figures: PayrollFigures
  employees: PreparedEmployee[]
  farmId: string | null
  statutoryNote: string | null
}

function parseBrackets(raw: string | null): BracketBand[] | null | 'bad' {
  if (raw == null || raw === '') return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return 'bad' }
  if (!Array.isArray(parsed)) return 'bad'
  const bands: BracketBand[] = []
  for (const band of parsed) {
    if (!band || typeof band !== 'object') return 'bad'
    const row = band as Record<string, unknown>
    const upTo = row.upToCents
    if (upTo != null && (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo <= 0)) return 'bad'
    if (typeof row.rateBps !== 'number' || !Number.isInteger(row.rateBps) || row.rateBps < 0 || row.rateBps > 10000) return 'bad'
    bands.push({ upToCents: upTo == null ? null : upTo, rateBps: row.rateBps })
  }
  return bands
}

export async function loadStatutoryRates(): Promise<StatutoryRate[] | { refused: string }> {
  const rows = await db.select().from(statutoryRates)
  const rates: StatutoryRate[] = []
  for (const row of rows) {
    if (!isStatutoryCode(row.code)) return { refused: 'A statutory rate could not be read.' }
    if (row.payer !== 'employee' && row.payer !== 'employer') return { refused: 'A statutory rate could not be read.' }
    if (row.kind !== 'percent' && row.kind !== 'bracket' && row.kind !== 'fixed') return { refused: 'A statutory rate could not be read.' }
    const brackets = parseBrackets(row.brackets)
    if (brackets === 'bad') return { refused: 'A statutory rate could not be read.' }
    rates.push({
      code: row.code,
      payer: row.payer,
      kind: row.kind,
      rateBps: row.rateBps,
      amountCents: row.amountCents,
      reducesPayeBase: row.reducesPayeBase,
      brackets,
      ceilingCents: row.ceilingCents,
      floorCents: row.floorCents,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    })
  }
  return rates
}

function whole(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value
}

export async function preparePayroll(input: {
  tenantId: string
  periodStart: Date
  periodEnd: Date
  employees: unknown
}): Promise<PreparedPayroll | { refused: string }> {
  if (!Array.isArray(input.employees) || input.employees.length === 0) {
    return { refused: 'Say who is being paid. The run no longer includes everyone active.' }
  }
  const requested: PreparedEmployee[] = []
  const seen = new Set<string>()
  for (const raw of input.employees) {
    if (!raw || typeof raw !== 'object') return { refused: 'Each person needs an employeeId.' }
    const row = raw as Record<string, unknown>
    const employeeId = typeof row.employeeId === 'string' ? row.employeeId.trim() : ''
    if (!employeeId) return { refused: 'Each person needs an employeeId.' }
    if (seen.has(employeeId)) return { refused: 'An employee is listed twice.' }
    seen.add(employeeId)

    const casual = row.daysWorked !== undefined || row.dailyRateCents !== undefined
    let daysWorked: number | null = null
    let dailyRateCents: number | null = null
    let overtimeHours: number | null = null
    let overtimeRateCents: number | null = null
    if (casual) {
      daysWorked = whole(row.daysWorked)
      dailyRateCents = whole(row.dailyRateCents)
      if (daysWorked == null || daysWorked < 0) return { refused: 'Days worked must be a whole number, zero or more.' }
      if (dailyRateCents == null || dailyRateCents < 0) return { refused: 'The daily rate must be a whole number of cents, zero or more.' }
      const hasHours = row.overtimeHours !== undefined && row.overtimeHours !== null && row.overtimeHours !== ''
      const hasRate = row.overtimeRateCents !== undefined && row.overtimeRateCents !== null && row.overtimeRateCents !== ''
      if (hasHours !== hasRate) return { refused: 'Overtime needs both the hours and the rate.' }
      if (hasHours) {
        if (typeof row.overtimeHours !== 'number' || !Number.isFinite(row.overtimeHours) || row.overtimeHours < 0) {
          return { refused: 'Overtime hours must be a number, zero or more.' }
        }
        overtimeRateCents = whole(row.overtimeRateCents)
        if (overtimeRateCents == null || overtimeRateCents < 0) return { refused: 'The overtime rate must be a whole number of cents, zero or more.' }
        overtimeHours = row.overtimeHours
      }
    }

    const lines: ExtraLine[] = []
    if (row.lines !== undefined) {
      if (!Array.isArray(row.lines)) return { refused: 'Payslip lines must be a list.' }
      for (const item of row.lines) {
        if (!item || typeof item !== 'object') return { refused: 'A payslip line could not be read.' }
        const line = item as Record<string, unknown>
        const kind = typeof line.kind === 'string' ? line.kind : ''
        if (!EXTRA.has(kind)) return { refused: 'A payslip line must be an allowance, bonus, advance or loan repayment.' }
        const label = typeof line.label === 'string' ? line.label.trim() : ''
        if (!label) return { refused: 'A payslip line needs a label.' }
        const amountCents = whole(line.amountCents)
        if (amountCents == null || amountCents <= 0) return { refused: 'A payslip line amount must be a positive number of cents.' }
        lines.push({ kind: kind as ExtraLine['kind'], label, amountCents })
      }
    }

    const [employee] = await db.select({
      id: employees.id,
      name: employees.name,
      monthlySalaryCents: employees.monthlySalaryCents,
      farmId: employees.farmId,
      status: employees.status,
    }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, input.tenantId)))
    if (!employee || employee.status !== 'ACTIVE') return { refused: 'That employee is not active on this business.' }
    if (!casual && employee.monthlySalaryCents <= 0) {
      return { refused: `${employee.name} has no monthly salary and no daily rate, so this run does not pay them.` }
    }
    requested.push({
      id: employee.id,
      name: employee.name,
      farmId: employee.farmId,
      input: {
        monthlySalaryCents: employee.monthlySalaryCents,
        daysWorked,
        dailyRateCents,
        overtimeHours,
        overtimeRateCents,
        lines,
      },
    })
  }

  const clashes = await db.select({
    name: payslips.employeeName,
    periodStart: payrollRuns.periodStart,
    periodEnd: payrollRuns.periodEnd,
  }).from(payslips).innerJoin(payrollRuns, eq(payslips.runId, payrollRuns.id)).where(and(
    eq(payslips.tenantId, input.tenantId),
    inArray(payslips.employeeId, requested.map((person) => person.id)),
    lt(payrollRuns.periodStart, input.periodEnd),
    gt(payrollRuns.periodEnd, input.periodStart),
  )).limit(1)
  if (clashes.length > 0) {
    const clash = clashes[0]
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    return {
      refused: `${clash.name} has already been included for ${iso(clash.periodStart)} to ${iso(clash.periodEnd)}, which overlaps this period — those days would be paid twice.`,
    }
  }

  const rates = await loadStatutoryRates()
  if ('refused' in rates) return rates
  const asOf = input.periodEnd.toISOString().slice(0, 10)
  const figures = computePayroll(requested.map((person) => person.input), asOf, rates)
  if ('refused' in figures) return figures
  const firstFarm = requested[0]?.farmId ?? null
  const farmId = firstFarm && requested.every((person) => person.farmId === firstFarm) ? firstFarm : null
  return {
    figures,
    employees: requested,
    farmId,
    statutoryNote: figures.unconfigured.length > 0 ? figures.unconfigured.join(' ') : null,
  }
}
