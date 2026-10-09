// Landed cost for a multi-line receipt (issue #423).
// Pure integer cents. The route recomputes this; a client preview is not trusted.
// No rate and no charge is invented: an empty charge list allocates nothing.

export const CHARGE_KINDS = ['freight', 'loading', 'levy'] as const
export type ChargeKind = (typeof CHARGE_KINDS)[number]

export function isChargeKind(value: string): value is ChargeKind {
  return (CHARGE_KINDS as readonly string[]).includes(value)
}

/**
 * Split `totalCents` across `weights` in integer cents.
 * The remainder, which floor division drops, is added to the largest weight
 * so the shares add back to `totalCents`. A tie keeps the earliest line.
 * A zero weight gets nothing when any other weight is positive.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  if (totalCents === 0) return weights.map(() => 0)
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) return weights.map(() => 0)
  const shares = weights.map((w) => Math.floor((totalCents * w) / sum))
  const remainder = totalCents - shares.reduce((s, n) => s + n, 0)
  let largest = 0
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] > weights[largest]) largest = i
  }
  shares[largest] += remainder
  return shares
}

export interface ChargeInput {
  amountCents: number
}

export interface LineWeight {
  extendedCents: number
  quantity: number
}

/**
 * Charges follow each line's extended raw cost (quantity × raw unit cost).
 * When every line's extended cost is zero, they follow quantity instead.
 * A zero-value line beside valued lines therefore gets no charge.
 * Returns one allocated total per line, in the same order.
 */
export function allocateCharges(lines: LineWeight[], charges: ChargeInput[]): number[] {
  const allocated = lines.map(() => 0)
  if (charges.length === 0 || lines.length === 0) return allocated
  const extended = lines.map((line) => line.extendedCents)
  const byQuantity = extended.every((cents) => cents === 0)
  const weights = byQuantity ? lines.map((line) => line.quantity) : extended
  if (weights.every((w) => w <= 0)) return allocated
  for (const charge of charges) {
    const shares = apportionCents(charge.amountCents, weights)
    for (let i = 0; i < shares.length; i++) allocated[i] += shares[i]
  }
  return allocated
}

/**
 * Integer landed unit cost, half-up. One stored unit cost cannot carry a
 * leftover cent, so quantity × this figure can differ from the line's landed
 * total by less than half a cent per unit. The purchase row and the journal
 * keep the exact landed total; this is only the per-unit figure shown on the lot.
 */
export function landedUnitCostCents(landedTotalCents: number, quantity: number): number {
  if (quantity <= 0) return 0
  return Number((BigInt(landedTotalCents) + BigInt(quantity) / BigInt(2)) / BigInt(quantity))
}

/** Pay lines in order, never more than each line's settled gross. */
export function allocatePayment(paidCents: number, lineGrossCents: number[]): number[] {
  let left = paidCents
  return lineGrossCents.map((gross) => {
    const take = Math.min(Math.max(left, 0), Math.max(gross, 0))
    left -= take
    return take
  })
}
