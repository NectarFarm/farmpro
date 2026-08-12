// ============================================================
// data.ts — IFMS Single Source of Truth
// ============================================================
// Data flow overview:
//   1. ENTERPRISE_REGISTRY  → drives CropScheduleScreen (what processes to show),
//      BatchDetailScreen (metrics/KPIs), WorkerRecordScreen (which forms to show)
//   2. BATCHES_DATA         → filtered by activeFarm in NavProvider,
//      used by DashboardScreen, CropsScreen, FinanceScreen
//   3. TASKS_DATA           → shown in TasksScreen, DashboardScreen today strip,
//      WorkerHomeScreen; approval tasks feed APPROVALS_DATA
//   4. APPROVALS_DATA       → shown in GovernanceScreen; on approve/reject
//      a NOTIFICATION is appended and shown in NotificationsScreen
//   5. NOTIFICATIONS_DATA   → badge count in BottomNav; full list in NotificationsScreen
//   6. EMPLOYEES_DATA       → used by PeopleScreen, TasksScreen (assignee picker),
//      WorkerProfileScreen; role maps to OWNER_ROLES permissions
//   7. PRODUCTS_DATA        → priced products attached to batches; price history
//      with start/end dates drives FinanceScreen sales & batch P&L
//   8. GL_CHART             → FinanceScreen GL view; code ranges 1-6xxx per convention
//   9. ONBOARD_REQUESTS     → AdminOnboardingScreen; status changes visible to admin
// ============================================================

"use client";

/* ── Auto-code generator ── */
let _counters: Record<string, number> = {};
export function genCode(prefix: string, farmCode: string): string {
  const key = `${prefix}-${farmCode}`;
  _counters[key] = (_counters[key] ?? 0) + 1;
  return `${prefix}-${farmCode}-${String(_counters[key]).padStart(3, "0")}`;
}

// Deterministic demo codes
export const CODES = {
  farms: ["FRM-KMU-001", "FRM-KMU-002"],
  batches: {
    "BRO-KMU-022": { label: "Broilers Oct Run", unit: "HSE-KMU-A01" },
    "LYR-KMU-008": { label: "Layers Batch 8", unit: "PEN-KMU-B01" },
    "PIG-KMU-004": { label: "Pig Fatteners Q4", unit: "PPD-KMU-P01" },
    "COW-KMU-003": { label: "Dairy Herd Batch 3", unit: "PDD-KMU-D01" },
    "MZE-KMU-007": { label: "Maize Field Oct", unit: "FLD-KMU-F01" },
    "KIT-KMU-002": { label: "Kale & Spinach Plot", unit: "FLD-KMU-F02" },
  },
  tasks: ["TSK-KMU-0081", "TSK-KMU-0082", "TSK-KMU-0083", "TSK-KMU-0084"],
  employees: ["EMP-KMU-001", "EMP-KMU-002", "EMP-KMU-003", "EMP-KMU-004", "EMP-KMU-005"],
};

/* ── Enterprise types ── */
export type EnterpriseType = "livestock" | "crop";
export type LivestockSubtype = "broiler" | "layer" | "pig" | "dairy_cow" | "beef_cow" | "goat" | "sheep" | "rabbit" | "turkey" | "duck" | "fish";
export type CropSubtype = "maize" | "wheat" | "sorghum" | "kitchen_garden" | "silage" | "fruit_orchard" | "vegetables" | "legumes" | "fodder";

export interface EnterpriseConfig {
  type: EnterpriseType;
  subtype: LivestockSubtype | CropSubtype;
  emoji: string;
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
  frequency: "daily" | "weekly" | "on-demand" | "seasonal";
  requiresApproval: boolean;
  // form type determines which WorkerRecordScreen form renders
  form: "feeding" | "mortality" | "health" | "collect" | "weight" | "count" | "milking" | "harvest" | "spray" | "weed";
}

