import 'server-only';
import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './http';

/**
 * Parse a JSON request body with a Zod schema.
 * Returns either `{ data }` or a ready-to-return NextResponse (400).
 */
export async function parseBody<T extends ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { error: ReturnType<typeof badRequest> }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: badRequest('Invalid JSON body.') };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => i.message).join('; ') || 'Invalid request.';
    return { error: badRequest(msg) };
  }
  return { data: result.data };
}

// ── Shared fragments ──────────────────────────────────────────────────────

export const zNonEmpty = z.string().trim().min(1);
export const zPositiveNumber = z.number().finite().positive();
export const zNonNegNumber = z.number().finite().min(0);
// Coerced variants for fields fed by controlled number <input>s, whose React
// state (and therefore the JSON payload) is a string — plain z.number() rejects
// those outright with "Expected number, received string" instead of validating
// the actual value, which frontend forms then show as a misleading generic
// "field required" error.
export const zPositiveNumberCoerced = z.coerce.number().finite().positive();
export const zNonNegNumberCoerced = z.coerce.number().finite().min(0);
export const zUuidLike = z.string().min(8).max(64);
export const zDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}(T|$)/, 'Expected ISO date string (YYYY-MM-DD or ISO)');
export const zYearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM format');
export const zPin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4–6 digits.');
export const zPhone = z.string().trim().min(6).max(20);
export const zRole = z.enum(['worker', 'manager', 'vet']);
// Deliberately lenient (matches the pre-Zod parsePayDay helper): an out-of-range
// or non-integer value becomes null (no scheduled pay day) rather than rejecting
// the whole request — a typo'd pay day shouldn't block creating/updating an
// employee over an optional scheduling field.
export const zPayDay = z.number().nullable().optional()
  .transform((v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? v : null));
export const zSaleUnit = z.object({
  name: z.string().min(1),
  perBase: z.number().positive(),
  price: z.number().min(0),
});
export const zStatus = z.enum(['ASSIGNED', 'IN_PROGRESS', 'DONE', 'MISSED', 'SKIPPED']);

export const MIN_PASSWORD_LENGTH = 8;

// Default pagination bounds for list endpoints. Callers pass `?limit=N` to
// override; `?limit=0` opts into an explicit unbounded fetch (only for callers
// that genuinely need all rows, e.g. admin exports or totals).
export const DEFAULT_LIST_LIMIT = 2000;
export const MAX_LIMIT = 5000;

// ── Sync schemas (already in use) ─────────────────────────────────────────

export const syncRecordSchema = z.object({
  clientUuid: z.string().min(8).max(64),
  type: z.string().min(1).max(64),
  payload: z.record(z.unknown()).optional().default({}),
  capturedAt: z.string().min(4).max(40).optional(),
});

export const syncBodySchema = z.object({
  records: z.array(syncRecordSchema).max(200),
});

// ── POST /api/data/<resource> schemas ──────────────────────────────────────

export const createUnitSchema = z.object({
  name: zNonEmpty,
  type: z.string().optional().default('HOUSE'),
  capacity: zPositiveNumberCoerced.optional().default(0),
  species: z.string().optional().nullable(),
});

export const createBatchSchema = z.object({
  name: zNonEmpty,
  unitId: zNonEmpty,
  qty: zNonNegNumberCoerced.optional(),
  quantity: zNonNegNumberCoerced.optional(),
  acquiredDate: z.string().optional(),
  species: z.string().optional().default('unknown'),
  enterprise: z.string().optional().nullable(),
  breed: z.string().optional().nullable(),
  source: z.string().optional().default('PURCHASED'),
  cost: zNonNegNumberCoerced.optional(),
  acquisitionCost: zNonNegNumberCoerced.optional(),
  ageAtAcquire: zNonNegNumberCoerced.optional().default(0),
  stage: z.string().optional(),
});

