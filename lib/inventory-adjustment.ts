// Stock-count approval (issue #418). Shared by the lot route, the approval
// decision, and the screens that have to show the same proposal the server
// stored. No database access: the client renders it too.

export const ADJUSTMENT_TYPES: { id: string; label: string }[] = [
  { id: 'count', label: 'Count correction' },
  { id: 'spoilage', label: 'Spoilage' },
  { id: 'damage', label: 'Damage' },
  { id: 'theft', label: 'Theft' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'opening_balance', label: 'Opening balance' },
]

export const ADJUSTMENT_TYPE_IDS = new Set(ADJUSTMENT_TYPES.map((t) => t.id))

export function adjustmentTypeLabel(id: string | null): string {
  if (!id) return 'Not specified'
  return ADJUSTMENT_TYPES.find((t) => t.id === id)?.label ?? id
}

// Held only when a line exists AND the absolute shilling impact is strictly
// above it. Null is "no line", and an impact equal to the line still saves.
export function adjustmentIsHeld(costImpactCents: number, thresholdCents: number | null): boolean {
  if (thresholdCents === null) return false
  return Math.abs(costImpactCents) > thresholdCents
}

export interface InventoryAdjustmentProposal {
  lotId: string
  lotNo: string
  beforeQty: number
  qtyOnHand: number
  variance: number
  costImpactCents: number
  unitCostCents: number
  reason: string
  adjustmentType: string | null
  countedBy: string
  witnessName: string
  photoUrl: string | null
}

function whole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

// Returns null when the stored text is not a proposal whose own figures
// agree. Callers show that as "could not be read" — they do not fill in a
// quantity or a cost.
export function parseInventoryAdjustmentDetails(details: string): InventoryAdjustmentProposal | null {
  let raw: unknown
  try {
    raw = JSON.parse(details)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (typeof b.lotId !== 'string' || !b.lotId) return null
  if (typeof b.lotNo !== 'string') return null
  if (!whole(b.beforeQty) || !whole(b.qtyOnHand) || !whole(b.variance)) return null
  if (!whole(b.costImpactCents) || !whole(b.unitCostCents)) return null
  if (typeof b.reason !== 'string' || !b.reason.trim()) return null
  if (b.adjustmentType !== null && typeof b.adjustmentType !== 'string') return null
  if (typeof b.countedBy !== 'string' || !b.countedBy.trim()) return null
  if (typeof b.witnessName !== 'string' || !b.witnessName.trim()) return null
  if (b.photoUrl !== null && typeof b.photoUrl !== 'string') return null
  if (b.variance !== b.qtyOnHand - b.beforeQty) return null
  if (b.costImpactCents !== b.variance * b.unitCostCents) return null
  return {
    lotId: b.lotId,
    lotNo: b.lotNo,
    beforeQty: b.beforeQty,
    qtyOnHand: b.qtyOnHand,
    variance: b.variance,
    costImpactCents: b.costImpactCents,
    unitCostCents: b.unitCostCents,
    reason: b.reason.trim(),
    adjustmentType: b.adjustmentType,
    countedBy: b.countedBy.trim(),
    witnessName: b.witnessName.trim(),
    photoUrl: b.photoUrl,
  }
}
