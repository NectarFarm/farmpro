// ============================================================
// data.ts — IFMS Single Source of Truth
// ============================================================
// This header used to be a map of nine mock arrays and which screens rendered
// them. That description is long out of date: every screen listed below now
// fetches its rows from a real API route, and the mock arrays that fed them
// (FARMS_DATA, BATCHES_DATA, TASKS_DATA, EMPLOYEES_DATA) have been deleted —
// see the notes where each one used to sit. Do not reintroduce one: a demo
// farm or a demo employee in a real account's screen is a bug this repo has
// already shipped and fixed more than once.
//
// What legitimately lives here now:
//   1. ENTERPRISE_REGISTRY  → UI CONFIG, not farm data: per enterprise type,
//      the icon, label, unit noun and code prefix. Drives CropScheduleScreen
//      (which processes to show), BatchDetailScreen (which metrics), and
//      WorkerRecordScreen (which forms). lib/codes.ts carries a server-safe
//      mirror of its `type` field, because this file is "use client".
//   2. CSV_TEMPLATES        → the header rows and example lines of the
//      downloadable import templates. Example values inside a template file
//      the user downloads are examples, and are labelled as such.
//   3. OWNER_ROLES          → the built-in role ids and their default
//      permission/approval matrix, read by csv-import.tsx for the list of
//      role names a CSV may name, and mirrored by PUT /api/role-permissions.
//   4. Interfaces           → shape documentation for the rows the API returns.
// ============================================================

'use client';

import { Drumstick, Egg, Ham, Milk, PawPrint, Fish, Wheat, Salad, Carrot, Apple, type LucideIcon } from './icons';

/* ── Auto-code generator ── */
const _counters: Record<string, number> = {};
export function genCode(prefix: string, farmCode: string): string {
  const key = `${prefix}-${farmCode}`;
  _counters[key] = (_counters[key] ?? 0) + 1;
  return `${prefix}-${farmCode}-${String(_counters[key]).padStart(3, '0')}`;
}

// Deterministic demo codes
export const CODES = {
  farms: ['FRM-KMU-001', 'FRM-KMU-002'],
  batches: {
    'BRO-KMU-022': { label: 'Broilers Oct Run', unit: 'HSE-KMU-A01' },
    'LYR-KMU-008': { label: 'Layers Batch 8', unit: 'PEN-KMU-B01' },
    'PIG-KMU-004': { label: 'Pig Fatteners Q4', unit: 'PPD-KMU-P01' },
    'COW-KMU-003': { label: 'Dairy Herd Batch 3', unit: 'PDD-KMU-D01' },
    'MZE-KMU-007': { label: 'Maize Field Oct', unit: 'FLD-KMU-F01' },
    'KIT-KMU-002': { label: 'Kale & Spinach Plot', unit: 'FLD-KMU-F02' },
  },
  tasks: ['TSK-KMU-0081', 'TSK-KMU-0082', 'TSK-KMU-0083', 'TSK-KMU-0084'],
  employees: ['EMP-KMU-001', 'EMP-KMU-002', 'EMP-KMU-003', 'EMP-KMU-004', 'EMP-KMU-005'],
};

/* ── Enterprise types ── */
export type EnterpriseType = 'livestock' | 'crop';
export type LivestockSubtype = 'broiler' | 'layer' | 'pig' | 'dairy_cow' | 'beef_cow' | 'goat' | 'sheep' | 'rabbit' | 'turkey' | 'duck' | 'fish';
export type CropSubtype = 'maize' | 'wheat' | 'sorghum' | 'kitchen_garden' | 'silage' | 'fruit_orchard' | 'vegetables' | 'legumes' | 'fodder';

export interface EnterpriseConfig {
  type: EnterpriseType;
  subtype: LivestockSubtype | CropSubtype;
  // Icon component (lucide, via ./icons — see components/farm/icons.tsx).
  // Was a raw emoji string; lucide has no Cow/Goat/Chicken glyphs, so
  // subtypes are represented by their product/output where a direct animal
  // icon doesn't exist (dairy_cow -> Milk, broiler -> Drumstick). Goat has no
  // close lucide match at all — PawPrint is used as the least-wrong stand-in:
  // a generic animal mark claims nothing false, where a Rabbit would read as
  // rabbits rather than goats
  // for "small four-legged livestock", picked over reusing Milk (would
  // collide with dairy_cow) or a food icon (would erase the animal/crop
  // distinction the registry otherwise keeps).
  icon: LucideIcon;
  label: string;
  unitName: string;
  batchPrefix: string;
  unitPrefix: string;
  metrics: string[];
  processes: ProcessTemplate[];
  harvestUnit?: string;
  harvestable?: boolean;
}

