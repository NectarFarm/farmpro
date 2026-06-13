import {
  pgTable, pgEnum, text, integer, numeric, boolean, timestamp,
} from 'drizzle-orm/pg-core'

// ─── Flock Stages (configurable) ──────────────────────────────────────────────

export const flockStages = pgTable('flock_stages', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayOrder: integer('display_order').notNull().default(0),
  role: text('role'), // null = growth, 'sold' = terminal sold, 'disposed' = terminal disposed
  pricePerBird: numeric('price_per_bird', { precision: 10, scale: 2 }).notNull().default('0'),
})

// ─── Enums ────────────────────────────────────────────────────────────────────

// flock_stage enum removed — stages are now stored in the flock_stages table
export const feedTypeEnum = pgEnum('feed_type', ['starter', 'grower', 'layer', 'finisher'])
export const feedSourceEnum = pgEnum('feed_source', ['purchased', 'produced'])
export const customerTypeEnum = pgEnum('customer_type', ['retail', 'restaurant', 'bakery', 'wholesale'])
export const productTypeEnum = pgEnum('product_type', ['eggs', 'birds'])
export const costCategoryEnum = pgEnum('cost_category', ['feed', 'vaccines', 'medications', 'labour', 'utilities', 'chicks', 'miscellaneous'])
export const budgetPeriodEnum = pgEnum('budget_period', ['monthly', 'cycle'])
export const cageTypeEnum = pgEnum('cage_type', ['brooder', 'grower', 'layer'])
export const alertTypeEnum = pgEnum('alert_type', ['vaccination_overdue', 'high_mortality', 'budget_alert', 'low_feed', 'cage_capacity'])
export const sessionUserTypeEnum = pgEnum('session_user_type', ['owner', 'employee', 'customer'])
export const orderStatusEnum = pgEnum('order_status', ['pending', 'confirmed', 'delivered', 'paid', 'cancelled'])
export const orderProductEnum = pgEnum('order_product', ['eggs', 'tray', 'chicks'])

// ─── Settings (single row, id = 'default') ────────────────────────────────────

export const settings = pgTable('settings', {
  id: text('id').primaryKey().default('default'),
  ownerPinHash: text('owner_pin_hash').notNull(),
  pricePerEgg: numeric('price_per_egg', { precision: 10, scale: 2 }).notNull().default('18'),
  pricePerTray: numeric('price_per_tray', { precision: 10, scale: 2 }).notNull().default('450'),
  pricePerChick: numeric('price_per_chick', { precision: 10, scale: 2 }).notNull().default('120'),
})

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userType: sessionUserTypeEnum('user_type').notNull(),
  userId: text('user_id'),
  userName: text('user_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
})

// ─── Employees ────────────────────────────────────────────────────────────────

