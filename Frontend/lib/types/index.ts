// IFMS Shared Types — SRS v1.0 §4
export type Role = 'owner' | 'manager' | 'worker' | 'vet' | 'auditor' | 'super_admin';
export type UnitType = 'CAGE' | 'PEN' | 'HOUSE' | 'POND' | 'TANK' | 'PLOT';
export type UnitStatus = 'ACTIVE' | 'EMPTY' | 'CLEANING' | 'QUARANTINE' | 'OUT_OF_SERVICE';
export type BatchStage = 'CREATED'|'BROODING'|'GROWING'|'LAYING'|'FINISHING'|'FATTENING'|'HARVESTING'|'CLOSED';
export type BatchSource = 'PURCHASED'|'HATCHED'|'BORN'|'TRANSFERRED'|'SPLIT'|'MERGED';
export type ItemCategory = 'FEED_FINISHED'|'FEED_INGREDIENT'|'MEDICINE'|'VACCINE'|'SEED'|'FERTILIZER'|'PESTICIDE'|'EQUIPMENT'|'CONSUMABLE';
export type TreatmentType = 'VACCINE'|'MEDICATION'|'SUPPLEMENT'|'DEWORM'|'PRESCRIPTION'|'OTHER';
export type TaskStatus = 'ASSIGNED'|'IN_PROGRESS'|'DONE'|'MISSED'|'SKIPPED';
export type AlertSeverity = 'info'|'warning'|'critical';
export type FieldPermission = 'hidden'|'readonly'|'editable';
export type SaleStatus = 'DRAFT'|'CONFIRMED'|'DELIVERED'|'PAID'|'PARTIALLY_PAID'|'CREDIT'|'CLOSED';

export interface User {
  id: string; tenantId: string; name: string; phone: string; email?: string;
  role: Role; workerProfileId?: string; language: 'en'|'sw';
}

export interface ProductionUnit {
  id: string; tenantId: string; farmId: string; zoneId?: string;
  type: UnitType; name: string; code: string; capacity: number; status: UnitStatus;
  currentQty?: number; species?: string;
}

export interface Batch {
  id: string; tenantId: string; unitId: string; name: string;
  species: string; enterprise?: string | null; breed?: string; source: BatchSource;
  acquiredDate: string; ageAtAcquire: number; initialQty: number; currentQty: number;
  stage: BatchStage; acquisitionCost: number; status: 'ACTIVE'|'CLOSED'|'ARCHIVED';
  parentBatchIds?: string[];
  deliveryGroupId?: string | null;
}

export interface InventoryItem {
  id: string; tenantId: string; name: string; category: ItemCategory;
  unit: string; lowStockThreshold: number;
}

export interface InventoryLot {
  id: string; itemId: string; lotNo: string; qtyOnHand: number;
  unit: string; unitCost: number; expiryDate?: string;
  supplierId?: string; receivedDate: string; withdrawalDays?: number;
}

export interface HealthRecord {
  id: string; clientUuid: string; batchId: string; type: TreatmentType;
  productLotId: string; dose: number; route: string; appliedBy: string;
  appliedAt: string; nextDueAt?: string; withdrawalUntil?: string;
  photoId?: string; notes?: string; status: 'pending'|'synced'; capturedAt: string;
}

export interface FeedingRecord {
  id: string; clientUuid: string; batchId: string; lotId: string; feedItemId: string;
  quantityKg: number; recordedBy: string;
  capturedAt: string; status: 'pending'|'synced';
}

export interface MortalityRecord {
  id: string; clientUuid: string; batchId: string; unitId: string; count: number;
  cause?: string; photoId?: string; gpsLat?: number; gpsLng?: number;
  gpsAccuracy?: number; gpsTimestamp?: string; recordedBy: string;
  capturedAt: string; status: 'pending'|'synced';
}

export interface WaterQualityRecord {
  id: string; clientUuid: string; unitId: string; batchId: string;
  tempC?: number; doMgL?: number; ph?: number; ammonia?: number;
  colour?: 'CLEAR'|'GREEN'|'MURKY'; recordedBy: string;
  capturedAt: string; status: 'pending'|'synced';
}

export interface WeightSample {
  id: string; clientUuid: string; batchId: string; sampleSize: number;
  avgWeightKg: number; measuredAt: string; measuredBy: string; status: 'pending'|'synced';
}

export interface PhysicalCount {
  id: string; clientUuid: string; batchId: string; unitId: string;
  systemCount: number; physicalCount: number; variance: number;
  reason: string; notes?: string; recordedBy: string;
  capturedAt: string; status: 'pending'|'synced';
}

