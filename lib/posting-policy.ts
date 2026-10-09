// Money approval thresholds (issue #424). Pure: the route recomputes this,
// and the form uses the same function so the sentence matches the decision.
// No policy is invented. An empty list posts immediately.
//
// Payroll's pay step calls judgeMoney in a later change. This module does
// not know about a pay run.
import { formatMoney } from '@/lib/money'

export const POLICY_KINDS = ['amount', 'account', 'farm', 'variance'] as const
export type PolicyKind = (typeof POLICY_KINDS)[number]
export const POLICY_EFFECTS = ['pending', 'block'] as const
export type PolicyEffect = (typeof POLICY_EFFECTS)[number]

export const POSTS_NOW = 'No threshold is set — this posts now.'
export const PENDING_MESSAGE = 'Pending approval — this will not enter the books until it is approved.'

export function blockedMessage(thresholdCents: number, subject: string): string {
  return `Blocked: this is above the ${formatMoney(thresholdCents)} line for ${subject}.`
}

export function isPolicyKind(value: string): value is PolicyKind {
  return (POLICY_KINDS as readonly string[]).includes(value)
}

export function isPolicyEffect(value: string): value is PolicyEffect {
  return (POLICY_EFFECTS as readonly string[]).includes(value)
}

export interface PostingPolicy {
  kind: PolicyKind
  accountCode: string | null
  farmId: string | null
  thresholdCents: number
  effect: PolicyEffect
}

export interface MoneyLeg {
  accountCode: string
  amountCents: number
}

export interface MoneyDocument {
  amountCents: number
  farmId: string | null
  legs: MoneyLeg[]
}

export interface MoneyDecision {
  outcome: 'post' | 'pending' | 'block'
  message: string
  thresholdCents: number | null
}

// Account numbers match lib/finance.ts ACCOUNT_CODES. Kept here so a form
// can build the same legs the journal will post, without loading the server.
const PURCHASES_EXPENSE = '5001'
const CASH = '1001'
const ACCOUNTS_RECEIVABLE = '1002'
const ACCOUNTS_PAYABLE = '2001'
const SALES_REVENUE = '4001'
const VAT_RECEIVABLE = '1300'
const VAT_PAYABLE = '2300'

function balanced(totalCents: number, netCents: number | null, taxCents: number | null): { net: number; tax: number } | null {
  if (typeof netCents !== 'number' || typeof taxCents !== 'number') return null
  if (netCents + taxCents !== totalCents || netCents < 0 || taxCents < 0) return null
  return { net: netCents, tax: taxCents }
}

/** The legs a purchase or an expense journal would post. */
export function expenseLegs(input: {
  totalCents: number
  paidCents: number
  netCents: number | null
  taxCents: number | null
  expenseAccount: string
}): MoneyLeg[] {
  const split = balanced(input.totalCents, input.netCents, input.taxCents)
  const expense = split ? split.net : input.totalCents
  const tax = split ? split.tax : 0
  const paid = Math.min(Math.max(input.paidCents, 0), Math.max(input.totalCents, 0))
  const owed = Math.max(input.totalCents, 0) - paid
  const legs: MoneyLeg[] = []
  if (expense > 0) legs.push({ accountCode: input.expenseAccount, amountCents: expense })
  if (tax > 0) legs.push({ accountCode: VAT_RECEIVABLE, amountCents: tax })
  if (paid > 0) legs.push({ accountCode: CASH, amountCents: paid })
  if (owed > 0) legs.push({ accountCode: ACCOUNTS_PAYABLE, amountCents: owed })
  return legs
}

export function purchaseLegs(input: {
  totalCents: number
  paidCents: number
  netCents: number | null
  taxCents: number | null
}): MoneyLeg[] {
  return expenseLegs({ ...input, expenseAccount: PURCHASES_EXPENSE })
}

