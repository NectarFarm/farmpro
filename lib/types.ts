// ─── Core Types for Poultry Farm Management App ───────────────────────────

export type FlockStage = 'brooder' | 'grower' | 'layer' | 'disposal' | 'sold';

export interface Flock {
  id: string;
  name: string;
  dateAcquired: string;
  source: string;
  initialCount: number;
  currentCount: number;
  purchaseCostPerChick: number;
  initialWeight: number;
  breed: string;
  stage: FlockStage;
  cageId?: string;
  notes?: string;
  createdAt: string;
}

export interface MortalityRecord {
  id: string;
  flockId: string;
  date: string;
  count: number;
  cause?: string;
  createdAt: string;
}

export interface FeedRecord {
  id: string;
  flockId: string;
  date: string;
  quantityKg: number;
  feedType: 'starter' | 'grower' | 'layer' | 'finisher';
  feedSource: 'purchased' | 'produced';   // meeting item #4
  costPerKg: number;
  totalCost: number;
  createdAt: string;
}

/** Feed dispensed to birds (employee entry) — separate from stock purchases */
export interface FeedDispenseRecord {
  id: string;
  flockId: string;
  date: string;
  quantityKg: number;
  feedType: 'starter' | 'grower' | 'layer' | 'finisher';
  feedSource: 'purchased' | 'produced';
  notes?: string;
  createdAt: string;
}

export interface VaccinationRecord {
  id: string;
  flockId: string;
  vaccineName: string;
  scheduledDate: string;
  completedDate?: string;
  dosage?: string;
  cost: number;
  notes?: string;
  createdAt: string;
}

export interface EggCollection {
  id: string;
  flockId: string;
  date: string;
  count: number;          // total collected (including broken)
  broken: number;         // meeting item #5 — breakages field
  sellable: number;       // count - broken
  notes?: string;
  createdAt: string;
}

export type CustomerType = 'retail' | 'restaurant' | 'bakery' | 'wholesale';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  type: CustomerType;
  notes?: string;
  createdAt: string;
}

export type ProductType = 'eggs' | 'birds';

export interface Sale {
  id: string;
  customerId: string;
  flockId?: string;
  product: ProductType;
  quantity: number;
  pricePerUnit: number;
  totalAmount: number;
  date: string;
  notes?: string;
  createdAt: string;
  // Two-step deletion workflow (meeting item #3)
  deletionRequested?: boolean;
  deletionReason?: string;
  deletionRequestedBy?: string;
  deletionRequestedAt?: string;
}

export type CostCategory = 'feed' | 'vaccines' | 'medications' | 'labour' | 'utilities' | 'chicks' | 'miscellaneous';

export interface Expense {
  id: string;
  category: CostCategory;
  description: string;
  amount: number;
  date: string;
  flockId?: string;
  createdAt: string;
}

export interface Budget {
  id: string;
  category: CostCategory;
  period: 'monthly' | 'cycle';
  amount: number;
  month?: string; // YYYY-MM for monthly
  flockId?: string; // for cycle budgets
  createdAt: string;
}

export interface Cage {
  id: string;
  name: string;
  type: 'brooder' | 'grower' | 'layer';
  capacity: number;
  createdAt: string;
}

export interface FeedInventory {
  id: string;
  feedType: 'starter' | 'grower' | 'layer' | 'finisher';
  currentStockKg: number;
  reorderLevelKg: number;
  lastUpdated: string;
}

export interface Alert {
  id: string;
  type: 'vaccination_overdue' | 'high_mortality' | 'budget_alert' | 'low_feed' | 'cage_capacity';
  message: string;
  relatedId?: string;
  route?: string;
  read: boolean;
  createdAt: string;
}

export interface Employee {
  id: string;
  name: string;
  pinHash: string;
  role: 'employee';
  createdAt: string;
}

export interface UserSession {
  type: 'owner' | 'employee' | 'customer';
  employeeId?: string;
  employeeName?: string;
  customerId?: string;
  customerName?: string;
  loginAt: string;
}

// ── Employee Salary ────────────────────────────────────────────────────────────
export interface EmployeeSalary {
  id: string;
  employeeId: string;       // links to Employee.id
  employeeName: string;     // denormalised for display
  amount: number;           // KSh per month
  payDayOfMonth: number;    // 1–28
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Customer Portal ────────────────────────────────────────────────────────────
export type OrderRequestStatus = 'pending' | 'confirmed' | 'delivered' | 'paid' | 'cancelled';
export type OrderRequestProduct = 'eggs' | 'tray' | 'chicks';

export interface OrderRequest {
  id: string;
  customerId: string;
  customerName: string;
  product: OrderRequestProduct;
  /** unit: individual eggs, trays (30 eggs each), or chicks */
  quantity: number;
  pricePerUnit: number;      // set by owner/employee when confirming
  totalAmount: number;
  status: OrderRequestStatus;
  deliveryLocation: string;
  contactPhone: string;
  notes?: string;
  requestedDate: string;    // YYYY-MM-DD
  paidByCustomer: boolean;
  deliveryConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

// Egg availability shown to customer portal
export interface EggAvailability {
  date: string;
  totalCollected: number;
  totalSold: number;
  available: number;
  pricePerEgg: number;
  pricePerTray: number;
}

// ── Bird Stage Pricing ─────────────────────────────────────────────────────────
/** Owner-configurable selling price per bird at each growth stage */
export interface BirdStagePricing {
  brooder: number;   // KSh per bird
  grower: number;
  layer: number;
}

/** Records a bird sale at a stage (before "sold" end-of-lay) */
export interface BirdStageSale {
  id: string;
  flockId: string;
  stage: FlockStage;
  quantity: number;
  pricePerBird: number;       // actual sale price
  breakEvenPrice: number;     // calculated cost at time of sale
  totalAmount: number;
  customerId?: string;
  date: string;
  notes?: string;
  createdAt: string;
}

// ── Customer Portal User ───────────────────────────────────────────────────────
/** Registered customer who can log into the customer portal */
export interface CustomerPortalUser {
  id: string;
  customerId: string;   // links to Customer.id
  name: string;         // display name (mirrors Customer.name)
  phone: string;        // mirrors Customer.phone
  pinHash: string;      // hashed 4-digit PIN
  createdAt: string;
}