export interface ProcessTemplate {
  code: string;
  name: string;
  frequency: 'daily' | 'weekly' | 'on-demand' | 'seasonal';
  requiresApproval: boolean;
  // form type determines which WorkerRecordScreen form renders
  form: 'feeding' | 'mortality' | 'health' | 'collect' | 'weight' | 'count' | 'milking' | 'harvest' | 'spray' | 'weed';
}

export const ENTERPRISE_REGISTRY: EnterpriseConfig[] = [
  {
    type: 'livestock', subtype: 'broiler', icon: Drumstick, label: 'Broilers',
    unitName: 'House', batchPrefix: 'BRO', unitPrefix: 'HSE',
    metrics: ['head count', 'age (days)', 'FCR', 'mortality %', 'weight (kg)'],
    harvestable: true, harvestUnit: 'birds',
    processes: [
      { code: 'PRO-FED', name: 'Feeding', frequency: 'daily', requiresApproval: false, form: 'feeding' },
      { code: 'PRO-MOR', name: 'Mortality Record', frequency: 'daily', requiresApproval: true, form: 'mortality' },
      { code: 'PRO-WGT', name: 'Weight Sampling', frequency: 'weekly', requiresApproval: false, form: 'weight' },
      { code: 'PRO-VAC', name: 'Vaccination', frequency: 'on-demand', requiresApproval: true, form: 'health' },
      { code: 'PRO-CNT', name: 'Physical Count', frequency: 'weekly', requiresApproval: true, form: 'count' },
    ],
  },
  {
    type: 'livestock', subtype: 'layer', icon: Egg, label: 'Layers',
    unitName: 'Pen', batchPrefix: 'LYR', unitPrefix: 'PEN',
    metrics: ['head count', 'age (days)', 'egg production', 'lay rate %', 'mortality %'],
    harvestable: true, harvestUnit: 'trays',
    processes: [
      { code: 'PRO-FED', name: 'Feeding', frequency: 'daily', requiresApproval: false, form: 'feeding' },
      { code: 'PRO-EGG', name: 'Egg Collection', frequency: 'daily', requiresApproval: true, form: 'collect' },
      { code: 'PRO-MOR', name: 'Mortality Record', frequency: 'daily', requiresApproval: true, form: 'mortality' },
      { code: 'PRO-VAC', name: 'Vaccination', frequency: 'on-demand', requiresApproval: true, form: 'health' },
      { code: 'PRO-CNT', name: 'Physical Count', frequency: 'weekly', requiresApproval: true, form: 'count' },
    ],
  },
  {
    type: 'livestock', subtype: 'pig', icon: Ham, label: 'Pigs',
    unitName: 'Sty', batchPrefix: 'PIG', unitPrefix: 'STY',
    metrics: ['head count', 'age (days)', 'weight (kg)', 'FCR', 'mortality %'],
    harvestable: true, harvestUnit: 'kg liveweight',
    processes: [
      { code: 'PRO-FED', name: 'Feeding', frequency: 'daily', requiresApproval: false, form: 'feeding' },
      { code: 'PRO-MOR', name: 'Mortality Record', frequency: 'daily', requiresApproval: true, form: 'mortality' },
      { code: 'PRO-WGT', name: 'Weight Sampling', frequency: 'weekly', requiresApproval: false, form: 'weight' },
      { code: 'PRO-VAC', name: 'Treatment/Vaccine', frequency: 'on-demand', requiresApproval: true, form: 'health' },
    ],
  },
  {
    type: 'livestock', subtype: 'dairy_cow', icon: Milk, label: 'Dairy Cattle',
    unitName: 'Paddock', batchPrefix: 'COW', unitPrefix: 'PAD',
    metrics: ['head count', 'age', 'daily milk (L)', 'lactation stage', 'BCS score'],
    harvestable: true, harvestUnit: 'litres',
    processes: [
      { code: 'PRO-MLK', name: 'Milking', frequency: 'daily', requiresApproval: true, form: 'milking' },
      { code: 'PRO-FED', name: 'Feeding / Grazing', frequency: 'daily', requiresApproval: false, form: 'feeding' },
      { code: 'PRO-HLT', name: 'Health Check', frequency: 'weekly', requiresApproval: false, form: 'health' },
      { code: 'PRO-VAC', name: 'Vaccination', frequency: 'on-demand', requiresApproval: true, form: 'health' },
    ],
  },
  {
    type: 'livestock', subtype: 'goat', icon: PawPrint, label: 'Goats',
    unitName: 'Pen', batchPrefix: 'GOT', unitPrefix: 'PEN',
    metrics: ['head count', 'age', 'daily milk (L)', 'weight (kg)', 'mortality %'],
    harvestable: true, harvestUnit: 'litres',
    processes: [
      { code: 'PRO-MLK', name: 'Milking', frequency: 'daily', requiresApproval: true, form: 'milking' },
      { code: 'PRO-FED', name: 'Feeding', frequency: 'daily', requiresApproval: false, form: 'feeding' },
      { code: 'PRO-VAC', name: 'Vaccination', frequency: 'on-demand', requiresApproval: true, form: 'health' },
    ],
  },
  {
    type: 'livestock', subtype: 'fish', icon: Fish, label: 'Fish / Aquaculture',
    unitName: 'Tank/Pond', batchPrefix: 'FSH', unitPrefix: 'TNK',
    metrics: ['stocking density', 'age (days)', 'water temp (°C)', 'DO (mg/L)', 'mortality %'],
    harvestable: true, harvestUnit: 'kg',
    processes: [
      { code: 'PRO-FED', name: 'Feeding', frequency: 'daily', requiresApproval: false, form: 'feeding' },
      { code: 'PRO-WQT', name: 'Water Quality', frequency: 'daily', requiresApproval: false, form: 'health' },
      { code: 'PRO-MOR', name: 'Mortality Record', frequency: 'daily', requiresApproval: true, form: 'mortality' },
    ],
  },
  {
    type: 'crop', subtype: 'maize', icon: Wheat, label: 'Maize',
    unitName: 'Field', batchPrefix: 'MZE', unitPrefix: 'FLD',
    metrics: ['area (acres)', 'plant stand', 'growth stage', 'expected yield (bags)'],
    harvestable: true, harvestUnit: '90kg bags',
    processes: [
      { code: 'PRO-PLT', name: 'Planting', frequency: 'seasonal', requiresApproval: false, form: 'harvest' },
      { code: 'PRO-SPR', name: 'Fertiliser/Spraying', frequency: 'on-demand', requiresApproval: true, form: 'spray' },
      { code: 'PRO-WED', name: 'Weeding', frequency: 'on-demand', requiresApproval: false, form: 'weed' },
      { code: 'PRO-HVT', name: 'Harvest', frequency: 'seasonal', requiresApproval: true, form: 'harvest' },
    ],
  },
  {
    type: 'crop', subtype: 'kitchen_garden', icon: Salad, label: 'Kitchen Garden',
    unitName: 'Plot', batchPrefix: 'KIT', unitPrefix: 'PLT',
    metrics: ['area (sqm)', 'crop varieties', 'watering schedule', 'harvest frequency'],
    harvestable: true, harvestUnit: 'kg',
    processes: [
      { code: 'PRO-WTR', name: 'Watering', frequency: 'daily', requiresApproval: false, form: 'weed' },
      { code: 'PRO-WED', name: 'Weeding', frequency: 'weekly', requiresApproval: false, form: 'weed' },
      { code: 'PRO-HVT', name: 'Harvest', frequency: 'on-demand', requiresApproval: true, form: 'harvest' },
    ],
  },
  {
    type: 'crop', subtype: 'vegetables', icon: Carrot, label: 'Vegetables',
    unitName: 'Plot', batchPrefix: 'VEG', unitPrefix: 'PLT',
    metrics: ['area (sqm)', 'variety mix', 'growth stage', 'yield (kg)'],
    harvestable: true, harvestUnit: 'kg',
    processes: [
      { code: 'PRO-WTR', name: 'Watering', frequency: 'daily', requiresApproval: false, form: 'weed' },
      { code: 'PRO-SPR', name: 'Pesticide Spray', frequency: 'on-demand', requiresApproval: true, form: 'spray' },
      { code: 'PRO-HVT', name: 'Harvest', frequency: 'on-demand', requiresApproval: true, form: 'harvest' },
    ],
  },
  {
    type: 'crop', subtype: 'fruit_orchard', icon: Apple, label: 'Fruit Orchard',
    unitName: 'Block', batchPrefix: 'FRT', unitPrefix: 'BLK',
    metrics: ['tree count', 'age (years)', 'variety', 'expected yield (kg)'],
    harvestable: true, harvestUnit: 'kg',
    processes: [
      { code: 'PRO-SPR', name: 'Spray Programme', frequency: 'weekly', requiresApproval: true, form: 'spray' },
      { code: 'PRO-HVT', name: 'Harvest', frequency: 'seasonal', requiresApproval: true, form: 'harvest' },
    ],
  },
];

