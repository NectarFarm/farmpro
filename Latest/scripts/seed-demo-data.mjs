// ── Demo operating data (farms, units, batches, staff, stock, money) ────────
// db/seed.mjs creates only tenants, users and farms — enough to sign in, not
// enough to SEE anything. This fills the app with plausible operating data so
// the screens and KPIs have something to show.
//
// Deliberately lopsided between the two farms: Nakuru (f1) is the main site
// and Eldoret (f2) a smaller satellite. That asymmetry is the point — it makes
// the farm switcher visibly change every number instead of leaving you
// guessing whether the filter did anything.
//
// Idempotent: every row uses a fixed `demo-` id and ON CONFLICT DO NOTHING, so
// re-running adds nothing. Pass --reset to delete the demo rows first.
//
//   node scripts/seed-demo-data.mjs [--reset]
//
// Money units follow the schema, which is not uniform: `sales.amount` is whole
// shillings, while `purchases.*_cents` and `batches.acquisition_cost_cents`
// are minor units. See lib/finance.ts.
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:ifms@localhost:55433/ifms'
const sql = postgres(DATABASE_URL, { prepare: false })

const T = 't1'
const F1 = 'f1' // Nakuru Main Farm
const F2 = 'f2' // Eldoret Satellite

const daysAgo = (n) => new Date(Date.now() - n * 86400000)
const daysAhead = (n) => new Date(Date.now() + n * 86400000)

const UNITS = [
  { id: 'demo-u1', farm: F1, type: 'livestock', name: 'Layer Pen A',     code: 'PEN-A' },
  { id: 'demo-u2', farm: F1, type: 'livestock', name: 'Broiler House B', code: 'HSE-B' },
  { id: 'demo-u3', farm: F1, type: 'crop',      name: 'Maize Field 1',   code: 'FLD-1' },
  { id: 'demo-u4', farm: F2, type: 'livestock', name: 'Dairy Shed',      code: 'SHD-1' },
  { id: 'demo-u5', farm: F2, type: 'crop',      name: 'Maize Field 2',   code: 'FLD-2' },
]

const BATCHES = [
  { id: 'demo-b1', unit: 'demo-u1', code: 'LYR-2401', name: 'Layers Jan',    species: 'chicken', enterprise: 'layer',     stage: 'laying',     init: 2000, cur: 1938, cost: 180000000, start: 120 },
  { id: 'demo-b2', unit: 'demo-u2', code: 'BRO-2402', name: 'Broilers Feb',  species: 'chicken', enterprise: 'broiler',   stage: 'finishing',  init: 1500, cur: 1461, cost: 105000000, start: 34 },
  { id: 'demo-b3', unit: 'demo-u3', code: 'MZE-2401', name: 'Maize Long Rains', species: 'maize', enterprise: 'maize',    stage: 'vegetative', init: 1,    cur: 1,    cost: 42000000,  start: 60 },
  { id: 'demo-b4', unit: 'demo-u4', code: 'DRY-2401', name: 'Dairy Herd',    species: 'cattle',  enterprise: 'dairy_cow', stage: 'lactating',  init: 42,   cur: 41,   cost: 260000000, start: 300 },
  { id: 'demo-b5', unit: 'demo-u5', code: 'MZE-2402', name: 'Maize Satellite', species: 'maize', enterprise: 'maize',     stage: 'vegetative', init: 1,    cur: 1,    cost: 18000000,  start: 55 },
]

const EMPLOYEES = [
  { id: 'demo-e1', farm: F1, name: 'John Kamau',     phone: '+254712345001', role: 'worker',     batches: ['demo-b1', 'demo-b2'] },
  { id: 'demo-e2', farm: F1, name: 'Mary Wanjiru',   phone: '+254712345010', role: 'worker',     batches: ['demo-b1'] },
  { id: 'demo-e3', farm: F1, name: 'Peter Njoroge',  phone: '+254712345011', role: 'supervisor', batches: ['demo-b3'] },
  { id: 'demo-e4', farm: F2, name: 'Grace Atieno',   phone: '+254712345012', role: 'worker',     batches: ['demo-b4'] },
  { id: 'demo-e5', farm: F2, name: 'Samuel Kiptoo',  phone: '+254712345013', role: 'worker',     batches: ['demo-b5'] },
]

