// ── Human-readable entity codes (issue #231 task 2) ─────────────────────────
// The UI (components/farm/crops.tsx, data.ts) is built entirely around codes
// like "BRO-KMU-022": <enterprise-prefix>-<farm-location-segment>-<sequence>.
// This module is the server-side equivalent of data.ts's `genCode()` /
// crops.tsx's local `genCode()`, so batch codes generated here look exactly
// like the ones the UI's own mock generator produces.
//
// Shared on purpose: `production_units` already has a `code` column (issue
// #231 task 2 explicitly says reuse it, not fork a second units table) but no
// route creates production_units rows yet on this branch — that's a
// units-CRUD issue this repo doesn't have open work for yet. When it lands,
// its create route should call `generateCode(unitPrefixFor(enterprise),
// farmCode, seq)` from here rather than reimplementing this scheme, so unit
// codes (e.g. "HSE-KMU-004") and batch codes stay the same shape.
//
// Uniqueness: this module only computes a candidate code from a count — it is
// NOT the uniqueness guard. Callers must still check per-tenant collisions
// (mirroring app/api/farms/route.ts's farmCodeFromName + taken-set pattern)
// and rely on a DB unique index for the real concurrent-insert race.

// Enterprise subtype -> batch-code prefix, matching ENTERPRISE_REGISTRY in
// components/farm/data.ts. Kept as a plain map rather than importing that
// file: it's a "use client" component module, not something a server route
// can import, and this list only needs to track the *codes*, not the full
// UI config (metrics/processes/etc).
export const BATCH_PREFIXES: Record<string, string> = {
  broiler: 'BRO',
  layer: 'LYR',
  pig: 'PIG',
  dairy_cow: 'COW',
  beef_cow: 'COW',
  goat: 'GOT',
  sheep: 'SHP',
  rabbit: 'RBT',
  turkey: 'TKY',
  duck: 'DCK',
  fish: 'FSH',
  maize: 'MZE',
  wheat: 'WHT',
  sorghum: 'SRG',
  kitchen_garden: 'KIT',
  silage: 'SLG',
  fruit_orchard: 'FRT',
  vegetables: 'VEG',
  legumes: 'LEG',
  fodder: 'FDR',
}

// Same idea, for a future production_units create route (unitPrefix in
// ENTERPRISE_REGISTRY, e.g. broiler -> "HSE").
export const UNIT_PREFIXES: Record<string, string> = {
  broiler: 'HSE',
  layer: 'PEN',
  pig: 'STY',
  dairy_cow: 'PAD',
  beef_cow: 'PAD',
  goat: 'PEN',
  sheep: 'PEN',
  rabbit: 'HTC',
  turkey: 'HSE',
  duck: 'HSE',
  fish: 'TNK',
  maize: 'FLD',
  wheat: 'FLD',
  sorghum: 'FLD',
  kitchen_garden: 'PLT',
  silage: 'FLD',
  fruit_orchard: 'BLK',
  vegetables: 'PLT',
  legumes: 'FLD',
  fodder: 'FLD',
}

// Enterprise subtype -> livestock/crop classification, matching
// ENTERPRISE_REGISTRY's `type` field in components/farm/data.ts (issue #296).
// Same "plain map, not an import" reason as BATCH_PREFIXES above — that file
// is a "use client" component module. GET /api/dashboard/kpis groups a
// tenant's ACTIVE batches by `enterprise` and uses this map to bucket each
// group as a Livestock Units group or a Crop Batches group, mirroring the
// original mock's `enterpriseMap`/`ENTERPRISE_REGISTRY.find(...)` logic
// exactly. An enterprise subtype not in this map returns `undefined` — the
// caller skips it entirely (never guesses a classification), same as the
// mock's `if (!cfg) return`.
export const ENTERPRISE_TYPES: Record<string, 'livestock' | 'crop'> = {
  broiler: 'livestock',
  layer: 'livestock',
  pig: 'livestock',
  dairy_cow: 'livestock',
  beef_cow: 'livestock',
  goat: 'livestock',
  sheep: 'livestock',
  rabbit: 'livestock',
  turkey: 'livestock',
  duck: 'livestock',
  fish: 'livestock',
  maize: 'crop',
  wheat: 'crop',
  sorghum: 'crop',
  kitchen_garden: 'crop',
  silage: 'crop',
  fruit_orchard: 'crop',
  vegetables: 'crop',
  legumes: 'crop',
  fodder: 'crop',
}

export function enterpriseTypeFor(enterprise: string): 'livestock' | 'crop' | undefined {
  return ENTERPRISE_TYPES[enterprise]
}

// Unknown/future enterprise subtype not in the map yet: fall back to a
// deterministic 3-letter prefix from the subtype string itself rather than
// throwing, so a new enterprise type doesn't hard-block batch creation.
function fallbackPrefix(enterprise: string): string {
  const letters = enterprise.replace(/[^a-zA-Z]/g, '').toUpperCase()
  return (letters.slice(0, 3) || 'GEN').padEnd(3, 'X')
}

export function batchPrefixFor(enterprise: string): string {
  return BATCH_PREFIXES[enterprise] ?? fallbackPrefix(enterprise)
}

export function unitPrefixFor(enterprise: string): string {
  return UNIT_PREFIXES[enterprise] ?? fallbackPrefix(enterprise)
}

// A farm code's human-facing "location segment" — the middle token of
// "FRM-KMU-001" is "KMU". Falls back to "XXX" for a malformed/short code
// rather than throwing (matches crops.tsx's own `genCode`).
export function farmSegment(farmCode: string): string {
  return farmCode.split('-')[1] ?? 'XXX'
}

// PREFIX-SEGMENT-NNN, e.g. generateCode("BRO", "FRM-KMU-001", 22) ->
// "BRO-KMU-022". `seq` is the caller's responsibility (typically: count of
// existing rows for this tenant+prefix+segment, plus one).
export function generateCode(prefix: string, farmCode: string, seq: number): string {
  return `${prefix}-${farmSegment(farmCode)}-${String(Math.max(seq, 1)).padStart(3, '0')}`
}