/* ── Products & Pricing ── */
// Products are priced outputs from a batch.
// Each product has a price history with start/end dates so
// FinanceScreen and Reports always use the correct price for each sale period.
export interface ProductPrice {
  price: number;          // per unit
  unit: string;           // "tray", "kg", "litre", "bird", "bag"
  currency: string;
  startDate: string;      // ISO date — price valid from
  endDate?: string;       // ISO date — undefined means still current
  notes?: string;
}

export interface Product {
  id: string;             // PRD-KMU-001
  name: string;
  emoji: string;          // editable by user
  batchCode?: string;     // which batch produces this product (undefined = farm-level)
  farmCode: string;
  enterprise: string;     // subtype eg "layer"
  priceHistory: ProductPrice[];
}

export function getCurrentPrice(product: Product, onDate?: string): ProductPrice | null {
  const d = onDate ?? new Date().toISOString().slice(0, 10);
  const valid = product.priceHistory
    .filter(p => p.startDate <= d && (!p.endDate || p.endDate >= d))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return valid[0] ?? null;
}

/* ── Multi-Farm ── */
export interface Farm {
  code: string;
  name: string;
  location: string;         // human-readable e.g. "Nakuru, Kenya"
  address?: string;         // full street/postal address (optional during setup)
  lat?: number;             // GPS latitude (optional — set via map pin)
  lng?: number;             // GPS longitude
  size: string;
  owner: string;
  enterprises: string[];
  employees: number;
  maxEmployees: number;
  plan: 'Trial' | 'Basic' | 'Pro';
  status: 'active' | 'suspended' | 'trial';
  createdAt: string;
}