/** Sum legs that share an account. A receipt is judged as one invoice. */
export function combineLegs(groups: MoneyLeg[][]): MoneyLeg[] {
  const totals = new Map<string, number>()
  for (const group of groups) {
    for (const leg of group) {
      totals.set(leg.accountCode, (totals.get(leg.accountCode) ?? 0) + leg.amountCents)
    }
  }
  return [...totals.entries()].map(([accountCode, amountCents]) => ({ accountCode, amountCents }))
}

function kindRank(kind: PolicyKind): number {
  if (kind === 'account') return 0
  if (kind === 'farm') return 1
  return 2
}

/** paymentStatus 'pending' is a credit sale (Accounts Receivable), not an approval. */
export function saleLegs(input: {
  amountCents: number
  paymentStatus: string
  netCents: number | null
  taxCents: number | null
}): MoneyLeg[] {
  const split = balanced(input.amountCents, input.netCents, input.taxCents)
  const revenue = split ? split.net : input.amountCents
  const tax = split ? split.tax : 0
  const debit = input.paymentStatus === 'pending' ? ACCOUNTS_RECEIVABLE : CASH
  const legs: MoneyLeg[] = []
  if (input.amountCents > 0) legs.push({ accountCode: debit, amountCents: input.amountCents })
  if (revenue > 0) legs.push({ accountCode: SALES_REVENUE, amountCents: revenue })
  if (tax > 0) legs.push({ accountCode: VAT_PAYABLE, amountCents: tax })
  return legs
}

/**
 * A document is over a line only when its amount is strictly above the
 * threshold. Equal still posts. Variance policies are not money rules.
 * Block wins over pending. The quoted line is the lowest matching threshold
 * of the winning effect.
 */
export function judgeMoney(policies: PostingPolicy[], doc: MoneyDocument): MoneyDecision {
  const matches: { policy: PostingPolicy; subject: string }[] = []
  for (const policy of policies) {
    if (policy.kind === 'variance') continue
    if (policy.kind === 'amount') {
      if (doc.amountCents > policy.thresholdCents) matches.push({ policy, subject: 'any posting' })
      continue
    }
    if (policy.kind === 'farm') {
      if (policy.farmId && doc.farmId === policy.farmId && doc.amountCents > policy.thresholdCents) {
        matches.push({ policy, subject: 'this farm' })
      }
      continue
    }
    if (policy.kind === 'account') {
      if (!policy.accountCode) continue
      if (policy.farmId && policy.farmId !== doc.farmId) continue
      const leg = doc.legs.find((row) => row.accountCode === policy.accountCode)
      if (leg && leg.amountCents > policy.thresholdCents) {
        matches.push({ policy, subject: `account ${policy.accountCode}` })
      }
    }
  }
  if (matches.length === 0) return { outcome: 'post', message: POSTS_NOW, thresholdCents: null }
  const blocks = matches.filter((row) => row.policy.effect === 'block')
  const pool = (blocks.length > 0 ? blocks : matches).slice().sort((a, b) => {
    const byThreshold = a.policy.thresholdCents - b.policy.thresholdCents
    if (byThreshold !== 0) return byThreshold
    return kindRank(a.policy.kind) - kindRank(b.policy.kind)
  })
  const chosen = pool[0]
  if (chosen.policy.effect === 'block') {
    return {
      outcome: 'block',
      message: blockedMessage(chosen.policy.thresholdCents, chosen.subject),
      thresholdCents: chosen.policy.thresholdCents,
    }
  }
  return { outcome: 'pending', message: PENDING_MESSAGE, thresholdCents: chosen.policy.thresholdCents }
}

const STOCK_COUNT_SUBJECT = 'a stock count'

/**
 * A variance policy is read first. The older settings column still holds a
 * count when no variance policy is exceeded, so a farm that only set that
 * column is held exactly as before. Nothing is copied from the column into
 * a policy row.
 */
