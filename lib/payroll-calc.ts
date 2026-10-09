// Kenyan payroll arithmetic (issue #420). Integer cents, half-up. Not
// server-only: a test recomputes last year's pay from the rate rows that
// were effective on that date. Nothing here invents a statutory rate.
// A scheme with no row on the date contributes no line.

export const STATUTORY_CODES = ['PAYE', 'NSSF', 'SHIF'] as const
export type StatutoryCode = (typeof STATUTORY_CODES)[number]
export const STATUTORY_PAYERS = ['employee', 'employer'] as const
export type StatutoryPayer = (typeof STATUTORY_PAYERS)[number]
export const STATUTORY_KINDS = ['percent', 'bracket', 'fixed'] as const
export type StatutoryKind = (typeof STATUTORY_KINDS)[number]

export const LINE_KINDS = [
  'earning', 'allowance', 'bonus', 'advance', 'loan_repayment',
  'paye', 'nssf', 'shif', 'employer_paye', 'employer_nssf', 'employer_shif',
] as const
export type LineKind = (typeof LINE_KINDS)[number]

export function statutoryGap(code: StatutoryCode): string {
  return `${code} is not configured for this date.`
}

export interface BracketBand {
  upToCents: number | null
  rateBps: number
}

export interface StatutoryRate {
  code: StatutoryCode
  payer: StatutoryPayer
  kind: StatutoryKind
  rateBps: number
  brackets: BracketBand[] | null
  ceilingCents: number | null
  floorCents: number | null
  effectiveFrom: string
  effectiveTo: string | null
}

export interface ExtraLine {
  kind: 'allowance' | 'bonus' | 'advance' | 'loan_repayment'
  label: string
  amountCents: number
}

export interface PersonInput {
  monthlySalaryCents: number
  daysWorked: number | null
  dailyRateCents: number | null
  overtimeHours: number | null
  overtimeRateCents: number | null
  lines: ExtraLine[]
}

export interface ComputedLine {
  kind: LineKind
  label: string
  amountCents: number
}

export interface PersonPay {
  payBasis: 'monthly' | 'casual'
  daysWorked: number | null
  dailyRateCents: number | null
  overtimeHours: number | null
  overtimeRateCents: number | null
  grossCents: number
  deductionCents: number
  netCents: number
  employerCostCents: number
  lines: ComputedLine[]
}

export interface PayrollFigures {
  people: PersonPay[]
  grossCents: number
  deductionCents: number
  netCents: number
  employerCostCents: number
  expenseCents: number
  unconfigured: string[]
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator
}

export function isStatutoryCode(value: string): value is StatutoryCode {
  return (STATUTORY_CODES as readonly string[]).includes(value)
}

/** Overtime pay from hours (up to two decimal places) and a cent rate. */
export function overtimePayCents(hours: number, rateCents: number): number | null {
  if (!Number.isFinite(hours) || hours < 0) return null
  if (!Number.isInteger(rateCents) || rateCents < 0) return null
  const scaled = hours * 100
  const hundredths = Math.round(scaled)
  if (Math.abs(scaled - hundredths) > 1e-6) return null
  const cents = halfUp(BigInt(hundredths) * BigInt(rateCents), BigInt(100))
  const asNumber = Number(cents)
  if (!Number.isSafeInteger(asNumber)) return null
  return asNumber
}

function covers(rate: StatutoryRate, day: string): boolean {
  return rate.effectiveFrom <= day && (rate.effectiveTo == null || rate.effectiveTo >= day)
}

function bracketTax(gross: number, bands: BracketBand[]): number {
  const sorted = bands.slice().sort((a, b) => {
    if (a.upToCents == null) return 1
    if (b.upToCents == null) return -1
    return a.upToCents - b.upToCents
  })
  let tax = 0
  let prev = 0
  for (const band of sorted) {
    const cap = band.upToCents ?? gross
    const slice = Math.min(gross, cap) - prev
    if (slice > 0) {
      tax += Number(halfUp(BigInt(slice) * BigInt(band.rateBps), BigInt(10000)))
    }
    prev = cap
    if (gross <= (band.upToCents ?? gross)) break
  }
  return tax
}