// POST /api/batches/split-delivery — one delivery (e.g. 3600 fries), received
// as a single lot but stocked across several units in one action (e.g. 1200
// into each of 3 tanks). Creates one normal single-unit batch per allocation,
// tagged with a shared deliveryGroupId, with totalCost split proportionally.
export const splitDeliverySchema = z.object({
  name: zNonEmpty,
  species: z.string().optional().default('unknown'),
  enterprise: z.string().optional().nullable(),
  breed: z.string().optional().nullable(),
  source: z.string().optional().default('PURCHASED'),
  acquiredDate: z.string().optional(),
  ageAtAcquire: zNonNegNumberCoerced.optional().default(0),
  totalQty: zPositiveNumberCoerced,
  totalCost: zNonNegNumberCoerced.optional().default(0),
  allocations: z.array(z.object({ unitId: zNonEmpty, qty: zPositiveNumberCoerced })).min(2, 'Split a delivery across at least 2 units — for one unit, use the regular Add Batch form.'),
}).refine(
  (b) => b.allocations.reduce((s, a) => s + a.qty, 0) === b.totalQty,
  { message: 'The unit allocations must add up to the total quantity.', path: ['allocations'] },
);

export const createSaleSchema = z.object({
  batchId: zNonEmpty,
  quantity: zNonNegNumberCoerced,
  unitPrice: zNonNegNumberCoerced,
  productId: z.string().optional(),
  productType: z.string().optional(),
  unitName: z.string().optional(),
  weightKg: z.coerce.number().nullable().optional(),
  buyer: z.string().optional(),
  paymentMethod: z.string().optional(),
});

export const createEmployeeSchema = z.object({
  name: zNonEmpty,
  phone: zPhone,
  role: zRole.optional().default('worker'),
  workerProfileId: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  pin: z.union([zPin, z.literal('')]).optional().default(''),
  password: z.string().min(0).optional().default(''),
  salary: zNonNegNumber.optional().default(0),
  payDay: zPayDay.optional(),
  paymentsFrom: zYearMonth.optional().nullable(),
  assignedBatchIds: z.array(z.string()).nullable().optional(),
});

export const createTaskSchema = z.object({
  assignedTo: zNonEmpty,
  title: zNonEmpty,
  description: z.string().optional().nullable(),
  type: z.string().optional().default('custom'),
  unitId: z.string().optional().nullable(),
  batchId: z.string().optional().nullable(),
  scheduledFor: z.string().optional(),
  dueAt: z.string().optional(),
});

export const createWorkerProfileSchema = z.object({
  name: z.string().optional().default('New Profile'),
  description: z.string().optional().nullable(),
});

// ── PATCH /api/data/<resource> schemas ─────────────────────────────────────

export const updateWorkerProfileSchema = z.object({
  fields: z.array(z.unknown()).optional(),
  mortalityPhotoThreshold: z.number().int().min(0).optional(),
  name: z.string().optional(),
});

export const updateEmployeeSchema = z.object({
  name: z.string().optional(),
  role: zRole.optional(),
  active: z.boolean().optional(),
  salary: z.number().optional(),
  payDay: zPayDay.optional(),
  paymentsFrom: zYearMonth.optional().nullable(),
  assignedBatchIds: z.array(z.string()).nullable().optional(),
  workerProfileId: z.string().nullable().optional(),
  pin: z.union([zPin, z.literal('')]).optional().default(''),
  password: z.string().min(0).optional().default(''),
  email: z.string().email().optional().nullable(),
});

export const updateAlertSchema = z.object({
  acknowledged: z.boolean().default(true),
});

export const updateItemSchema = z.object({
  name: z.string().optional(),
  unit: z.string().optional(),
  lowStockThreshold: z.number().min(0).optional(),
});

export const updateLotSchema = z.object({
  qtyOnHand: z.number().min(0).optional(),
  unitCost: z.number().min(0).optional(),
});

export const updateTaskSchema = z.object({
  status: zStatus.optional(),
});

// ── Other API route schemas ────────────────────────────────────────────────