export interface Task {
  id: string; title: string; description?: string;
  type: 'morning_round'|'vaccination'|'stock_count'|'feeding'|'sampling'|'custom';
  assignedTo: string; unitId?: string; batchId?: string;
  scheduledFor: string; status: TaskStatus; dueAt: string; overdue?: boolean;
}

export interface Alert {
  id: string; severity: AlertSeverity; title: string; message: string;
  // 'stage_due'|'weight_loss'|'stock_variance'|'abnormal' are the types actually
  // raised by lib/server/alertEngine.ts and lib/server/syncHandlers.ts today;
  // the rest are reserved for planned rule types not yet implemented.
  type: 'low_stock'|'mortality_spike'|'overdue_vaccine'|'water_quality'|'feed_variance'|'withdrawal_violation'|'task_missed'|'expiry'
    |'stage_due'|'weight_loss'|'stock_variance'|'abnormal';
  createdAt: string; acknowledged: boolean;
}

export interface Sale {
  id: string; tenantId: string; batchId: string; unitId: string;
  productType: string; quantity: number; weightKg?: number;
  unitPrice: number; totalAmount: number; buyer: string;
  paymentMethod: 'cash'|'mpesa'|'credit'; status: SaleStatus;
  withdrawalCheck: 'cleared'|'blocked'|'n/a'; withdrawalUntil?: string;
  createdAt: string;
}

export interface Purchase {
  id: string; tenantId: string; itemId: string; lotId: string;
  supplier: string; quantity: number; unitCost: number; totalCost: number;
  createdAt: string; receivedAt: string;
  paidAt: string | null; paymentMethod: string | null; amountPaid: number;
}

export interface FieldConfig {
  fieldKey: string; label: string; permission: FieldPermission; required?: boolean;
}

export interface WorkerProfile {
  id: string; tenantId: string; name: string; description?: string;
  fields: FieldConfig[]; modules: string[];
  mortalityPhotoThreshold: number; alertThresholds: Record<string,number>;
}

export interface Employee {
  id: string; tenantId: string; name: string; phone: string;
  role: Role; workerProfileId?: string; pinSet: boolean; active: boolean;
  salary?: number; payDay?: number | null; paymentsFrom?: string | null;
  assignedBatchIds?: string[] | null; // null = all active batches (default); [] = none
}

export interface BatchCostSummary {
  batchId: string; acquisitionCost: number; feedCost: number;
  healthCost: number; laborCost: number; salaryCost?: number; overheadCost: number;
  totalCost: number; totalRevenue: number; grossMargin: number;
  // undefined = no cost-driver product configured for this batch; a number
  // (including 0, via outputQty) means a driver exists. See outputQty below —
  // costPerUnit alone cannot tell "no driver" apart from "driver, zero output".
  costPerUnit?: number; outputUnit: string; breakEvenAge?: number;
  // undefined = no driver configured; 0 = driver exists but nothing recorded
  // against it yet; >0 = real output. See lib/server/costing.ts summarizeBatchCost.
  outputQty?: number;
  // How `fcr` (when defined) should be read — per kg / per base unit (e.g.
  // litre milk) / per dozen (eggs) — or 'NONE' where FCR is meaningless
  // (e.g. maize). Explicit per enterprise; never inferred from outputUnit.
  fcrMode?: 'PER_KG' | 'PER_BASE_UNIT' | 'PER_DOZEN' | 'NONE';
  fcr?: number; henDayPct?: number; henHousedPct?: number; adg?: number; mortalityPct?: number;
  currentQty: number; costPerBird?: number; breakEvenPricePerRemaining?: number; remainingQty?: number;
  // Headcount fates: survivors = initial − died; soldHead left the farm; deaths = died.
  survivors?: number; soldHead?: number; deaths?: number;
}

export interface ProductSaleUnit { name: string; perBase: number; price: number }
export interface Product {
  id: string; tenantId: string; batchId?: string; name: string; baseUnit: string;
  saleUnits: ProductSaleUnit[]; collectFrequency: 'daily'|'weekly'|'monthly'|'per_cycle'|string;
  flow: 'sale'|'expense'|string; fieldKey?: string; active: boolean;
  isAnimalProduct?: boolean;
}

export interface ConflictEntry {
  id: string; recordType: string; recordId: string;
  myVersion: unknown; serverVersion: unknown;
  capturedAtMine: string; capturedAtServer: string;
  resolution?: 'kept_mine'|'kept_server'; resolvedAt?: string;
}