function clamp(amount: number, floor: number | null, ceiling: number | null): number {
  let next = amount
  if (ceiling != null) next = Math.min(next, ceiling)
  if (floor != null) next = Math.max(next, floor)
  return next
}

function percentOf(gross: number, rateBps: number): number {
  return Number(halfUp(BigInt(gross) * BigInt(rateBps), BigInt(10000)))
}

/**
 * One side of one scheme. A fixed PAYE row beside a bracket or a percent is
 * personal relief and is subtracted, never below zero. Two calculating rows
 * on the same day are refused rather than averaged.
 */
function sideAmount(
  code: StatutoryCode,
  rows: StatutoryRate[],
  gross: number,
): number | { refused: string } | null {
  if (rows.length === 0) return null
  const calculating = rows.filter((row) => row.kind === 'percent' || row.kind === 'bracket')
  const fixed = rows.filter((row) => row.kind === 'fixed')
  if (calculating.length > 1) {
    return { refused: `More than one ${code} calculation is configured for this date.` }
  }
  if (fixed.length > 1) {
    return { refused: `More than one ${code} fixed amount is configured for this date.` }
  }
  if (calculating.length === 1 && fixed.length === 1 && code !== 'PAYE') {
    return { refused: `More than one ${code} calculation is configured for this date.` }
  }
  if (calculating.length === 0 && fixed.length === 1) return fixed[0].rateBps
  if (calculating.length === 0) return null
  const row = calculating[0]
  const raw = row.kind === 'percent'
    ? percentOf(gross, row.rateBps)
    : bracketTax(gross, row.brackets ?? [])
  const clamped = clamp(raw, row.floorCents, row.ceilingCents)
  if (code === 'PAYE' && fixed.length === 1) return Math.max(0, clamped - fixed[0].rateBps)
  return clamped
}

const EMPLOYEE_LINE: Record<StatutoryCode, LineKind> = { PAYE: 'paye', NSSF: 'nssf', SHIF: 'shif' }
const EMPLOYER_LINE: Record<StatutoryCode, LineKind> = {
  PAYE: 'employer_paye', NSSF: 'employer_nssf', SHIF: 'employer_shif',
}
const SCHEME_LABEL: Record<StatutoryCode, string> = { PAYE: 'PAYE', NSSF: 'NSSF', SHIF: 'SHIF' }