export const purchaseSchema = z.object({
  itemId: z.string().optional(),
  itemName: z.string().optional(),
  unit: z.string().optional().default('kg'),
  category: z.string().optional().default('CONSUMABLE'),
  quantity: zPositiveNumberCoerced,
  unitCost: zNonNegNumberCoerced,
  supplier: z.string().optional().default('Supplier'),
  withdrawalDays: zPositiveNumber.optional().nullable(),
  // Blank/absent → today (a same-day purchase); a present-but-unparseable value
  // is rejected rather than silently mis-dating the delivery, same convention
  // as app/api/setup/route.ts's dt() helper.
  receivedAt: z.string().optional(),
  // Defaults to "paid in full today" (the common cash-purchase case) — only
  // set explicitly for a credit/deferred-payment delivery.
  paymentMethod: z.enum(['cash', 'mpesa', 'credit', 'bank', 'other']).optional(),
  amountPaid: zNonNegNumberCoerced.optional(),
  paidAt: z.string().optional().nullable(),
});

// PATCH /api/purchases?id= — record a later/partial payment against an
// already-recorded purchase (e.g. settling a credit delivery via M-Pesa weeks
// after receipt).
export const purchasePaymentSchema = z.object({
  amountPaid: zNonNegNumberCoerced,
  paymentMethod: z.enum(['cash', 'mpesa', 'credit', 'bank', 'other']).optional(),
  paidAt: z.string().optional(),
});

// POST /api/inventory/process — mill/convert one item into a different item at
// less than 1:1 (e.g. whole maize -> flour). outputQty must not exceed
// inputQty (this is always a shrinkage, never a multiplication).
export const processSchema = z.object({
  inputItemId: zNonEmpty,
  inputQty: zPositiveNumberCoerced,
  // '__new' (matching purchaseSchema's item picker) lets the first-ever milling
  // of a given output — e.g. the very first time "Maize flour" is produced —
  // create that item on the spot instead of requiring a separate step first.
  outputItemId: zNonEmpty,
  outputItemName: z.string().optional(),
  outputUnit: z.string().optional().default('kg'),
  outputCategory: z.string().optional().default('FEED_FINISHED'),
  outputQty: zPositiveNumberCoerced,
  fee: zNonNegNumberCoerced.optional().default(0),
  note: z.string().optional().nullable(),
}).refine((b) => b.outputQty <= b.inputQty, { message: 'Output quantity cannot exceed input quantity — processing only loses material, never creates it.', path: ['outputQty'] });

export const feedMixCreateSchema = z.object({
  name: zNonEmpty,
  components: z
    .array(z.object({ itemId: zNonEmpty, kg: zPositiveNumber }))
    .min(1, 'At least one ingredient is required.'),
});

export const feedMixUpdateSchema = z.object({
  name: z.string().optional(),
  components: z
    .array(z.object({ itemId: zNonEmpty, kg: zPositiveNumber }))
    .min(1, 'At least one ingredient is required.')
    .optional(),
});

export const batchAdvanceSchema = z.object({
  batchId: zNonEmpty,
  toStage: zNonEmpty,
  toUnitId: z.string().optional(),
  newQty: z.number().min(0).optional(),
  note: z.string().optional().nullable(),
});

export const productCreateSchema = z.object({
  batchId: zNonEmpty,
  name: zNonEmpty,
  baseUnit: z.string().optional().default('unit'),
  collectFrequency: z.enum(['daily', 'weekly', 'monthly', 'per_cycle']).optional().default('per_cycle'),
  flow: z.enum(['sale', 'expense']).optional().default('sale'),
  saleUnits: z.array(zSaleUnit).optional().default([{ name: 'Unit', perBase: 1, price: 0 }]),
  isAnimalProduct: z.boolean().optional().default(false),
});

export const productUpdateSchema = z.object({
  name: z.string().optional(),
  collectFrequency: z.enum(['daily', 'weekly', 'monthly', 'per_cycle']).optional(),
  baseUnit: z.string().optional(),
  saleUnits: z.array(zSaleUnit).optional(),
  active: z.boolean().optional(),
  isAnimalProduct: z.boolean().optional(),
});