export const ENTERPRISE_REGISTRY: EnterpriseConfig[] = [
  {
    type: "livestock", subtype: "broiler", emoji: "🐔", label: "Broilers",
    unitName: "House", batchPrefix: "BRO", unitPrefix: "HSE",
    metrics: ["head count", "age (days)", "FCR", "mortality %", "weight (kg)"],
    harvestable: true, harvestUnit: "birds",
    processes: [
      { code: "PRO-FED", name: "Feeding", frequency: "daily", requiresApproval: false, form: "feeding" },
      { code: "PRO-MOR", name: "Mortality Record", frequency: "daily", requiresApproval: true, form: "mortality" },
      { code: "PRO-WGT", name: "Weight Sampling", frequency: "weekly", requiresApproval: false, form: "weight" },
      { code: "PRO-VAC", name: "Vaccination", frequency: "on-demand", requiresApproval: true, form: "health" },
      { code: "PRO-CNT", name: "Physical Count", frequency: "weekly", requiresApproval: true, form: "count" },
    ],
  },
  {
    type: "livestock", subtype: "layer", emoji: "🥚", label: "Layers",
    unitName: "Pen", batchPrefix: "LYR", unitPrefix: "PEN",
    metrics: ["head count", "age (days)", "egg production", "lay rate %", "mortality %"],
    harvestable: true, harvestUnit: "trays",
    processes: [
      { code: "PRO-FED", name: "Feeding", frequency: "daily", requiresApproval: false, form: "feeding" },
      { code: "PRO-EGG", name: "Egg Collection", frequency: "daily", requiresApproval: true, form: "collect" },
      { code: "PRO-MOR", name: "Mortality Record", frequency: "daily", requiresApproval: true, form: "mortality" },
      { code: "PRO-VAC", name: "Vaccination", frequency: "on-demand", requiresApproval: true, form: "health" },
      { code: "PRO-CNT", name: "Physical Count", frequency: "weekly", requiresApproval: true, form: "count" },
    ],
  },
  {
    type: "livestock", subtype: "pig", emoji: "🐷", label: "Pigs",
    unitName: "Sty", batchPrefix: "PIG", unitPrefix: "STY",
    metrics: ["head count", "age (days)", "weight (kg)", "FCR", "mortality %"],
    harvestable: true, harvestUnit: "kg liveweight",
    processes: [
      { code: "PRO-FED", name: "Feeding", frequency: "daily", requiresApproval: false, form: "feeding" },
      { code: "PRO-MOR", name: "Mortality Record", frequency: "daily", requiresApproval: true, form: "mortality" },
      { code: "PRO-WGT", name: "Weight Sampling", frequency: "weekly", requiresApproval: false, form: "weight" },
      { code: "PRO-VAC", name: "Treatment/Vaccine", frequency: "on-demand", requiresApproval: true, form: "health" },
    ],
  },
  {
    type: "livestock", subtype: "dairy_cow", emoji: "🐄", label: "Dairy Cattle",
    unitName: "Paddock", batchPrefix: "COW", unitPrefix: "PAD",
    metrics: ["head count", "age", "daily milk (L)", "lactation stage", "BCS score"],
    harvestable: true, harvestUnit: "litres",
    processes: [
      { code: "PRO-MLK", name: "Milking", frequency: "daily", requiresApproval: true, form: "milking" },
      { code: "PRO-FED", name: "Feeding / Grazing", frequency: "daily", requiresApproval: false, form: "feeding" },
      { code: "PRO-HLT", name: "Health Check", frequency: "weekly", requiresApproval: false, form: "health" },
      { code: "PRO-VAC", name: "Vaccination", frequency: "on-demand", requiresApproval: true, form: "health" },
    ],
  },
  {
    type: "livestock", subtype: "goat", emoji: "🐐", label: "Goats",
    unitName: "Pen", batchPrefix: "GOT", unitPrefix: "PEN",
    metrics: ["head count", "age", "daily milk (L)", "weight (kg)", "mortality %"],
    harvestable: true, harvestUnit: "litres",
    processes: [
      { code: "PRO-MLK", name: "Milking", frequency: "daily", requiresApproval: true, form: "milking" },
      { code: "PRO-FED", name: "Feeding", frequency: "daily", requiresApproval: false, form: "feeding" },
      { code: "PRO-VAC", name: "Vaccination", frequency: "on-demand", requiresApproval: true, form: "health" },
    ],
  },
  {
    type: "livestock", subtype: "fish", emoji: "🐠", label: "Fish / Aquaculture",
    unitName: "Tank/Pond", batchPrefix: "FSH", unitPrefix: "TNK",
    metrics: ["stocking density", "age (days)", "water temp (°C)", "DO (mg/L)", "mortality %"],
    harvestable: true, harvestUnit: "kg",
    processes: [
      { code: "PRO-FED", name: "Feeding", frequency: "daily", requiresApproval: false, form: "feeding" },
      { code: "PRO-WQT", name: "Water Quality", frequency: "daily", requiresApproval: false, form: "health" },
      { code: "PRO-MOR", name: "Mortality Record", frequency: "daily", requiresApproval: true, form: "mortality" },
    ],
  },
  {
    type: "crop", subtype: "maize", emoji: "🌽", label: "Maize",
    unitName: "Field", batchPrefix: "MZE", unitPrefix: "FLD",
    metrics: ["area (acres)", "plant stand", "growth stage", "expected yield (bags)"],
    harvestable: true, harvestUnit: "90kg bags",
    processes: [
      { code: "PRO-PLT", name: "Planting", frequency: "seasonal", requiresApproval: false, form: "harvest" },
      { code: "PRO-SPR", name: "Fertiliser/Spraying", frequency: "on-demand", requiresApproval: true, form: "spray" },
      { code: "PRO-WED", name: "Weeding", frequency: "on-demand", requiresApproval: false, form: "weed" },
      { code: "PRO-HVT", name: "Harvest", frequency: "seasonal", requiresApproval: true, form: "harvest" },
    ],
  },
  {
    type: "crop", subtype: "kitchen_garden", emoji: "🥬", label: "Kitchen Garden",
    unitName: "Plot", batchPrefix: "KIT", unitPrefix: "PLT",
    metrics: ["area (sqm)", "crop varieties", "watering schedule", "harvest frequency"],
    harvestable: true, harvestUnit: "kg",
    processes: [
      { code: "PRO-WTR", name: "Watering", frequency: "daily", requiresApproval: false, form: "weed" },
      { code: "PRO-WED", name: "Weeding", frequency: "weekly", requiresApproval: false, form: "weed" },
      { code: "PRO-HVT", name: "Harvest", frequency: "on-demand", requiresApproval: true, form: "harvest" },
    ],
  },
  {
    type: "crop", subtype: "vegetables", emoji: "🥦", label: "Vegetables",
    unitName: "Plot", batchPrefix: "VEG", unitPrefix: "PLT",
    metrics: ["area (sqm)", "variety mix", "growth stage", "yield (kg)"],
    harvestable: true, harvestUnit: "kg",
    processes: [
      { code: "PRO-WTR", name: "Watering", frequency: "daily", requiresApproval: false, form: "weed" },
      { code: "PRO-SPR", name: "Pesticide Spray", frequency: "on-demand", requiresApproval: true, form: "spray" },
      { code: "PRO-HVT", name: "Harvest", frequency: "on-demand", requiresApproval: true, form: "harvest" },
    ],
  },
  {
    type: "crop", subtype: "fruit_orchard", emoji: "🍎", label: "Fruit Orchard",
    unitName: "Block", batchPrefix: "FRT", unitPrefix: "BLK",
    metrics: ["tree count", "age (years)", "variety", "expected yield (kg)"],
    harvestable: true, harvestUnit: "kg",
    processes: [
      { code: "PRO-SPR", name: "Spray Programme", frequency: "weekly", requiresApproval: true, form: "spray" },
      { code: "PRO-HVT", name: "Harvest", frequency: "seasonal", requiresApproval: true, form: "harvest" },
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

export const PRODUCTS_DATA: Product[] = [
  {
    id: "PRD-KMU-001", name: "Tray Eggs (30)", emoji: "🥚",
    batchCode: "LYR-KMU-008", farmCode: "FRM-KMU-001", enterprise: "layer",
    priceHistory: [
      { price: 480, unit: "tray", currency: "KSh", startDate: "2026-01-01", endDate: "2026-07-31", notes: "Pre-season rate" },
      { price: 530, unit: "tray", currency: "KSh", startDate: "2026-08-01", notes: "August price increase" },
    ],
  },
  {
    id: "PRD-KMU-002", name: "Live Broiler (kg)", emoji: "🐔",
    batchCode: "BRO-KMU-022", farmCode: "FRM-KMU-001", enterprise: "broiler",
    priceHistory: [
      { price: 350, unit: "kg liveweight", currency: "KSh", startDate: "2026-01-01" },
    ],
  },
  {
    id: "PRD-KMU-003", name: "Fresh Milk (litre)", emoji: "🥛",
    batchCode: "COW-KMU-003", farmCode: "FRM-KMU-001", enterprise: "dairy_cow",
    priceHistory: [
      { price: 55, unit: "litre", currency: "KSh", startDate: "2026-01-01", endDate: "2026-06-30" },
      { price: 60, unit: "litre", currency: "KSh", startDate: "2026-07-01" },
    ],
  },
  {
    id: "PRD-KMU-004", name: "Maize (90kg bag)", emoji: "🌽",
    batchCode: "MZE-KMU-007", farmCode: "FRM-KMU-001", enterprise: "maize",
    priceHistory: [
      { price: 4200, unit: "bag", currency: "KSh", startDate: "2026-01-01" },
    ],
  },
  {
    id: "PRD-KMU-005", name: "Kale / Sukuma (kg)", emoji: "🥬",
    batchCode: "KIT-KMU-002", farmCode: "FRM-KMU-001", enterprise: "kitchen_garden",
    priceHistory: [
      { price: 80, unit: "kg", currency: "KSh", startDate: "2026-01-01" },
    ],
  },
  {
    id: "PRD-KMU-006", name: "Live Pork (kg)", emoji: "🐷",
    batchCode: "PIG-KMU-004", farmCode: "FRM-KMU-001", enterprise: "pig",
    priceHistory: [
      { price: 420, unit: "kg liveweight", currency: "KSh", startDate: "2026-01-01" },
    ],
  },
];

// Helper: get current price for a product on a given date
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
  plan: "Trial" | "Basic" | "Pro";
  status: "active" | "suspended" | "trial";
  createdAt: string;
}

export const FARMS_DATA: Farm[] = [
  {
    code: "FRM-KMU-001", name: "Nakuru Main Farm", location: "Nakuru, Kenya",
    address: "Off Nakuru-Nairobi Highway, Lanet, Nakuru County",
    lat: -0.2802, lng: 36.0665,
    size: "12 acres", owner: "James Kamau", plan: "Pro",
    enterprises: ["broiler", "layer", "pig", "dairy_cow", "maize", "kitchen_garden"],
    employees: 5, maxEmployees: 15, status: "active", createdAt: "2024-01-15",
  },
  {
    code: "FRM-KMU-002", name: "Eldoret Satellite Farm", location: "Eldoret, Kenya",
    address: "Huruma Road, Eldoret West, Uasin Gishu County",
    lat: 0.5143, lng: 35.2698,
    size: "6 acres", owner: "James Kamau", plan: "Basic",
    enterprises: ["goat", "maize", "vegetables"],
    employees: 2, maxEmployees: 5, status: "active", createdAt: "2025-03-01",
  },
];

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
  permissions?: Record<string, "edit" | "view" | "hidden">; // override if needed
}

export const EMPLOYEES_DATA: Employee[] = [
  { code: "EMP-KMU-001", name: "Peter Njoroge", role: "manager", phone: "+254-712-345-678", salary: 45000, payday: 28, active: true, farmCode: "FRM-KMU-001", startDate: "2024-01-20", batches: ["ALL"], pin: null },
  { code: "EMP-KMU-002", name: "John Kamau", role: "worker", phone: "+254-722-111-222", salary: 18000, payday: 28, active: true, farmCode: "FRM-KMU-001", startDate: "2024-02-01", batches: ["BRO-KMU-022","LYR-KMU-008"], pin: "****" },
  { code: "EMP-KMU-003", name: "Sarah Mwangi", role: "worker", phone: "+254-733-444-555", salary: 18000, payday: 28, active: true, farmCode: "FRM-KMU-001", startDate: "2024-02-01", batches: ["PIG-KMU-004","COW-KMU-003"], pin: "****" },
  { code: "EMP-KMU-004", name: "Ann Wambui", role: "harvest_lead", phone: "+254-744-666-777", salary: 22000, payday: 28, active: true, farmCode: "FRM-KMU-001", startDate: "2025-01-10", endDate: "2026-12-31", batches: ["MZE-KMU-007","KIT-KMU-002"], pin: "****", customRole: "Harvest Lead" },
  { code: "EMP-KMU-005", name: "Dr. Ken Oduya", role: "vet", phone: "+254-755-888-999", salary: 25000, payday: 5, active: true, farmCode: "FRM-KMU-001", startDate: "2024-01-20", batches: ["ALL"], pin: null },
  { code: "EMP-KMU-006", name: "Moses Kiptoo", role: "worker", phone: "+254-766-000-111", salary: 16000, payday: 28, active: true, farmCode: "FRM-KMU-002", startDate: "2025-03-15", batches: ["ALL"], pin: "****" },
];

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
  status: "ACTIVE" | "QUARANTINE" | "CLOSED" | "HARVESTED";
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

export const BATCHES_DATA: Batch[] = [
  { code: "BRO-KMU-022", label: "Broilers Oct Run", enterprise: "broiler", farmCode: "FRM-KMU-001", unitCode: "HSE-KMU-A01", qty: 920, initialQty: 1000, startDate: "2026-10-01", endDate: "2026-12-01", status: "ACTIVE", stage: "Grower", cost: 145000 },
  { code: "LYR-KMU-008", label: "Layers Batch 8", enterprise: "layer", farmCode: "FRM-KMU-001", unitCode: "PEN-KMU-B01", qty: 490, initialQty: 500, startDate: "2026-02-20", status: "ACTIVE", stage: "Peak Lay", cost: 95000 },
  { code: "PIG-KMU-004", label: "Pig Fatteners Q4", enterprise: "pig", farmCode: "FRM-KMU-001", unitCode: "STY-KMU-P01", qty: 62, initialQty: 65, startDate: "2026-07-15", endDate: "2026-11-15", status: "ACTIVE", stage: "Fattening", cost: 182000, transferDate: "2026-08-20", transferToUnitCode: "STY-KMU-P02", transferNotes: "Moving to new sty for final fattening phase" },
  { code: "COW-KMU-003", label: "Dairy Herd Batch 3", enterprise: "dairy_cow", farmCode: "FRM-KMU-001", unitCode: "PAD-KMU-D01", qty: 12, initialQty: 12, startDate: "2025-01-01", status: "ACTIVE", stage: "Lactating", cost: 480000 },
  { code: "MZE-KMU-007", label: "Maize Field Oct", enterprise: "maize", farmCode: "FRM-KMU-001", unitCode: "FLD-KMU-F01", qty: 2, initialQty: 2, startDate: "2026-03-15", harvestDate: "2026-07-20", status: "ACTIVE", stage: "Growing (75%)", cost: 42000 },
  { code: "KIT-KMU-002", label: "Kale & Spinach Plot", enterprise: "kitchen_garden", farmCode: "FRM-KMU-001", unitCode: "PLT-KMU-F02", qty: 1, initialQty: 1, startDate: "2026-07-01", status: "ACTIVE", stage: "Mature", cost: 8500 },
];

/* ── Owner-defined Roles ── */
// Roles are created/edited in GovernanceScreen > Role Builder tab.
// Each employee.role maps to an OwnerRole.id.
// PeopleScreen uses this to show/assign roles.
export interface OwnerRole {
  id: string;
  name: string;
  color: string;
  permissions: Record<string, "edit" | "view" | "hidden">;
  approvalRequired: string[];
  canApproveFor: string[];
}

export const OWNER_ROLES: OwnerRole[] = [
  {
    id: "manager", name: "Farm Manager", color: "var(--accent-purple)",
    permissions: {
      "feeding": "edit", "egg-collection": "edit", "mortality": "edit",
      "health": "edit", "physical-count": "edit", "tasks": "edit",
      "inventory": "view", "finance": "view", "payroll": "hidden", "governance": "hidden",
    },
    approvalRequired: ["delete-record", "variance-adjustment"],
    canApproveFor: ["feeding", "egg-collection", "mortality"],
  },
  {
    id: "worker", name: "Farm Worker", color: "var(--primary-green)",
    permissions: {
      "feeding": "edit", "egg-collection": "edit", "mortality": "edit",
      "health": "view", "physical-count": "edit", "tasks": "view",
      "inventory": "hidden", "finance": "hidden", "payroll": "hidden", "governance": "hidden",
    },
    approvalRequired: ["egg-collection", "mortality", "physical-count", "harvest"],
    canApproveFor: [],
  },
  {
    id: "vet", name: "Veterinarian", color: "var(--accent-cyan)",
    permissions: {
      "feeding": "hidden", "health": "edit", "mortality": "view",
      "physical-count": "hidden", "tasks": "view", "inventory": "view",
      "finance": "hidden", "payroll": "hidden", "governance": "hidden",
    },
    approvalRequired: [],
    canApproveFor: ["health", "vaccination"],
  },
  {
    id: "harvest_lead", name: "Harvest Lead", color: "var(--accent-amber)",
    permissions: {
      "feeding": "hidden", "harvest": "edit", "physical-count": "edit",
      "tasks": "view", "inventory": "view", "finance": "hidden",
      "payroll": "hidden", "governance": "hidden",
    },
    approvalRequired: ["harvest"],
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
  frequency: "once" | "daily" | "weekly" | "on-demand";
  status: "PENDING" | "DONE" | "OVERDUE" | "APPROVED" | "REJECTED";
  requiresApproval: boolean;
  priority: "high" | "medium" | "low";
  notes?: string;
  // Photo evidence settings (set by creator)
  maxPhotos?: number;        // 0 = none allowed, undefined = unlimited, 1-10 = limit
  photos?: { id: string; dataUrl: string; takenAt: string; takenBy: string }[];
  // External/casual workers — names captured separately, CSV-invited
  externalWorkers?: { name: string; phone?: string; portion?: string }[];
}

export const TASKS_DATA: Task[] = [
  { code: "TSK-KMU-0081", title: "Egg Collection – Pen B01", type: "egg-collection", assigneeCode: "EMP-KMU-002", assigneeName: "John Kamau", farmCode: "FRM-KMU-001", batchCode: "LYR-KMU-008", unitCode: "PEN-KMU-B01", location: "Pen B01", startDate: "2026-08-11", dueTime: "07:30", frequency: "daily", status: "PENDING", requiresApproval: true, priority: "high" },
  { code: "TSK-KMU-0082", title: "Morning Feeding – BRO-KMU-022", type: "feeding", assigneeCode: "EMP-KMU-002", assigneeName: "John Kamau", farmCode: "FRM-KMU-001", batchCode: "BRO-KMU-022", unitCode: "HSE-KMU-A01", location: "House A01", startDate: "2026-08-11", dueTime: "08:00", frequency: "daily", status: "OVERDUE", requiresApproval: false, priority: "high" },
  { code: "TSK-KMU-0083", title: "Milking – Morning Round", type: "milking", assigneeCode: "EMP-KMU-003", assigneeName: "Sarah Mwangi", farmCode: "FRM-KMU-001", batchCode: "COW-KMU-003", unitCode: "PAD-KMU-D01", location: "Paddock D01", startDate: "2026-08-11", dueTime: "06:00", frequency: "daily", status: "DONE", requiresApproval: true, priority: "high" },
  { code: "TSK-KMU-0084", title: "Maize Field Weed Inspection", type: "weed", assigneeCode: "EMP-KMU-004", assigneeName: "Ann Wambui", farmCode: "FRM-KMU-001", batchCode: "MZE-KMU-007", unitCode: "FLD-KMU-F01", location: "Field F01", startDate: "2026-08-11", endDate: "2026-08-14", dueTime: "09:00", frequency: "once", status: "PENDING", requiresApproval: false, priority: "medium" },
  { code: "TSK-KMU-0085", title: "Maize Weeding – Group Task", type: "weed", assigneeCode: "GROUP:worker", assigneeName: "All Workers", farmCode: "FRM-KMU-001", batchCode: "MZE-KMU-007", unitCode: "FLD-KMU-F01", location: "Field F01", startDate: "2026-08-15", endDate: "2026-08-17", dueTime: "07:00", frequency: "once", status: "PENDING", requiresApproval: true, priority: "high", notes: "Divide field into 3 rows per person. Bring own jembes.", externalWorkers: [{ name: "James Mwangi", phone: "+254-700-111-222", portion: "Rows 1–4" }, { name: "Lucy Achieng", phone: "+254-711-333-444", portion: "Rows 5–8" }] },
];

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
  status: "pending" | "approved" | "rejected" | "held";
  priority: "high" | "medium" | "low";
  evidencePhoto?: boolean;
}

export const APPROVALS_DATA: ApprovalRequest[] = [
  { code: "APR-KMU-0041", type: "Egg Collection", title: "Egg Collection – 145 trays recorded", requestedByCode: "EMP-KMU-002", requestedByName: "John Kamau", batchCode: "LYR-KMU-008", farmCode: "FRM-KMU-001", details: "Morning + evening rounds combined. 145 trays (30 eggs each). 3 cracked.", requestedAt: "2026-08-11 07:45", status: "pending", priority: "high", evidencePhoto: true },
  { code: "APR-KMU-0042", type: "Mortality", title: "Pig mortality – 2 animals (PIG-KMU-004)", requestedByCode: "EMP-KMU-003", requestedByName: "Sarah Mwangi", batchCode: "PIG-KMU-004", farmCode: "FRM-KMU-001", details: "2 pigs found dead. Cause: heat stress. Photos attached.", requestedAt: "2026-08-11 09:30", status: "pending", priority: "high", evidencePhoto: true },
  { code: "APR-KMU-0043", type: "Harvest", title: "Kitchen garden harvest – 28kg kale", requestedByCode: "EMP-KMU-004", requestedByName: "Ann Wambui", batchCode: "KIT-KMU-002", farmCode: "FRM-KMU-001", details: "Kale harvest ready for market. Estimated 28kg gross.", requestedAt: "2026-08-10 14:00", status: "approved", priority: "medium" },
  { code: "APR-KMU-0044", type: "Milking", title: "Dairy milking – 84L morning", requestedByCode: "EMP-KMU-003", requestedByName: "Sarah Mwangi", batchCode: "COW-KMU-003", farmCode: "FRM-KMU-001", details: "12 cows milked. 84L total (7L/cow avg). 1 cow withheld (mastitis).", requestedAt: "2026-08-11 06:45", status: "approved", priority: "medium" },
];

/* ── Notifications ── */
// Populated from: GovernanceScreen approvals, system events, task overdue alerts
// NavProvider reads unreadNotifs count for badge display.
// NotificationsScreen marks items read.
export interface Notification {
  id: string;
  type: "weather" | "alert" | "approval" | "task" | "system";
  title: string;
  body: string;
  time: string;
  read: boolean;
  farmCode?: string;
  sourceCode?: string; // APR code, TSK code etc for deep linking
}

export const NOTIFICATIONS_DATA: Notification[] = [
  { id: "N001", type: "weather", title: "Heavy Rain – Saturday", body: "82% rain forecast for Nakuru. Check drainage & shelters.", time: "2h ago", read: false, farmCode: "FRM-KMU-001" },
  { id: "N002", type: "approval", title: "Approval needed: Egg Collection", body: "John Kamau submitted 145 trays. Review required.", time: "5m ago", read: false, farmCode: "FRM-KMU-001", sourceCode: "APR-KMU-0041" },
  { id: "N003", type: "task", title: "Task Overdue: BRO-KMU-022 feeding", body: "Morning feeding was due at 08:00. Assigned to John Kamau.", time: "45m ago", read: false, farmCode: "FRM-KMU-001", sourceCode: "TSK-KMU-0082" },
  { id: "N004", type: "alert", title: "Low Stock: Layer Mash", body: "Only 320kg remaining (reorder: 500kg). Place order now.", time: "3h ago", read: true, farmCode: "FRM-KMU-001" },
  { id: "N005", type: "system", title: "Payroll due in 17 days", body: "August payroll (KSh 126,000) is due on 28 Aug.", time: "1d ago", read: true },
  { id: "N006", type: "approval", title: "Approved: Dairy milking 84L", body: "Your milking record was approved by James Kamau.", time: "1h ago", read: true, farmCode: "FRM-KMU-001", sourceCode: "APR-KMU-0044" },
];

/* ── GL Accounts ── */
export const GL_CHART = [
  { code: "1000", account: "Cash in Hand",            class: "Asset",    normal: "debit"  },
  { code: "1001", account: "Bank – Equity Bank",      class: "Asset",    normal: "debit"  },
  { code: "1100", account: "Accounts Receivable",     class: "Asset",    normal: "debit"  },
  { code: "1200", account: "Livestock Inventory",     class: "Asset",    normal: "debit"  },
  { code: "1201", account: "Feed & Supplies Inventory", class: "Asset",  normal: "debit"  },
  { code: "1300", account: "Land & Improvements",     class: "Asset",    normal: "debit"  },
  { code: "1301", account: "Farm Equipment",          class: "Asset",    normal: "debit"  },
  { code: "2000", account: "Accounts Payable",        class: "Liability", normal: "credit" },
  { code: "2001", account: "Loans – KCB Farm Loan",  class: "Liability", normal: "credit" },
  { code: "2100", account: "Accrued Wages",           class: "Liability", normal: "credit" },
  { code: "3000", account: "Owner's Equity",          class: "Equity",   normal: "credit" },
  { code: "3100", account: "Retained Earnings",       class: "Equity",   normal: "credit" },
  { code: "4001", account: "Egg Sales",               class: "Revenue",  normal: "credit" },
  { code: "4002", account: "Broiler Sales",           class: "Revenue",  normal: "credit" },
  { code: "4003", account: "Pork Sales",              class: "Revenue",  normal: "credit" },
  { code: "4004", account: "Milk Sales",              class: "Revenue",  normal: "credit" },
  { code: "4005", account: "Crop / Produce Sales",    class: "Revenue",  normal: "credit" },
  { code: "5001", account: "Feed Costs",              class: "COGS",     normal: "debit"  },
  { code: "5002", account: "Livestock Purchases",     class: "COGS",     normal: "debit"  },
  { code: "5003", account: "Seed & Fertiliser",       class: "COGS",     normal: "debit"  },
  { code: "6001", account: "Salaries & Wages",        class: "OpEx",     normal: "debit"  },
  { code: "6002", account: "Veterinary & Medicine",   class: "OpEx",     normal: "debit"  },
  { code: "6003", account: "Utilities",               class: "OpEx",     normal: "debit"  },
  { code: "6004", account: "Repairs & Maintenance",   class: "OpEx",     normal: "debit"  },
  { code: "6005", account: "Depreciation",            class: "OpEx",     normal: "debit"  },
  { code: "6006", account: "Insurance",               class: "OpEx",     normal: "debit"  },
];

/* ── Onboarding Requests (SaaS admin) ── */
// Self-registration: farmer fills out RegisterScreen → creates OnboardRequest
// Admin reviews in AdminOnboardingScreen → approve creates a Farm record
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
  status: "pending" | "approved" | "rejected" | "info-needed";
  notes?: string;
}