// (FARMS_DATA — two demo farms ("Nakuru Main Farm" / "Eldoret Satellite Farm", owner "James Kamau", plan "Pro") — was deleted by the setup-sequence
// task. Nothing imported it any more: every screen that once read it now
// fetches the real rows (see this file's header). It survived as dead code one
// `import` away from putting somebody else's farm back on a real account's
// screen, which is exactly the bug the surviving comments elsewhere in this
// repo describe. The `Farm` interface above stays — it still documents the
// shape, and removing a type costs nothing but explains less.)


/* ── Employees ── */
export interface Employee {
  code: string;
  name: string;
  role: string;           // maps to an OwnerRole.id
  phone: string;
  salary: number;
  payday: number;
  active: boolean;
  farmCode: string;
  startDate: string;
  endDate?: string;
  batches: string[];
  pin: string | null;
  customRole?: string;
  permissions?: Record<string, 'edit' | 'view' | 'hidden'>; // override if needed
}

// (EMPLOYEES_DATA — six invented employees with names, phone numbers and salaries — was deleted by the setup-sequence
// task. Nothing imported it any more: every screen that once read it now
// fetches the real rows (see this file's header). It survived as dead code one
// `import` away from putting somebody else's farm back on a real account's
// screen, which is exactly the bug the surviving comments elsewhere in this
// repo describe. The `Employee` interface above stays — it still documents the
// shape, and removing a type costs nothing but explains less.)