export const employees = pgTable('employees', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  pinHash: text('pin_hash').notNull(),
  role: text('role').notNull().default('employee'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Cages ────────────────────────────────────────────────────────────────────

export const cages = pgTable('cages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: cageTypeEnum('type').notNull(),
  capacity: integer('capacity').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Flocks ───────────────────────────────────────────────────────────────────

export const flocks = pgTable('flocks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  dateAcquired: text('date_acquired').notNull(),
  source: text('source').notNull(),
  initialCount: integer('initial_count').notNull(),
  currentCount: integer('current_count').notNull(),
  purchaseCostPerChick: numeric('purchase_cost_per_chick', { precision: 10, scale: 2 }).notNull(),
  initialWeight: numeric('initial_weight', { precision: 10, scale: 2 }).notNull(),
  breed: text('breed').notNull(),
  stage: text('stage').notNull(),
  cageId: text('cage_id').references(() => cages.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Mortality Records ────────────────────────────────────────────────────────

export const mortalityRecords = pgTable('mortality_records', {
  id: text('id').primaryKey(),
  flockId: text('flock_id').notNull().references(() => flocks.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  count: integer('count').notNull(),
  cause: text('cause'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Feed Records (stock purchases) ──────────────────────────────────────────

export const feedRecords = pgTable('feed_records', {
  id: text('id').primaryKey(),
  flockId: text('flock_id').notNull().references(() => flocks.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  quantityKg: numeric('quantity_kg', { precision: 10, scale: 2 }).notNull(),
  feedType: feedTypeEnum('feed_type').notNull(),
  feedSource: feedSourceEnum('feed_source').notNull(),
  costPerKg: numeric('cost_per_kg', { precision: 10, scale: 2 }).notNull(),
  totalCost: numeric('total_cost', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Feed Dispense Records (employee logs) ────────────────────────────────────

export const feedDispenseRecords = pgTable('feed_dispense_records', {
  id: text('id').primaryKey(),
  flockId: text('flock_id').notNull().references(() => flocks.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  quantityKg: numeric('quantity_kg', { precision: 10, scale: 2 }).notNull(),
  feedType: feedTypeEnum('feed_type').notNull(),
  feedSource: feedSourceEnum('feed_source').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Vaccination Records ──────────────────────────────────────────────────────

export const vaccinationRecords = pgTable('vaccination_records', {
  id: text('id').primaryKey(),
  flockId: text('flock_id').notNull().references(() => flocks.id, { onDelete: 'cascade' }),
  vaccineName: text('vaccine_name').notNull(),
  scheduledDate: text('scheduled_date').notNull(),
  completedDate: text('completed_date'),
  dosage: text('dosage'),
  cost: numeric('cost', { precision: 10, scale: 2 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Egg Collections ──────────────────────────────────────────────────────────

export const eggCollections = pgTable('egg_collections', {
  id: text('id').primaryKey(),
  flockId: text('flock_id').notNull().references(() => flocks.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  count: integer('count').notNull(),
  broken: integer('broken').notNull(),
  sellable: integer('sellable').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Customers ────────────────────────────────────────────────────────────────

export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  address: text('address'),
  type: customerTypeEnum('type').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Customer Portal Users ────────────────────────────────────────────────────

export const customerPortalUsers = pgTable('customer_portal_users', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  pinHash: text('pin_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Sales ────────────────────────────────────────────────────────────────────

export const sales = pgTable('sales', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  flockId: text('flock_id').references(() => flocks.id, { onDelete: 'set null' }),
  product: productTypeEnum('product').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  pricePerUnit: numeric('price_per_unit', { precision: 10, scale: 2 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  date: text('date').notNull(),
  notes: text('notes'),
  deletionRequested: boolean('deletion_requested').default(false),
  deletionReason: text('deletion_reason'),
  deletionRequestedBy: text('deletion_requested_by'),
  deletionRequestedAt: text('deletion_requested_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Expenses ─────────────────────────────────────────────────────────────────

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey(),
  category: costCategoryEnum('category').notNull(),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  date: text('date').notNull(),
  flockId: text('flock_id').references(() => flocks.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Budgets ──────────────────────────────────────────────────────────────────

export const budgets = pgTable('budgets', {
  id: text('id').primaryKey(),
  category: costCategoryEnum('category').notNull(),
  period: budgetPeriodEnum('period').notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  month: text('month'),
  flockId: text('flock_id').references(() => flocks.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Feed Inventory ───────────────────────────────────────────────────────────

export const feedInventory = pgTable('feed_inventory', {
  id: text('id').primaryKey(),
  feedType: feedTypeEnum('feed_type').notNull().unique(),
  currentStockKg: numeric('current_stock_kg', { precision: 10, scale: 2 }).notNull(),
  reorderLevelKg: numeric('reorder_level_kg', { precision: 10, scale: 2 }).notNull(),
  lastUpdated: timestamp('last_updated').notNull().defaultNow(),
})

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey(),
  type: alertTypeEnum('type').notNull(),
  message: text('message').notNull(),
  relatedId: text('related_id'),
  route: text('route'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Employee Salaries ────────────────────────────────────────────────────────

export const employeeSalaries = pgTable('employee_salaries', {
  id: text('id').primaryKey(),
  employeeId: text('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  employeeName: text('employee_name').notNull(),
  amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
  payDayOfMonth: integer('pay_day_of_month').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Order Requests ───────────────────────────────────────────────────────────

export const orderRequests = pgTable('order_requests', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  customerName: text('customer_name').notNull(),
  product: orderProductEnum('product').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  pricePerUnit: numeric('price_per_unit', { precision: 10, scale: 2 }).notNull().default('0'),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  status: orderStatusEnum('status').notNull().default('pending'),
  deliveryLocation: text('delivery_location').notNull(),
  contactPhone: text('contact_phone').notNull(),
  notes: text('notes'),
  requestedDate: text('requested_date').notNull(),
  paidByCustomer: boolean('paid_by_customer').notNull().default(false),
  deliveryConfirmed: boolean('delivery_confirmed').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Bird Stage Sales ─────────────────────────────────────────────────────────

export const birdStageSales = pgTable('bird_stage_sales', {
  id: text('id').primaryKey(),
  flockId: text('flock_id').notNull().references(() => flocks.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  quantity: integer('quantity').notNull(),
  pricePerBird: numeric('price_per_bird', { precision: 10, scale: 2 }).notNull(),
  breakEvenPrice: numeric('break_even_price', { precision: 10, scale: 2 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 10, scale: 2 }).notNull(),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  date: text('date').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