const TASKS = [
  { id: 'demo-t1', farm: F1, title: 'Vaccinate layer pen A',        due: -3, status: 'PENDING', priority: 'high' },
  { id: 'demo-t2', farm: F1, title: 'Repair broiler house feeder',  due: -1, status: 'PENDING', priority: 'high' },
  { id: 'demo-t3', farm: F1, title: 'Weekly egg count',             due: 1,  status: 'PENDING', priority: 'medium' },
  { id: 'demo-t4', farm: F1, title: 'Top-dress maize field 1',      due: 4,  status: 'PENDING', priority: 'low' },
  { id: 'demo-t5', farm: F1, title: 'Restock layer mash',           due: 2,  status: 'DONE',    priority: 'medium' },
  { id: 'demo-t6', farm: F2, title: 'Milk recording — dairy shed',  due: 0,  status: 'PENDING', priority: 'high' },
  { id: 'demo-t7', farm: F2, title: 'Fence check, maize field 2',   due: 6,  status: 'PENDING', priority: 'low' },
]

const ITEMS = [
  { id: 'demo-i1', name: 'Layer Mash',      category: 'Feed',      unit: 'kg',   low: 200 },
  { id: 'demo-i2', name: 'Broiler Starter', category: 'Feed',      unit: 'kg',   low: 150 },
  { id: 'demo-i3', name: 'Newcastle Vaccine', category: 'Vet',     unit: 'dose', low: 100 },
  { id: 'demo-i4', name: 'Dairy Meal',      category: 'Feed',      unit: 'kg',   low: 120 },
  { id: 'demo-i5', name: 'CAN Fertiliser',  category: 'Agro',      unit: 'kg',   low: 80 },
]

const LOTS = [
  { id: 'demo-l1', farm: F1, item: 'demo-i1', lot: 'LM-2401', qty: 850, cost: 6200,  recv: 20 },
  { id: 'demo-l2', farm: F1, item: 'demo-i2', lot: 'BS-2402', qty: 120, cost: 7100,  recv: 12 },
  { id: 'demo-l3', farm: F1, item: 'demo-i3', lot: 'NV-2401', qty: 60,  cost: 3500,  recv: 30 },
  { id: 'demo-l4', farm: F1, item: 'demo-i5', lot: 'CN-2401', qty: 300, cost: 5400,  recv: 45 },
  { id: 'demo-l5', farm: F2, item: 'demo-i4', lot: 'DM-2401', qty: 90,  cost: 6800,  recv: 15 },
  { id: 'demo-l6', farm: F2, item: 'demo-i5', lot: 'CN-2402', qty: 140, cost: 5400,  recv: 25 },
]

const PURCHASES = [
  { id: 'demo-p1', farm: F1, supplier: 'Unga Feeds Ltd',   item: 'demo-i1', qty: 1000, unit: 6200, paid: 6200000,  method: 'mpesa', at: 20 },
  { id: 'demo-p2', farm: F1, supplier: 'Agrovet Nakuru',   item: 'demo-i3', qty: 100,  unit: 3500, paid: 350000,   method: 'cash',  at: 30 },
  { id: 'demo-p3', farm: F1, supplier: 'Coopers Kenya',    item: 'demo-i5', qty: 400,  unit: 5400, paid: 1080000,  method: 'bank',  at: 45 },
  { id: 'demo-p4', farm: F2, supplier: 'Eldoret Agrovet',  item: 'demo-i4', qty: 150,  unit: 6800, paid: 1020000,  method: 'mpesa', at: 15 },
]