export function varianceDecision(
  costImpactCents: number,
  policies: PostingPolicy[],
  columnCents: number | null,
): MoneyDecision {
  const impact = Math.abs(costImpactCents)
  const exceeded = policies.filter((policy) => policy.kind === 'variance' && impact > policy.thresholdCents)
  const blocks = exceeded.filter((policy) => policy.effect === 'block')
  if (blocks.length > 0) {
    const thresholdCents = Math.min(...blocks.map((policy) => policy.thresholdCents))
    return { outcome: 'block', message: blockedMessage(thresholdCents, STOCK_COUNT_SUBJECT), thresholdCents }
  }
  if (exceeded.length > 0) {
    const thresholdCents = Math.min(...exceeded.map((policy) => policy.thresholdCents))
    return {
      outcome: 'pending',
      message: `This cost impact is above the ${formatMoney(thresholdCents)} line. Stock will not change until it is approved.`,
      thresholdCents,
    }
  }
  if (columnCents !== null && impact > columnCents) {
    return {
      outcome: 'pending',
      message: `This cost impact is above the ${formatMoney(columnCents)} line. Stock will not change until it is approved.`,
      thresholdCents: columnCents,
    }
  }
  return { outcome: 'post', message: POSTS_NOW, thresholdCents: null }
}

export interface MoneyDetails {
  docType: 'sale' | 'purchase' | 'expense'
  documentId: string
  amountCents?: number
  accountCode?: string | null
  stockEffect?: string | null
  dimensions?: Record<string, string> | null
  lots?: { quantity: number; expiryDate: string | null; lotNo: string | null }[]
  // A held receipt: one approval for every line of the receipt group.
  // documentId is the first line; each line carries its own lots.
  receiptGroupId?: string
  lines?: { documentId: string; lots: { quantity: number; expiryDate: string | null; lotNo: string | null }[] }[]
}

export type MoneyLot = { quantity: number; expiryDate: string | null; lotNo: string | null }

function parseLots(value: unknown): MoneyLot[] | null {
  if (!Array.isArray(value)) return null
  const lots: MoneyLot[] = []
  for (const lot of value) {
    if (!lot || typeof lot !== 'object') return null
    const item = lot as Record<string, unknown>
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) return null
    lots.push({
      quantity: item.quantity,
      expiryDate: typeof item.expiryDate === 'string' ? item.expiryDate : null,
      lotNo: typeof item.lotNo === 'string' ? item.lotNo : null,
    })
  }
  return lots
}

export function parseMoneyDetails(raw: string): MoneyDetails | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const row = parsed as Record<string, unknown>
  if (row.docType !== 'sale' && row.docType !== 'purchase' && row.docType !== 'expense') return null
  if (typeof row.documentId !== 'string' || !row.documentId) return null
  const details: MoneyDetails = { docType: row.docType, documentId: row.documentId }
  if (typeof row.amountCents === 'number' && Number.isInteger(row.amountCents) && row.amountCents >= 0) {
    details.amountCents = row.amountCents
  }
  if (typeof row.accountCode === 'string') details.accountCode = row.accountCode
  if (typeof row.stockEffect === 'string' || row.stockEffect === null) details.stockEffect = row.stockEffect as string | null
  if (row.dimensions && typeof row.dimensions === 'object' && !Array.isArray(row.dimensions)) {
    const dimensions: Record<string, string> = {}
    for (const [key, value] of Object.entries(row.dimensions as Record<string, unknown>)) {
      if (typeof value === 'string') dimensions[key] = value
    }
    details.dimensions = dimensions
  }
  if (Array.isArray(row.lots)) {
    const lots = parseLots(row.lots)
    if (!lots) return null
    details.lots = lots
  }
  if (typeof row.receiptGroupId === 'string') details.receiptGroupId = row.receiptGroupId
  if (Array.isArray(row.lines)) {
    const lines: NonNullable<MoneyDetails['lines']> = []
    for (const line of row.lines) {
      if (!line || typeof line !== 'object') return null
      const item = line as Record<string, unknown>
      const lots = parseLots(item.lots)
      if (typeof item.documentId !== 'string' || !item.documentId || !lots) return null
      lines.push({ documentId: item.documentId, lots })
    }
    details.lines = lines
  }
  return details
}