export const prescriptionSchema = z.object({
  batchId: zNonEmpty,
  product: zNonEmpty,
  dose: z.number().min(0).optional().default(0),
  route: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  withdrawal: z.coerce.number().int().min(0).nullable().optional(),
  productLotId: z.string().optional().nullable(),
});

export const payrollActionSchema = z.object({
  action: z.enum(['run', 'pay', 'ledger', 'deleteLedger']),
  period: zYearMonth.optional(),
  employeeId: z.string().optional(),
  type: z.enum(['advance', 'fine', 'bonus', 'adjustment']).optional(),
  amount: z.number().optional(),
  note: z.string().optional().nullable(),
  ledgerId: z.string().optional(),
  clientUuid: z.string().optional().nullable(),
});

export const testingActionSchema = z.object({
  action: z.enum(['start', 'step', 'photo', 'submit']),
  id: z.string().optional(),
  stepId: z.string().optional(),
  status: z.enum(['pass', 'fail', 'pending']).optional(),
  note: z.string().optional(),
  data: z.string().optional(),
});

// ── Sync payload schemas ────────────────────────────────────────────────────
// These validate the `payload` field of each sync record type. Previously the
// handlers parsed fields ad-hoc with num()/str() helpers — now they get typed,
// validated data upfront with clear error messages.

// Every worker record-entry form keeps numeric input as raw `string` state
// (e.g. `useState('')`) and enqueues it unconverted — the pre-Zod backend
// coerced with `Number(v) || 0`. `z.coerce.number()` matches that: it accepts
// a string OR a number rather than rejecting a legitimate "400" the way plain
// `z.number()` does. A genuinely malformed value (empty string, non-numeric
// text) coerces to NaN, still caught by `.finite()`/`.min()`/`.int()` below —
// this isn't a validation bypass, just accepting the wire format the client
// actually sends.
const zCoercedNum = () => z.coerce.number();

export const feedingPayloadSchema = z.object({
  batchId: z.string().optional().default(''),
  feedItemId: z.string().optional().nullable(),
  lotId: z.string().optional().nullable(),
  quantityKg: zCoercedNum().finite().min(0).optional().default(0),
});

export const mortalityPayloadSchema = z.object({
  batchId: z.string().optional().default(''),
  unitId: z.string().optional().nullable(),
  count: zCoercedNum().int().min(0).optional().default(0),
  cause: z.string().optional().nullable(),
  photo: z.string().optional().nullable(),
  photoId: z.string().optional().nullable(),
  gpsLat: zCoercedNum().optional().nullable(),
  gpsLng: zCoercedNum().optional().nullable(),
});