export const ONBOARD_REQUESTS: OnboardRequest[] = [
  { id: "ORQ-001", farmerName: "Mary Wanjiku", email: "mary@email.com", phone: "+254-712-000-001", farmName: "Rift Valley Poultry", location: "Nakuru, Kenya", enterprises: ["layer","broiler"], requestedAt: "2026-08-10 14:00", status: "pending" },
  { id: "ORQ-002", farmerName: "Peter Rono", email: "peter@email.com", phone: "+254-722-000-002", farmName: "Eldoret Dairy", location: "Eldoret, Kenya", enterprises: ["dairy_cow","maize"], requestedAt: "2026-08-09 10:00", status: "info-needed", notes: "Need to verify land ownership documents." },
  { id: "ORQ-003", farmerName: "Grace Mutua", email: "grace@email.com", phone: "+254-733-000-003", farmName: "Machakos Veggie Farm", location: "Machakos, Kenya", enterprises: ["vegetables","kitchen_garden"], requestedAt: "2026-08-08 09:00", status: "approved" },
];

/* ── CSV Templates ── */
export const CSV_TEMPLATES: Record<string, { cols: string[]; example: string[] }> = {
  employees: {
    cols: ["code","name","role","phone","salary","payday","startDate","endDate","batches","active"],
    example: ["EMP-KMU-007","Jane Doe","worker","+254-700-000-001","16000","28","2026-08-15","","BRO-KMU-022","true"],
  },
  tasks: {
    cols: ["code","title","type","assigneeCode","batchCode","unitCode","location","lat","lng","startDate","endDate","dueTime","frequency","requiresApproval","priority","maxPhotos","notes"],
    example: ["TSK-KMU-0086","Feeding – Evening","feeding","EMP-KMU-002","BRO-KMU-022","HSE-KMU-A01","House A01","","","2026-08-12","2026-12-31","17:00","daily","false","high","3","Check water too"],
  },
  external_workers: {
    cols: ["taskCode","name","phone","email","portion","idNumber"],
    example: ["TSK-KMU-0085","John Otieno","+254-700-555-666","","Rows 9–12","12345678"],
  },
  inventory: {
    cols: ["id","name","category","unit","qty","reorder","costPerUnit","lotNumber","expiryDate"],
    example: ["F004","Broiler Finisher","Feed","kg","800","300","55","LOT-2026-049",""],
  },
};

export function downloadCSV(template: keyof typeof CSV_TEMPLATES) {
  const t = CSV_TEMPLATES[template];
  const rows = [t.cols.join(","), t.example.join(",")];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `ifms_${template}_template.csv`; a.click();
  URL.revokeObjectURL(url);
}
