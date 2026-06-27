// Clean mock data — no demo farm data. Users create everything from scratch.
import type {
  User, ProductionUnit, Batch, InventoryItem, InventoryLot,
  Task, Alert, Employee, WorkerProfile, BatchCostSummary, Sale, Purchase, HealthRecord, Product,
} from '@/lib/types';

export const TENANT_ID = 'tenant_001';

export const mockUsers: User[] = [
  { id:'u1', tenantId:TENANT_ID, name:'Kutswa', phone:'+254712345678', email:'kutswa@ifms.farm', role:'owner', language:'en' },
  { id:'u2', tenantId:TENANT_ID, name:'Amina Wanjiku', phone:'+254700111222', role:'manager', language:'en' },
  { id:'u3', tenantId:TENANT_ID, name:'John Otieno', phone:'+254700333444', role:'worker', workerProfileId:'wp1', language:'en' },
  { id:'u4', tenantId:TENANT_ID, name:'Mary Achieng', phone:'+254700555666', role:'worker', workerProfileId:'wp1', language:'sw' },
  { id:'u5', tenantId:TENANT_ID, name:'Dr. Kuria Kamau', phone:'+254700777888', role:'vet', language:'en' },
  { id:'u6', tenantId:TENANT_ID, name:'Investor Link', phone:'', email:'investor@fund.ke', role:'auditor', language:'en' },
];

export const mockUnits: ProductionUnit[] = [];
export const mockBatches: Batch[] = [];
export const mockItems: InventoryItem[] = [];
export const mockLots: InventoryLot[] = [];
export const mockTasks: Task[] = [];
export const mockAlerts: Alert[] = [];
export const mockEmployees: Employee[] = [];
export const mockWorkerProfiles: WorkerProfile[] = [
  {
    id:'wp1', tenantId:TENANT_ID, name:'Standard Worker', description:'Default profile — hides all financial data',
    modules:['morning_round','mortality','feeding','health','weight_sampling','physical_count','closing_stock'],
    mortalityPhotoThreshold:1,
    alertThresholds:{ mortalityRate:2.0, lowStockKg:50 },
    fields:[
      { fieldKey:'feed_unit_cost', label:'Feed unit cost (KES)', permission:'hidden' },
      { fieldKey:'feed_quantity', label:'Feed quantity (kg)', permission:'editable', required:true },
      { fieldKey:'egg_sale_price', label:'Egg sale price', permission:'hidden' },
      { fieldKey:'mortality_cause', label:'Mortality cause', permission:'editable', required:false },
      { fieldKey:'batch_profit_loss', label:'Batch profit/loss', permission:'hidden' },
      { fieldKey:'water_level', label:'Water level', permission:'editable', required:true },
      { fieldKey:'eggs_collected', label:'Eggs collected', permission:'editable', required:true },
      { fieldKey:'abnormal', label:'Abnormal observation', permission:'editable', required:true },
    ],
  },
];
export const mockCostSummaries: BatchCostSummary[] = [];
export const mockSales: Sale[] = [];
export const mockHealthRecords: HealthRecord[] = [];
export const mockPurchases: Purchase[] = [];
export const mockProducts: Product[] = [];
