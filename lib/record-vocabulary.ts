// ── Curated pick-lists for the worker record forms ──────────────────────────
// The problem these solve: `records.data` is a free-form jsonb blob, and the
// worker forms wrote straight text into it. "Newcastle vaccine", "newcastle",
// "NCD vaccine" and "Newcastl" all became distinct values, so any report that
// ever groups by treatment or cause fragments into near-duplicates that nobody
// can reconcile afterwards. The same typo problem `batches.stage` has.
//
// ── Why constants and not a table ──────────────────────────────────────────
// `inventory_items.category` is FREE TEXT — `text('category').notNull()
// .default('')`, see db/schemas/inventory.ts:42, holding 'Feed' / 'Vet' /
// 'Agro' in the demo data and whatever a tenant types in practice. There is
// no medicine/vaccine category to key off reliably, and
// GET /api/inventory/available deliberately applies no category filter for
// exactly that reason (see its header comment). Matching on a free-text
// category would silently hide a drug somebody filed differently, which is
// worse than a curated list. So: a curated list, stated as such, rather than
// a table invented to look more rigorous than the data underneath it.
//
// ── Why every list keeps an "Other" escape ─────────────────────────────────
// A farm will always have a cause or a drug this list lacks, and a worker who
// cannot record what actually happened either records something false or
// records nothing. Picking OTHER_OPTION reveals a text input and the typed
// value is what gets stored — the dropdown removes the typo for the common
// case without removing the ability to say something new.
//
// ── These are NOT a server-side allowlist ──────────────────────────────────
// Because "Other" admits arbitrary text, POST /api/records cannot reject an
// unlisted cause or treatment: any string is legitimately reachable through
// the escape hatch, so a server check could only ever reject valid data. The
// dropdown is a data-quality affordance, not an authorisation boundary — the
// place the server IS the authority is the feeding `itemId`, which names a
// real inventory row and is checked in app/api/records/route.ts.
//
// Shared by components/farm/worker.tsx and components/farm/vet.tsx so the two
// screens cannot drift into two different vocabularies for one column.

/** Shown last in every list; selecting it reveals a free-text input. */
export const OTHER_OPTION = 'Other'

// Kept in sync with the list components/farm/vet.tsx has used since it was
// built — a vet and a worker reporting the same death must produce the same
// string, or the mortality report counts them separately.
export const MORTALITY_CAUSES = [
  'Disease',
  'Sudden death',
  'Injury',
  'Predator',
  'Heat stress',
  'Cold stress',
  'Respiratory',
  'Culled',
  'Unknown',
] as const

// Vaccines and treatments a smallholder poultry/livestock farm actually gives.
// Grouped loosely by what they are, because a worker scanning a flat list of
// twenty drug names finds nothing.
export const HEALTH_TREATMENTS = [
  'Newcastle vaccine',
  'Gumboro vaccine',
  'Fowl pox vaccine',
  'Marek vaccine',
  'Fowl typhoid vaccine',
  'Infectious bronchitis vaccine',
  'Dewormer',
  'Coccidiostat',
  'Antibiotic',
  'Vitamin supplement',
  'Electrolytes',
  'Dewormer drench',
  'Foot bath / disinfectant',
] as const

// Dose was a free-text box captioned "e.g. 1ml each", which produced "1ml",
// "1 ml", "1ml each", "one ml" for the same dose. Splitting it into a number
// and a unit makes it a figure that can be summed against stock later;
// storing the two parts joined keeps `data.dose` readable for records written
// before this existed.
export const DOSE_UNITS = ['ml', 'mg', 'g', 'ml/litre', 'g/litre', 'tablet', 'drop', 'dose'] as const

/**
 * Joins the split dose fields back into the single `data.dose` string the
 * record payload has always carried, so old and new records read the same.
 * Returns '' when no amount was entered — an empty dose stays empty rather
 * than becoming a bare unit like "ml".
 */
export function formatDose(amount: string, unit: string, per: string): string {
  const n = amount.trim()
  if (!n) return ''
  return `${n}${unit}${per.trim() ? ` ${per.trim()}` : ''}`
}