/* ── Batches ── */
export interface Batch {
  code: string;
  label: string;
  enterprise: LivestockSubtype | CropSubtype;
  farmCode: string;
  unitCode: string;
  qty: number;
  initialQty: number;
  startDate: string;
  endDate?: string;
  harvestDate?: string;
  status: 'ACTIVE' | 'QUARANTINE' | 'CLOSED' | 'HARVESTED';
  stage: string;
  cost: number;
  notes?: string;
  // Transfer fields — when animals/produce move from one unit to another mid-batch
  transferDate?: string;       // effective date of unit transfer
  transferToUnitCode?: string; // destination unit code (e.g. "PEN-KMU-B02")
  transferNotes?: string;
  // configurable processes — each key is ProcessTemplate.code, value = enabled
  processConfig?: Record<string, boolean>;
  // custom additional processes added by the owner
  customProcesses?: ProcessTemplate[];
}

// (BATCHES_DATA — invented batches with headcounts and acquisition costs — was deleted by the setup-sequence
// task. Nothing imported it any more: every screen that once read it now
// fetches the real rows (see this file's header). It survived as dead code one
// `import` away from putting somebody else's farm back on a real account's
// screen, which is exactly the bug the surviving comments elsewhere in this
// repo describe. The `Batch` interface above stays — it still documents the
// shape, and removing a type costs nothing but explains less.)


/* ── Owner-defined Roles ── */
// Roles are created/edited in GovernanceScreen > Role Builder tab.
// Each employee.role maps to an OwnerRole.id.
// PeopleScreen uses this to show/assign roles.
export interface OwnerRole {
  id: string;
  name: string;
  color: string;
  permissions: Record<string, 'edit' | 'view' | 'hidden'>;
  approvalRequired: string[];
  canApproveFor: string[];
}

export const OWNER_ROLES: OwnerRole[] = [
  {
    id: 'manager', name: 'Farm Manager', color: 'var(--accent-purple)',
    permissions: {
      'feeding': 'edit', 'egg-collection': 'edit', 'mortality': 'edit',
      'health': 'edit', 'physical-count': 'edit', 'tasks': 'edit',
      'inventory': 'view', 'finance': 'view', 'payroll': 'hidden', 'governance': 'hidden',
    },
    approvalRequired: ['delete-record', 'variance-adjustment'],
    canApproveFor: ['feeding', 'egg-collection', 'mortality'],
  },
  {
    id: 'worker', name: 'Farm Worker', color: 'var(--primary-green)',
    permissions: {
      'feeding': 'edit', 'egg-collection': 'edit', 'mortality': 'edit',
      'health': 'view', 'physical-count': 'edit', 'tasks': 'view',
      'inventory': 'hidden', 'finance': 'hidden', 'payroll': 'hidden', 'governance': 'hidden',
    },
    approvalRequired: ['egg-collection', 'mortality', 'physical-count', 'harvest'],
    canApproveFor: [],
  },
  {
    id: 'vet', name: 'Veterinarian', color: 'var(--accent-cyan)',
    permissions: {
      'feeding': 'hidden', 'health': 'edit', 'mortality': 'view',
      'physical-count': 'hidden', 'tasks': 'view', 'inventory': 'view',
      'finance': 'hidden', 'payroll': 'hidden', 'governance': 'hidden',
    },
    approvalRequired: [],
    canApproveFor: ['health', 'vaccination'],
  },
  {
    id: 'harvest_lead', name: 'Harvest Lead', color: 'var(--accent-amber)',
    permissions: {
      'feeding': 'hidden', 'harvest': 'edit', 'physical-count': 'edit',
      'tasks': 'view', 'inventory': 'view', 'finance': 'hidden',
      'payroll': 'hidden', 'governance': 'hidden',
    },
    approvalRequired: ['harvest'],
    canApproveFor: [],
  },
];