// sales.amount is WHOLE shillings (not cents) — see lib/finance.ts.
const SALES = [
  { id: 'demo-s1', batch: 'demo-b1', item: 'Eggs — 210 trays',   amount: 73500,  method: 'mpesa', status: 'paid',    at: 3 },
  { id: 'demo-s2', batch: 'demo-b1', item: 'Eggs — 190 trays',   amount: 66500,  method: 'mpesa', status: 'paid',    at: 10 },
  { id: 'demo-s3', batch: 'demo-b1', item: 'Eggs — 205 trays',   amount: 71750,  method: 'cash',  status: 'paid',    at: 17 },
  { id: 'demo-s4', batch: 'demo-b2', item: 'Broilers — 400 birds', amount: 152000, method: 'bank', status: 'paid',   at: 6 },
  { id: 'demo-s5', batch: 'demo-b2', item: 'Broilers — 250 birds', amount: 95000,  method: 'mpesa', status: 'pending', at: 1 },
  { id: 'demo-s6', batch: 'demo-b3', item: 'Maize — 40 bags',    amount: 128000, method: 'bank',  status: 'paid',    at: 25 },
  { id: 'demo-s7', batch: 'demo-b4', item: 'Milk — 1,800 L',     amount: 90000,  method: 'mpesa', status: 'paid',    at: 4 },
  { id: 'demo-s8', batch: 'demo-b4', item: 'Milk — 1,650 L',     amount: 82500,  method: 'mpesa', status: 'paid',    at: 12 },
  { id: 'demo-s9', batch: 'demo-b5', item: 'Maize — 12 bags',    amount: 38400,  method: 'cash',  status: 'paid',    at: 28 },
]

// Only 'feeding' | 'mortality' | 'physical_count' are accepted (see
// app/api/records/route.ts). Mortality rows drive the mortality % KPI.
const RECORDS = [
  { id: 'demo-r1', batch: 'demo-b1', emp: 'demo-e1', type: 'mortality',      data: { deaths: 4, cause: 'heat stress' }, at: 5 },
  { id: 'demo-r2', batch: 'demo-b1', emp: 'demo-e2', type: 'feeding',        data: { kg: 180, feed: 'Layer Mash' },     at: 1 },
  { id: 'demo-r3', batch: 'demo-b2', emp: 'demo-e1', type: 'mortality',      data: { deaths: 9, cause: 'culled' },      at: 7 },
  { id: 'demo-r4', batch: 'demo-b2', emp: 'demo-e1', type: 'feeding',        data: { kg: 220, feed: 'Broiler Starter' },at: 1 },
  { id: 'demo-r5', batch: 'demo-b1', emp: 'demo-e2', type: 'physical_count', data: { counted: 1938 },                   at: 2 },
  { id: 'demo-r6', batch: 'demo-b4', emp: 'demo-e4', type: 'mortality',      data: { deaths: 1, cause: 'illness' },     at: 9 },
  { id: 'demo-r7', batch: 'demo-b4', emp: 'demo-e4', type: 'feeding',        data: { kg: 95, feed: 'Dairy Meal' },      at: 1 },
]

// One tied to a farm's batch, one tenant-level with no batch — the null-batch
// case is why farm filtering keeps batch-less approvals visible.
const APPROVALS = [
  { id: 'demo-a1', type: 'mortality', title: 'Mortality record — Broilers Feb (9 birds)', by: 'John Kamau',   batch: 'demo-b2', entity: 'demo-r3', details: 'Above the photo threshold; needs sign-off.', priority: 'high',   at: 7 },
  { id: 'demo-a2', type: 'expense',   title: 'Fuel advance — KSh 8,000',                   by: 'Peter Njoroge', batch: null,      entity: 'demo-x1', details: 'Tenant-level request, not tied to a batch.',  priority: 'medium', at: 2 },
]

const NOTIFS = [
  { id: 'demo-n1', src: 'alert',    sid: 'demo-l2', title: 'Low stock: Broiler Starter', msg: '120 kg left, below the 150 kg threshold.', at: 1 },
  { id: 'demo-n2', src: 'approval', sid: 'demo-a1', title: 'Approval needed',            msg: 'Mortality record for Broilers Feb.',       at: 7 },
  { id: 'demo-n3', src: 'task',     sid: 'demo-t1', title: 'Task overdue',               msg: 'Vaccinate layer pen A was due 3 days ago.', at: 3 },
]

