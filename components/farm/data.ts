// ============================================================
// data.ts — static UI config + shared types (NOT mock data)
// ============================================================
// Every screen is API-driven (GET/POST against the real routes under
// app/api). What remains here is genuinely static, data-free config:
//   1. ENTERPRISE_REGISTRY  → UI config for enterprise types (emoji, code
//      prefixes, process templates, metrics) — shared by Crops, Dashboard,
//      Worker, Auth (register enterprise picker) and Admin onboarding.
//   2. CSV_TEMPLATES / downloadCSV → the import-file format spec (columns +
//      example rows) for the CSV import modal.
//   3. Shared TypeScript interfaces + the genCode helper.
// The mock data constants that used to live here (BATCHES_DATA,
// EMPLOYEES_DATA, PRODUCTS_DATA, TASKS_DATA, APPROVALS_DATA,
// NOTIFICATIONS_DATA, FARMS_DATA, OWNER_ROLES, GL_CHART, ONBOARD_REQUESTS)
// are all gone — several leaked into real flows (e.g. the CSV import's
// validation) because they were importable, so they were deleted rather than
// left as a footgun.
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

// PRODUCTS_DATA (mock products + price history) and getCurrentPrice were
// deleted — the dashboard's current-prices strip reads the real
// GET /api/products/current-prices. The Product/ProductPrice types remain
// below for any contract that references them.

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

// FARMS_DATA (mock farms) deleted — the farm switcher reads GET /api/farms
// (components/farm/navigation.tsx falls back to nothing, not mock farms).

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

// EMPLOYEES_DATA (mock employees) deleted — People/Tasks/Worker screens read
// GET /api/employees. The Employee type remains for contracts that reference it.

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

// BATCHES_DATA (mock batches) deleted — Crops/Dashboard/Finance screens read
// GET /api/batches. The Batch type remains for contracts that reference it.

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

// OWNER_ROLES (mock role definitions, including the never-real "harvest_lead"
// role) deleted — Governance's Role Builder reads/writes the real per-tenant
// GET/PUT /api/role-permissions matrix. The OwnerRole type remains for
// contracts that reference it.

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

// TASKS_DATA (mock tasks) deleted — Tasks/Worker screens read GET /api/tasks.
// The Task type remains for contracts that reference it.

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

// APPROVALS_DATA (mock approval requests) deleted — Governance reads
// GET /api/approvals. The ApprovalRequest type remains for contracts that
// reference it.

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

// NOTIFICATIONS_DATA (mock notifications) deleted — the bell/badge and
// Notifications screen read GET /api/notifications. The Notification type
// remains for contracts that reference it.

/* ── GL Accounts ── */
// GL_CHART (mock chart of accounts) deleted — Finance's GL reads the real
// GET /api/gl/trial-balance (accounts are a real table, db/schemas/finance.ts).

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

// ONBOARD_REQUESTS (mock onboarding rows) deleted — Admin onboarding reads
// GET /api/onboard-requests. The OnboardRequest type remains for contracts
// that reference it.

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
