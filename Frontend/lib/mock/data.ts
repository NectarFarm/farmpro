// Mock seed data — simulates Django REST API responses
import type {
  User, ProductionUnit, Batch, InventoryItem, InventoryLot,
  Task, Alert, Employee, WorkerProfile, BatchCostSummary, Sale, Purchase, HealthRecord,
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

export const mockUnits: ProductionUnit[] = [
  { id:'unit1', tenantId:TENANT_ID, farmId:'farm1', type:'HOUSE', name:'Poultry House 1', code:'PH1', capacity:500, status:'ACTIVE', currentQty:485, species:'poultry_layer' },
  { id:'unit2', tenantId:TENANT_ID, farmId:'farm1', type:'CAGE', name:'Cage A1', code:'CA1', capacity:90, status:'ACTIVE', currentQty:85, species:'poultry_layer' },
  { id:'unit3', tenantId:TENANT_ID, farmId:'farm1', type:'CAGE', name:'Cage A2', code:'CA2', capacity:90, status:'ACTIVE', currentQty:88, species:'poultry_layer' },
  { id:'unit4', tenantId:TENANT_ID, farmId:'farm1', type:'PEN', name:'Pig Pen B', code:'PPB', capacity:100, status:'ACTIVE', currentQty:94, species:'pig' },
  { id:'unit5', tenantId:TENANT_ID, farmId:'farm1', type:'POND', name:'Pond 3', code:'P3', capacity:1000, status:'ACTIVE', currentQty:850, species:'tilapia' },
  { id:'unit6', tenantId:TENANT_ID, farmId:'farm1', type:'HOUSE', name:'Broiler House 2', code:'BH2', capacity:600, status:'ACTIVE', currentQty:500, species:'poultry_broiler' },
  { id:'unit7', tenantId:TENANT_ID, farmId:'farm1', type:'PEN', name:'Pig Pen C', code:'PPC', capacity:80, status:'EMPTY', currentQty:0, species:'pig' },
];
export const mockBatches: Batch[] = [
  { id:'b1', tenantId:TENANT_ID, unitId:'unit1', name:'Layer #003', species:'poultry_layer', breed:'Kienyeji Brown', source:'PURCHASED', acquiredDate:'2026-01-10', ageAtAcquire:18, initialQty:500, currentQty:485, stage:'LAYING', acquisitionCost:120000, status:'ACTIVE' },
  { id:'b2', tenantId:TENANT_ID, unitId:'unit2', name:'Layer #003 (Cage A1)', species:'poultry_layer', source:'SPLIT', acquiredDate:'2026-01-10', ageAtAcquire:18, initialQty:90, currentQty:85, stage:'LAYING', acquisitionCost:21600, status:'ACTIVE', parentBatchIds:['b1'] },
  { id:'b3', tenantId:TENANT_ID, unitId:'unit4', name:'Pig Batch #007', species:'pig', breed:'Large White', source:'PURCHASED', acquiredDate:'2026-03-01', ageAtAcquire:60, initialQty:100, currentQty:94, stage:'FATTENING', acquisitionCost:200000, status:'ACTIVE' },
  { id:'b4', tenantId:TENANT_ID, unitId:'unit5', name:'Tilapia #011', species:'tilapia', source:'PURCHASED', acquiredDate:'2026-02-15', ageAtAcquire:30, initialQty:900, currentQty:850, stage:'GROWING', acquisitionCost:45000, status:'ACTIVE' },
  { id:'b5', tenantId:TENANT_ID, unitId:'unit6', name:'Broiler #005', species:'poultry_broiler', breed:'Cobb 500', source:'PURCHASED', acquiredDate:'2026-05-12', ageAtAcquire:1, initialQty:500, currentQty:485, stage:'FINISHING', acquisitionCost:60000, status:'ACTIVE' },
  { id:'b6', tenantId:TENANT_ID, unitId:'unit1', name:'Layer #001 (Closed)', species:'poultry_layer', source:'PURCHASED', acquiredDate:'2025-06-01', ageAtAcquire:18, initialQty:480, currentQty:0, stage:'CLOSED', acquisitionCost:115200, status:'CLOSED' },
];
export const mockItems: InventoryItem[] = [
  { id:'i1', tenantId:TENANT_ID, name:'Layer Mash', category:'FEED_FINISHED', unit:'kg', lowStockThreshold:50 },
  { id:'i2', tenantId:TENANT_ID, name:'Broiler Starter', category:'FEED_FINISHED', unit:'kg', lowStockThreshold:40 },
  { id:'i3', tenantId:TENANT_ID, name:'Pig Grower Meal', category:'FEED_FINISHED', unit:'kg', lowStockThreshold:60 },
  { id:'i4', tenantId:TENANT_ID, name:'Tilapia Pellets', category:'FEED_FINISHED', unit:'kg', lowStockThreshold:30 },
  { id:'i5', tenantId:TENANT_ID, name:'Newcastle Vaccine', category:'VACCINE', unit:'dose', lowStockThreshold:50 },
  { id:'i6', tenantId:TENANT_ID, name:'Oxytetracycline', category:'MEDICINE', unit:'ml', lowStockThreshold:100 },
  { id:'i7', tenantId:TENANT_ID, name:'Maize (Ingredient)', category:'FEED_INGREDIENT', unit:'kg', lowStockThreshold:100 },
  { id:'i8', tenantId:TENANT_ID, name:'Soya Cake', category:'FEED_INGREDIENT', unit:'kg', lowStockThreshold:80 },
];
export const mockLots: InventoryLot[] = [
  { id:'l1', itemId:'i1', lotNo:'LM-2026-06', qtyOnHand:42, unit:'kg', unitCost:52, receivedDate:'2026-06-10', expiryDate:'2026-09-10' },
  { id:'l2', itemId:'i1', lotNo:'LM-2026-05', qtyOnHand:0, unit:'kg', unitCost:50, receivedDate:'2026-05-15', expiryDate:'2026-08-15' },
  { id:'l3', itemId:'i2', lotNo:'BS-2026-06', qtyOnHand:120, unit:'kg', unitCost:58, receivedDate:'2026-06-01' },
  { id:'l4', itemId:'i3', lotNo:'PG-2026-05', qtyOnHand:200, unit:'kg', unitCost:48, receivedDate:'2026-05-20' },
  { id:'l5', itemId:'i4', lotNo:'TP-2026-06', qtyOnHand:75, unit:'kg', unitCost:65, receivedDate:'2026-06-05' },
  { id:'l6', itemId:'i5', lotNo:'NV-2026-04', qtyOnHand:120, unit:'dose', unitCost:15, receivedDate:'2026-04-01', expiryDate:'2027-04-01', withdrawalDays:7 },
  { id:'l7', itemId:'i6', lotNo:'OTC-2026-05', qtyOnHand:350, unit:'ml', unitCost:3, receivedDate:'2026-05-10', expiryDate:'2027-05-10', withdrawalDays:5 },
];
export const mockTasks: Task[] = [
  { id:'t1', title:'Morning Round', type:'morning_round', assignedTo:'u3', scheduledFor:'2026-06-23', dueAt:'2026-06-23T08:00:00Z', status:'ASSIGNED', overdue:false },
  { id:'t2', title:'Newcastle Vaccine — Layer #003', type:'vaccination', assignedTo:'u3', batchId:'b1', unitId:'unit1', scheduledFor:'2026-06-23', dueAt:'2026-06-23T09:00:00Z', status:'ASSIGNED', overdue:false },
  { id:'t3', title:'Closing Stock Count', type:'stock_count', assignedTo:'u3', scheduledFor:'2026-06-23', dueAt:'2026-06-23T17:00:00Z', status:'ASSIGNED', overdue:false },
  { id:'t4', title:'Weight Sampling — Pig Batch #007', type:'sampling', assignedTo:'u3', batchId:'b3', unitId:'unit4', scheduledFor:'2026-06-22', dueAt:'2026-06-22T09:00:00Z', status:'MISSED', overdue:true },
  { id:'t5', title:'Morning Round', type:'morning_round', assignedTo:'u4', scheduledFor:'2026-06-23', dueAt:'2026-06-23T08:00:00Z', status:'DONE', overdue:false },
];
export const mockAlerts: Alert[] = [
  { id:'a1', severity:'warning', title:'▲ LOW: Layer Mash 42 kg', message:'Layer Mash is at 42 kg — below the 50 kg threshold. Reorder now.', type:'low_stock', createdAt:'2026-06-23T06:00:00Z', acknowledged:false },
  { id:'a2', severity:'critical', title:'⛔ Overdue: Weight Sampling', message:'Weight Sampling for Pig Batch #007 was due yesterday and not completed.', type:'task_missed', createdAt:'2026-06-23T06:30:00Z', acknowledged:false },
  { id:'a3', severity:'warning', title:'▲ Water Quality: Pond 3', message:'Ammonia at 0.8 mg/L — above safe range of 0.5 mg/L. Increase aeration.', type:'water_quality', createdAt:'2026-06-22T14:00:00Z', acknowledged:false },
  { id:'a4', severity:'info', title:'Newcastle Vaccine Due Today', message:'Newcastle Vaccine due for Layer #003 today. Check stock.', type:'overdue_vaccine', createdAt:'2026-06-23T05:00:00Z', acknowledged:false },
];
export const mockEmployees: Employee[] = [
  { id:'u3', tenantId:TENANT_ID, name:'John Otieno', phone:'+254700333444', role:'worker', workerProfileId:'wp1', pinSet:true, active:true },
  { id:'u4', tenantId:TENANT_ID, name:'Mary Achieng', phone:'+254700555666', role:'worker', workerProfileId:'wp1', pinSet:true, active:true },
  { id:'u2', tenantId:TENANT_ID, name:'Amina Wanjiku', phone:'+254700111222', role:'manager', pinSet:true, active:true },
  { id:'u5', tenantId:TENANT_ID, name:'Dr. Kuria Kamau', phone:'+254700777888', role:'vet', pinSet:false, active:true },
];
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
  {
    id:'wp2', tenantId:TENANT_ID, name:'Trusted Lead', description:'Lead worker — sees quantities with costs hidden',
    modules:['morning_round','mortality','feeding','health','weight_sampling','physical_count','closing_stock'],
    mortalityPhotoThreshold:2,
    alertThresholds:{ mortalityRate:3.0, lowStockKg:30 },
    fields:[
      { fieldKey:'feed_unit_cost', label:'Feed unit cost (KES)', permission:'hidden' },
      { fieldKey:'feed_quantity', label:'Feed quantity (kg)', permission:'editable', required:true },
      { fieldKey:'egg_sale_price', label:'Egg sale price', permission:'hidden' },
      { fieldKey:'mortality_cause', label:'Mortality cause', permission:'editable', required:true },
      { fieldKey:'batch_profit_loss', label:'Batch profit/loss', permission:'hidden' },
      { fieldKey:'water_level', label:'Water level', permission:'editable', required:true },
      { fieldKey:'eggs_collected', label:'Eggs collected', permission:'editable', required:true },
      { fieldKey:'abnormal', label:'Abnormal observation', permission:'editable', required:true },
    ],
  },
];
export const mockCostSummaries: BatchCostSummary[] = [
  { batchId:'b5', acquisitionCost:60000, feedCost:280000, healthCost:20000, laborCost:15000, overheadCost:0, totalCost:375000, totalRevenue:330000, grossMargin:-45000, costPerUnit:351, outputUnit:'kg', fcr:2.4, mortalityPct:3.0, breakEvenAge:50 },
  { batchId:'b1', acquisitionCost:120000, feedCost:310000, healthCost:18000, laborCost:22000, overheadCost:0, totalCost:470000, totalRevenue:580000, grossMargin:110000, costPerUnit:18, outputUnit:'crate', fcr:2.1, mortalityPct:3.0 },
  { batchId:'b3', acquisitionCost:200000, feedCost:180000, healthCost:12000, laborCost:18000, overheadCost:0, totalCost:410000, totalRevenue:280000, grossMargin:-130000, costPerUnit:4362, outputUnit:'kg', adg:480, mortalityPct:6.0 },
  { batchId:'b4', acquisitionCost:45000, feedCost:95000, healthCost:5000, laborCost:10000, overheadCost:0, totalCost:155000, totalRevenue:120000, grossMargin:-35000, costPerUnit:182, outputUnit:'kg', fcr:1.8, mortalityPct:5.6 },
];
export const mockSales: Sale[] = [
  { id:'s1', tenantId:TENANT_ID, batchId:'b1', unitId:'unit1', productType:'Eggs', quantity:30, unitPrice:550, totalAmount:16500, buyer:'Market Stall - Mama Njeri', paymentMethod:'cash', status:'PAID', withdrawalCheck:'cleared', createdAt:'2026-06-20T10:00:00Z' },
  { id:'s2', tenantId:TENANT_ID, batchId:'b5', unitId:'unit6', productType:'Broilers (live)', quantity:50, weightKg:110, unitPrice:400, totalAmount:44000, buyer:'Hotel Sarova', paymentMethod:'mpesa', status:'DELIVERED', withdrawalCheck:'cleared', createdAt:'2026-06-18T08:00:00Z' },
  { id:'s3', tenantId:TENANT_ID, batchId:'b1', unitId:'unit1', productType:'Eggs', quantity:15, unitPrice:550, totalAmount:8250, buyer:'Retail Direct', paymentMethod:'mpesa', status:'CREDIT', withdrawalCheck:'cleared', createdAt:'2026-06-22T11:00:00Z' },
];

export const mockHealthRecords: HealthRecord[] = [
  { id:'h1', clientUuid:'uuid-h1', batchId:'b1', type:'VACCINE', productLotId:'l6', dose:100, route:'drinking water', appliedBy:'u3', appliedAt:'2026-06-16T08:00:00Z', nextDueAt:'2026-07-16T08:00:00Z', withdrawalUntil:'2026-06-23T08:00:00Z', status:'synced', capturedAt:'2026-06-16T08:00:00Z' },
  { id:'h2', clientUuid:'uuid-h2', batchId:'b5', type:'MEDICATION', productLotId:'l7', dose:50, route:'injection', appliedBy:'u3', appliedAt:'2026-06-20T09:00:00Z', withdrawalUntil:'2026-06-25T09:00:00Z', status:'synced', capturedAt:'2026-06-20T09:00:00Z' },
];
export const mockPurchases: Purchase[] = [];