const PRODUCTS = [
  { id: 'demo-pr1', type: 'livestock', name: 'Eggs (tray)',      units: 210 },
  { id: 'demo-pr2', type: 'livestock', name: 'Broiler (bird)',   units: 650 },
  { id: 'demo-pr3', type: 'livestock', name: 'Milk (litre)',     units: 3450 },
  { id: 'demo-pr4', type: 'crop',      name: 'Maize (90kg bag)', units: 52 },
]

// Which units offer which products (product-unit-inheritance task). Note
// demo-pr4 is attached to BOTH maize fields — one product shared across two
// units on two different farms, which is the whole point of a tenant-level
// catalogue. Batches under these units inherit these products with no rows of
// their own.
const PRODUCT_UNITS = [
  { id: 'demo-pu1', product: 'demo-pr1', unit: 'demo-u1' }, // Eggs      -> Layer Pen A
  { id: 'demo-pu2', product: 'demo-pr2', unit: 'demo-u2' }, // Broiler   -> Broiler House B
  { id: 'demo-pu3', product: 'demo-pr4', unit: 'demo-u3' }, // Maize bag -> Maize Field 1  (Nakuru)
  { id: 'demo-pu4', product: 'demo-pr4', unit: 'demo-u5' }, // Maize bag -> Maize Field 2  (Eldoret) — shared
  { id: 'demo-pu5', product: 'demo-pr3', unit: 'demo-u4' }, // Milk      -> Dairy Shed
]

// The two override cases, so both are visible in the UI rather than only the
// happy path: one batch sells something its unit does not (spent layers going
// out as meat), and one batch drops an inherited product it genuinely has no
// use for.
const BATCH_PRODUCTS = [
  { id: 'demo-bp1', batch: 'demo-b1', product: 'demo-pr2', mode: 'ADD' },     // Layers Jan also sells spent hens
  { id: 'demo-bp2', batch: 'demo-b5', product: 'demo-pr4', mode: 'EXCLUDE' }, // Satellite maize is cut for silage
]

async function reset() {
  // Child rows first — records/sales/approvals reference batches.
  for (const t of ['batch_products', 'product_units',
                   'records', 'sales', 'approval_requests', 'notifications', 'purchases',
                   'inventory_lots', 'inventory_items', 'tasks', 'employees', 'products',
                   'batches', 'production_units']) {
    await sql`DELETE FROM ${sql(t)} WHERE id LIKE 'demo-%'`
  }
  console.log('demo rows cleared')
}