export const healthPayloadSchema = z.object({
  batchId: z.string().optional().default(''),
  type: z.string().optional().default('VACCINE'),
  productLotId: z.string().optional().nullable(),
  lotId: z.string().optional().nullable(),
  quantity: zCoercedNum().finite().min(0).optional().default(1),
  dose: zCoercedNum().finite().min(0).optional().default(1),
  // The worker form already collects and sends both of these (app/worker/record/health/page.tsx)
  // — they were previously silently stripped here (unknown keys) and never reached the DB.
  route: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const closingStockPayloadSchema = z.object({
  itemId: z.string().optional().default(''),
  closingQty: zCoercedNum().finite().min(0).optional().default(0),
});

export const productionPayloadSchema = z.object({
  batchId: z.string().optional().default(''),
  type: z.string().optional().default('eggs'),
  qty: zCoercedNum().finite().min(0).optional(),
  eggs: zCoercedNum().finite().min(0).optional(),
  count: zCoercedNum().finite().min(0).optional(),
  weightKg: zCoercedNum().optional().nullable(),
});

export const weightSamplePayloadSchema = z.object({
  batchId: z.string().optional().nullable(),
  avgWeightKg: zCoercedNum().optional().default(0),
  sampleSize: zCoercedNum().int().min(0).optional().nullable(),
});

export const physicalCountPayloadSchema = z.object({
  batchId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  systemCount: zCoercedNum().optional().default(0),
  physicalCount: zCoercedNum().optional().default(0),
  variance: zCoercedNum().optional(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const morningRoundEntrySchema = z.object({
  batchId: z.string().optional(),
  unitId: z.string().optional().nullable(),
  eggsCollected: zCoercedNum().optional().default(0),
  feedItemId: z.string().optional().nullable(),
  feedUsed: zCoercedNum().optional().default(0),
  waterLevel: z.string().optional().nullable(),
  waterColour: z.string().optional().nullable(),
  tempC: zCoercedNum().optional().nullable(),
  doMgL: zCoercedNum().optional().nullable(),
  ph: zCoercedNum().optional().nullable(),
  ammonia: zCoercedNum().optional().nullable(),
  abnormal: z.boolean().optional().default(false),
  abnormalNote: z.string().optional().nullable(),
});

export const morningRoundPayloadSchema = z.object({
  entries: z.array(morningRoundEntrySchema).optional().default([]),
});

// ── Auth schemas ────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Identifier is required.'),
  secret: z.string().min(1, 'Secret is required.'),
});

export const workerLoginSchema = z.object({
  phone: z.string().trim().min(1, 'Phone is required.'),
  pin: z.string().min(1, 'PIN is required.'),
});

export const ownerLoginSchema = z.object({
  email: z.string().trim().email('Invalid email format.').min(1, 'Email is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export const conflictResolveSchema = z.object({
  id: zNonEmpty,
  resolution: z.enum(['accept', 'kept_mine', 'kept_server']).default('accept'),
});

export const physicalCountSchema = z.object({
  action: z.enum(['apply', 'dismiss']),
  id: zNonEmpty,
});

export const auditorLinkSchema = z.object({
  // The client always sends the `email` key (never omits it), so a blank
  // "optional" field arrives as '' — treat that the same as not provided,
  // rather than failing z.string().email()'s format check on an empty string.
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  days: z.number().int().min(1).max(14).optional(),
});

export const setupSchema = z.object({
  farmName: z.string().optional(),
  farmLocation: z.string().optional(),
  // Enterprise keys picked on the "Quick Start Templates" step (e.g. 'layers',
  // 'broilers') — used to seed that enterprise's default lifecycle stage set.
  templates: z.array(z.string()).optional(),
  // Every array below allows a blank/absent `name` (and, for employees, blank
  // `phone`) at the schema level even though the route treats those as
  // required-in-spirit — the wizard always seeds one empty row per section by
  // default, and skipping a section entirely (e.g. no inventory yet) is a
  // completely normal path. app/api/setup/route.ts already skips any row
  // whose name/phone is blank rather than inserting it; rejecting the whole
  // submission here over one untouched placeholder row would defeat that and
  // surface a raw Zod message ("String must contain at least 1 character(s)")
  // for an entirely valid submission.
  units: z
    .array(z.object({
      name: z.string().optional().default(''),
      type: z.string().optional().default('HOUSE'),
      capacity: z.string().optional(),
    }))
    .optional(),
  batches: z
    .array(z.object({
      name: z.string().optional().default(''),
      species: z.string().optional().default('unknown'),
      qty: z.string().optional(),
      ageAtAcquire: z.string().optional(),
      cost: z.string().optional(),
      unitName: z.string().optional(),
      acquiredDate: z.string().optional(),
    }))
    .optional(),
  inventory: z
    .array(z.object({
      name: z.string().optional().default(''),
      category: z.string().optional().default('CONSUMABLE'),
      unit: z.string().optional().default('kg'),
      qty: z.string().optional(),
      unitCost: z.string().optional(),
    }))
    .optional(),
  employees: z
    .array(z.object({
      name: z.string().optional().default(''),
      phone: z.string().optional().default(''),
      role: z.string().optional().default('worker'),
      pin: z.string().optional(),
      salary: z.string().optional(),
      payDay: z.string().optional(),
    }))
    .optional(),
  mortalityRate: z.string().optional(),
  lowStockKg: z.string().optional(),
  mortalityPhotoThreshold: z.string().optional(),
});