export function computePayroll(people: PersonInput[], asOf: string, rates: StatutoryRate[]): PayrollFigures | { refused: string } {
  const unconfigured: string[] = []
  for (const code of STATUTORY_CODES) {
    if (!rates.some((rate) => rate.code === code && covers(rate, asOf))) unconfigured.push(statutoryGap(code))
  }

  const computed: PersonPay[] = []
  for (const person of people) {
    const casual = person.daysWorked != null || person.dailyRateCents != null
    const lines: ComputedLine[] = []
    let earning = 0
    if (casual) {
      const days = person.daysWorked ?? 0
      const rate = person.dailyRateCents ?? 0
      const dayPay = days * rate
      if (!Number.isSafeInteger(dayPay)) return { refused: 'The day pay is too large to record.' }
      if (dayPay > 0) lines.push({ kind: 'earning', label: 'Days worked', amountCents: dayPay })
      earning += dayPay
      if (person.overtimeHours != null && person.overtimeRateCents != null) {
        const overtime = overtimePayCents(person.overtimeHours, person.overtimeRateCents)
        if (overtime == null) return { refused: 'Overtime hours can have at most two decimal places.' }
        if (overtime > 0) lines.push({ kind: 'earning', label: 'Overtime', amountCents: overtime })
        earning += overtime
      }
    } else {
      earning = person.monthlySalaryCents
      if (earning > 0) lines.push({ kind: 'earning', label: 'Monthly salary', amountCents: earning })
    }

    let extras = 0
    let advances = 0
    for (const line of person.lines) {
      if (line.kind === 'allowance' || line.kind === 'bonus') {
        lines.push({ kind: line.kind, label: line.label, amountCents: line.amountCents })
        extras += line.amountCents
      } else {
        lines.push({ kind: line.kind, label: line.label, amountCents: -line.amountCents })
        advances += line.amountCents
      }
    }
    const gross = earning + extras
    if (gross <= 0) return { refused: 'There is no pay for this person.' }

    let statutoryEmployee = 0
    let employer = 0
    for (const code of STATUTORY_CODES) {
      const employeeRows = rates.filter((rate) => rate.code === code && rate.payer === 'employee' && covers(rate, asOf))
      const employerRows = rates.filter((rate) => rate.code === code && rate.payer === 'employer' && covers(rate, asOf))
      const employeeAmount = sideAmount(code, employeeRows, gross)
      if (employeeAmount && typeof employeeAmount === 'object') return employeeAmount
      const employerAmount = sideAmount(code, employerRows, gross)
      if (employerAmount && typeof employerAmount === 'object') return employerAmount
      if (typeof employeeAmount === 'number' && employeeAmount > 0) {
        lines.push({ kind: EMPLOYEE_LINE[code], label: SCHEME_LABEL[code], amountCents: -employeeAmount })
        statutoryEmployee += employeeAmount
      }
      if (typeof employerAmount === 'number' && employerAmount > 0) {
        lines.push({ kind: EMPLOYER_LINE[code], label: `Employer ${SCHEME_LABEL[code]}`, amountCents: employerAmount })
        employer += employerAmount
      }
    }

    const deduction = statutoryEmployee + advances
    const net = gross - deduction
    if (net < 0) return { refused: 'Deductions are more than the gross pay.' }
    computed.push({
      payBasis: casual ? 'casual' : 'monthly',
      daysWorked: casual ? person.daysWorked : null,
      dailyRateCents: casual ? person.dailyRateCents : null,
      overtimeHours: casual ? person.overtimeHours : null,
      overtimeRateCents: casual ? person.overtimeRateCents : null,
      grossCents: gross,
      deductionCents: deduction,
      netCents: net,
      employerCostCents: employer,
      lines,
    })
  }

  const grossCents = computed.reduce((sum, person) => sum + person.grossCents, 0)
  const deductionCents = computed.reduce((sum, person) => sum + person.deductionCents, 0)
  const netCents = computed.reduce((sum, person) => sum + person.netCents, 0)
  const employerCostCents = computed.reduce((sum, person) => sum + person.employerCostCents, 0)
  return {
    people: computed,
    grossCents,
    deductionCents,
    netCents,
    employerCostCents,
    expenseCents: grossCents + employerCostCents,
    unconfigured,
  }
}

export interface JournalSplits {
  expenseCents: number
  netCents: number
  payeCents: number
  nssfCents: number
  shifCents: number
  advanceCents: number
}

/** The journal credits. Employee lines are stored negative; employer lines positive. */
export function journalSplits(lines: { kind: string; amountCents: number }[]): JournalSplits {
  let gross = 0
  let employer = 0
  let paye = 0
  let nssf = 0
  let shif = 0
  let advance = 0
  for (const line of lines) {
    if (line.kind === 'earning' || line.kind === 'allowance' || line.kind === 'bonus') gross += line.amountCents
    else if (line.kind === 'advance' || line.kind === 'loan_repayment') advance += -line.amountCents
    else if (line.kind === 'paye') paye += -line.amountCents
    else if (line.kind === 'employer_paye') { paye += line.amountCents; employer += line.amountCents }
    else if (line.kind === 'nssf') nssf += -line.amountCents
    else if (line.kind === 'employer_nssf') { nssf += line.amountCents; employer += line.amountCents }
    else if (line.kind === 'shif') shif += -line.amountCents
    else if (line.kind === 'employer_shif') { shif += line.amountCents; employer += line.amountCents }
  }
  const deduction = paye + nssf + shif + advance - employer
  return {
    expenseCents: gross + employer,
    netCents: gross - deduction,
    payeCents: paye,
    nssfCents: nssf,
    shifCents: shif,
    advanceCents: advance,
  }
}