async function main() {
  if (process.argv.includes('--reset')) await reset()

  for (const u of UNITS) {
    await sql`INSERT INTO production_units (id, tenant_id, farm_id, type, name, code, status)
      VALUES (${u.id}, ${T}, ${u.farm}, ${u.type}, ${u.name}, ${u.code}, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING`
  }
  for (const b of BATCHES) {
    await sql`INSERT INTO batches (id, tenant_id, unit_id, code, name, species, enterprise, stage, status,
        initial_qty, current_qty, acquisition_cost_cents, start_date)
      VALUES (${b.id}, ${T}, ${b.unit}, ${b.code}, ${b.name}, ${b.species}, ${b.enterprise}, ${b.stage}, 'ACTIVE',
        ${b.init}, ${b.cur}, ${b.cost}, ${daysAgo(b.start)})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const e of EMPLOYEES) {
    await sql`INSERT INTO employees (id, tenant_id, name, phone, role, assigned_batch_ids,
        mortality_photo_threshold, status, farm_id)
      VALUES (${e.id}, ${T}, ${e.name}, ${e.phone}, ${e.role}, ${e.batches}, 5, 'ACTIVE', ${e.farm})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const t of TASKS) {
    await sql`INSERT INTO tasks (id, tenant_id, title, due_at, status, priority, requires_approval, farm_id)
      VALUES (${t.id}, ${T}, ${t.title}, ${daysAhead(t.due)}, ${t.status}, ${t.priority}, false, ${t.farm})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const i of ITEMS) {
    await sql`INSERT INTO inventory_items (id, tenant_id, name, category, unit, low_stock_threshold)
      VALUES (${i.id}, ${T}, ${i.name}, ${i.category}, ${i.unit}, ${i.low})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const l of LOTS) {
    await sql`INSERT INTO inventory_lots (id, tenant_id, item_id, lot_no, qty_on_hand, unit_cost_cents, received_date, farm_id)
      VALUES (${l.id}, ${T}, ${l.item}, ${l.lot}, ${l.qty}, ${l.cost}, ${daysAgo(l.recv)}, ${l.farm})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const p of PURCHASES) {
    await sql`INSERT INTO purchases (id, tenant_id, supplier, item_id, quantity, unit_cost_cents,
        total_cost_cents, payment_method, amount_paid_cents, created_at, farm_id)
      VALUES (${p.id}, ${T}, ${p.supplier}, ${p.item}, ${p.qty}, ${p.unit},
        ${p.qty * p.unit}, ${p.method}, ${p.paid}, ${daysAgo(p.at)}, ${p.farm})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const s of SALES) {
    await sql`INSERT INTO sales (id, tenant_id, batch_id, item, amount, method, status, sold_at, created_at)
      VALUES (${s.id}, ${T}, ${s.batch}, ${s.item}, ${s.amount}, ${s.method}, ${s.status}, ${daysAgo(s.at)}, ${daysAgo(s.at)})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const r of RECORDS) {
    await sql`INSERT INTO records (id, tenant_id, batch_id, employee_id, type, data, created_at)
      VALUES (${r.id}, ${T}, ${r.batch}, ${r.emp}, ${r.type}, ${sql.json(r.data)}, ${daysAgo(r.at)})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const a of APPROVALS) {
    await sql`INSERT INTO approval_requests (id, tenant_id, type, title, requested_by, batch_id, entity_id,
        details, requested_at, status, priority)
      VALUES (${a.id}, ${T}, ${a.type}, ${a.title}, ${a.by}, ${a.batch}, ${a.entity},
        ${a.details}, ${daysAgo(a.at)}, 'pending', ${a.priority})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const n of NOTIFS) {
    await sql`INSERT INTO notifications (id, tenant_id, source_type, source_id, title, message, read, created_at)
      VALUES (${n.id}, ${T}, ${n.src}, ${n.sid}, ${n.title}, ${n.msg}, false, ${daysAgo(n.at)})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const p of PRODUCTS) {
    await sql`INSERT INTO products (id, tenant_id, type, name, sale_units)
      VALUES (${p.id}, ${T}, ${p.type}, ${p.name}, ${p.units})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const pu of PRODUCT_UNITS) {
    await sql`INSERT INTO product_units (id, tenant_id, product_id, unit_id)
      VALUES (${pu.id}, ${T}, ${pu.product}, ${pu.unit})
      ON CONFLICT (id) DO NOTHING`
  }
  for (const bp of BATCH_PRODUCTS) {
    await sql`INSERT INTO batch_products (id, tenant_id, batch_id, product_id, mode)
      VALUES (${bp.id}, ${T}, ${bp.batch}, ${bp.product}, ${bp.mode})
      ON CONFLICT (id) DO NOTHING`
  }

  const [{ count: units }] = await sql`SELECT count(*)::int FROM production_units WHERE id LIKE 'demo-%'`
  const [{ count: batches }] = await sql`SELECT count(*)::int FROM batches WHERE id LIKE 'demo-%'`
  const [{ count: sales }] = await sql`SELECT count(*)::int FROM sales WHERE id LIKE 'demo-%'`
  console.log(`demo data ready: ${units} units, ${batches} batches, ${sales} sales, ` +
    `${EMPLOYEES.length} staff, ${TASKS.length} tasks, ${LOTS.length} stock lots, ${PURCHASES.length} purchases, ` +
    `${PRODUCTS.length} products across ${PRODUCT_UNITS.length} unit links + ${BATCH_PRODUCTS.length} batch overrides`)
}

try { await main() } catch (err) { console.error('demo seed failed:', err); process.exitCode = 1 } finally { await sql.end() }