/* ── Tasks ── */
// Tasks flow: Created by Owner/Manager → assigned to Employee → Worker marks done
// If requiresApproval=true: worker submit → creates ApprovalRequest → Owner approves
// → Notification sent → Task status updated to APPROVED/REJECTED
export interface Task {
  code: string;
  title: string;
  type: string;
  assigneeCode: string;      // "GROUP:<roleId>" for group tasks e.g. "GROUP:worker"
  assigneeName: string;      // "All Workers" / "All Harvest Leads" etc.
  farmCode: string;
  batchCode?: string;
  unitCode?: string;         // specific unit within the batch e.g. "HSE-KMU-A01"
  location?: string;
  lat?: number;              // GPS pin for the task location
  lng?: number;
  startDate: string;
  endDate?: string;
  dueTime?: string;
  frequency: 'once' | 'daily' | 'weekly' | 'on-demand';
  status: 'PENDING' | 'DONE' | 'OVERDUE' | 'APPROVED' | 'REJECTED';
  requiresApproval: boolean;
  priority: 'high' | 'medium' | 'low';
  notes?: string;
  // Photo evidence settings (set by creator)
  maxPhotos?: number;        // 0 = none allowed, undefined = unlimited, 1-10 = limit
  photos?: { id: string; dataUrl: string; takenAt: string; takenBy: string }[];
  // External/casual workers — names captured separately, CSV-invited
  externalWorkers?: { name: string; phone?: string; portion?: string }[];
}

// (TASKS_DATA — invented tasks assigned to invented people — was deleted by the setup-sequence
// task. Nothing imported it any more: every screen that once read it now
// fetches the real rows (see this file's header). It survived as dead code one
// `import` away from putting somebody else's farm back on a real account's
// screen, which is exactly the bug the surviving comments elsewhere in this
// repo describe. The `Task` interface above stays — it still documents the
// shape, and removing a type costs nothing but explains less.)


/* ── Approval Requests ── */
// When a worker submits a task that requiresApproval=true, an ApprovalRequest is created.
// Owner approves/rejects/holds in GovernanceScreen.
// On status change, pushNotification() is called → adds to NOTIFICATIONS_DATA.
export interface ApprovalRequest {
  code: string;
  type: string;
  title: string;
  requestedByCode: string;
  requestedByName: string;
  batchCode?: string;
  farmCode: string;
  amount?: number;
  details: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'held';
  priority: 'high' | 'medium' | 'low';
  evidencePhoto?: boolean;
}

export interface Notification {
  id: string;
  type: 'weather' | 'alert' | 'approval' | 'task' | 'system';
  title: string;
  body: string;
  time: string;
  read: boolean;
  farmCode?: string;
  sourceCode?: string; // APR code, TSK code etc for deep linking
}

export interface OnboardRequest {
  id: string;
  farmerName: string;
  email: string;
  phone: string;
  farmName: string;
  location: string;          // general area e.g. "Nakuru, Kenya"
  address?: string;          // full address (optional — can be added later by admin)
  lat?: number;              // GPS pin (optional)
  lng?: number;
  enterprises: string[];
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'info-needed';
  notes?: string;
}

export const CSV_TEMPLATES: Record<string, { cols: string[]; example: string[] }> = {
  employees: {
    cols: ['code','name','role','phone','salary','payday','startDate','endDate','batches','active'],
    example: ['EMP-KMU-007','Jane Doe','worker','+254-700-000-001','16000','28','2026-08-15','','BRO-KMU-022','true'],
  },
  tasks: {
    cols: ['code','title','type','assigneeCode','batchCode','unitCode','location','lat','lng','startDate','endDate','dueTime','frequency','requiresApproval','priority','maxPhotos','notes'],
    example: ['TSK-KMU-0086','Feeding – Evening','feeding','EMP-KMU-002','BRO-KMU-022','HSE-KMU-A01','House A01','','','2026-08-12','2026-12-31','17:00','daily','false','high','3','Check water too'],
  },
  external_workers: {
    cols: ['taskCode','name','phone','email','portion','idNumber'],
    example: ['TSK-KMU-0085','John Otieno','+254-700-555-666','','Rows 9–12','12345678'],
  },
  inventory: {
    cols: ['id','name','category','unit','qty','reorder','costPerUnit','lotNumber','expiryDate'],
    example: ['F004','Broiler Finisher','Feed','kg','800','300','55','LOT-2026-049',''],
  },
};

export function downloadCSV(template: keyof typeof CSV_TEMPLATES) {
  const t = CSV_TEMPLATES[template];
  const rows = [t.cols.join(','), t.example.join(',')];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `ifms_${template}_template.csv`; a.click();
  URL.revokeObjectURL(url);
}
