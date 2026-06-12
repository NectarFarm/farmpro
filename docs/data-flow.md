# Data Flow & System Diagrams — FarmPro

**Version**: 1.0  
**Date**: 2026-06-12

All diagrams use [Mermaid](https://mermaid.js.org/) syntax. They render natively in GitHub, GitLab, VS Code (with Mermaid extension), and Notion.

---

## 1. System Architecture

High-level view of all containers and communication paths.

```mermaid
graph TB
    subgraph Docker["Docker Compose"]
        direction TB
        DB[(PostgreSQL\n:5432)]
        MIG[migrate\none-shot\ndb:migrate + db:seed]
        APP[farmpro\nNext.js App\n:13000]
    end

    BROWSER[Browser / Mobile\nHTTP Client]

    BROWSER <-->|"HTTP :13000\n(REST API + HTML)"| APP
    APP <-->|Drizzle ORM\nSQL| DB
    MIG -->|"run once\nthen exit"| DB
    MIG -.->|completes before| APP

    style DB fill:#336791,color:#fff
    style APP fill:#000,color:#fff
    style MIG fill:#666,color:#fff
```

---

## 2. Application Layers

Internal structure of the Next.js application.

```mermaid
graph TB
    subgraph Browser
        UI[React Components\ncomponents/pages/]
        STORE[Zustand Store\nlib/store.ts]
    end

    subgraph NextJS["Next.js Server"]
        ROUTES[API Route Handlers\napp/api/]
        AUTH[Auth Middleware\nlib/auth.ts]
        DRIZZLE[Drizzle ORM\ndb/index.ts + schema.ts]
    end

    DB[(PostgreSQL)]

    UI -->|"reads state"| STORE
    UI -->|"calls actions"| STORE
    STORE -->|"fetch()"| ROUTES
    ROUTES -->|requireSession()| AUTH
    AUTH -->|sessions table| DB
    ROUTES -->|db.select/insert/update/delete| DRIZZLE
    DRIZZLE -->|SQL| DB
    STORE -->|"optimistic state update"| UI
```

---

## 3. User Authentication Flow

Covers all three user types: owner, employee, customer.

```mermaid
sequenceDiagram
    actor User
    participant UI as Login Page
    participant Store as Zustand Store
    participant API as /api/auth/login
    participant DB as PostgreSQL

    User->>UI: Enter PIN + select role
    UI->>Store: login(pin, type, entityId?)
    Store->>API: POST { pin, type, entityId }

    alt type = owner
        API->>DB: SELECT ownerPinHash FROM settings
        DB-->>API: hash
        API->>API: compare SHA256(pin) vs hash
    else type = employee
        API->>DB: SELECT pinHash FROM employees WHERE id = entityId
        DB-->>API: hash
        API->>API: compare SHA256(pin) vs hash
    else type = customer
        API->>DB: SELECT pinHash FROM customerPortalUsers WHERE id = entityId
        DB-->>API: hash
        API->>API: compare SHA256(pin) vs hash
    end

    alt PIN matches
        API->>DB: INSERT INTO sessions (id, userType, userId, expiresAt)
        API-->>UI: 200 OK + Set-Cookie: farm_session (HTTPOnly)
        Store->>Store: initialize() — fetch all data
        Store-->>UI: Render role-appropriate shell
    else PIN wrong
        API-->>UI: 401 Unauthorized
        UI-->>User: Show error toast
    end
```

---

## 4. Store Initialization Flow

What happens when the app loads and a session is found.

```mermaid
sequenceDiagram
    participant Page as app/page.tsx
    participant Store as Zustand Store
    participant APIs as 19 API Endpoints

    Page->>APIs: GET /api/auth/session
    alt Session valid
        APIs-->>Page: { userType, userId, userName }
        Page->>Store: initialize()
        Store->>APIs: Promise.allSettled([flocks, mortality, feed, vaccinations, eggs, customers, sales, expenses, budgets, cages, feedInventory, alerts, employees, salaries, orderRequests, birdStageSales, settings, feedDispense, portalUsers])
        APIs-->>Store: All results (fulfilled or rejected)
        Store->>Store: Populate all state slices\n(failed = keep defaults / empty [])
        Store-->>Page: initialized = true
        Page->>Page: Render AppShell / EmployeeShell / CustomerPortal
    else No session
        Page->>Page: Render LoginPage
    end
```

---

## 5. Flock Lifecycle State Machine

A flock moves through these stages in order. Moving backwards is not permitted.

```mermaid
stateDiagram-v2
    [*] --> Brooder : addFlock()

    Brooder --> Grower : Advance stage
    Grower --> Layer : Advance stage
    Layer --> Disposal : Advance stage
    Disposal --> Sold : Advance stage

    Brooder --> [*] : deleteFlock()
    Grower --> [*] : deleteFlock()
    Layer --> [*] : deleteFlock()
    Disposal --> [*] : deleteFlock()
    Sold --> [*] : deleteFlock()

    note right of Brooder : 0–6 weeks\nFeed: Starter
    note right of Grower : 6–16 weeks\nFeed: Grower
    note right of Layer : 16+ weeks\nFeed: Layer\nEgg production begins
    note right of Disposal : Preparing for culling\nFeed: Layer/Finisher
    note right of Sold : Birds sold\nFlock closed
```

---

## 6. flock.currentCount Data Flow

Shows every event that reads or writes the bird count.

```mermaid
flowchart TD
    CREATE[Owner creates flock\ninitialCount = N] -->|SET currentCount = N| COUNT[(flock.currentCount)]

    MORT[Employee logs mortality\ncount = M]
    MORT -->|"POST /api/mortality\nDECREMENT currentCount − M"| COUNT

    SALE[Owner/Employee records bird sale\nquantity = Q]
    SALE -->|"POST /api/sales product=birds\nDECREMENT currentCount − Q"| COUNT

    BSALE[Owner records stage sale\nquantity = B]
    BSALE -->|"POST /api/bird-stage-sales\nDECREMENT currentCount − B"| COUNT

    DSALE[Owner deletes bird sale\nquantity = Q]
    DSALE -->|"DELETE /api/sales/id\nRESTORE currentCount + Q"| COUNT

    DBSALE[Owner deletes stage sale\nquantity = B]
    DBSALE -->|"DELETE /api/bird-stage-sales/id\nRESTORE currentCount + B"| COUNT

    COUNT -->|"Displayed on Flock card,\nDashboard KPI, Sales form"| DISPLAY[UI Display]

    COUNT -->|"Constraint: GREATEST(0, ...)\nnever negative"| CONSTRAINT[Safety Floor = 0]
```

---

## 7. Feed Inventory Data Flow

Shows all reads and writes to feedInventory.currentStockKg.

```mermaid
flowchart TD
    SEED[Seeded stock\ne.g. Layer = 400kg] -->|Initial value| INV[(feedInventory\n.currentStockKg)]

    PURCHASE[Owner logs feed purchase\nFeed Records tab in FlocksPage\nquantityKg = P]
    PURCHASE -->|"POST /api/feed-records\nDECREMENT currentStockKg − P"| INV

    DISPENSE[Employee logs feed dispensed\nEmployeePage\nquantityKg = D]
    DISPENSE -->|"POST /api/feed-dispense\nDECREMENT currentStockKg − D\npersisted in DB"| INV

    MANUAL[Owner manually adds stock\nInventory Page\ndelta = +X]
    MANUAL -->|"PUT /api/feed-inventory\nSET currentStockKg = absolute value"| INV

    INV -->|Read| EMPLOYEE_FORM[Employee Feed Form\nShows available kg per type]
    INV -->|Read| INVENTORY_PAGE[Inventory Page\nStock status: OK / LOW / CRITICAL]
    INV -->|Read| ALERT_CHECK[Alert Generator\nlow_feed if stock < reorderLevel]
    INV -->|Threshold| REORDER[reorderLevelKg\nconfigurable per type]
```

---

## 8. Egg Collection to Sale Flow

Traces an egg from collection to sold, including availability calculation.

```mermaid
flowchart TD
    COLLECT[Employee/Owner logs\negg collection\ncount, broken, sellable]
    COLLECT -->|"POST /api/egg-collections\nstored: count, broken, sellable=count-broken"| EC[(eggCollections)]

    EC -->|Sum all sellable| TOTAL_SELLABLE[totalSellable\n= Σ sellable]
    SALES_DB[(sales\nproduct=eggs)] -->|Sum all quantity| TOTAL_SOLD[totalSold\n= Σ quantity sold as eggs]

    TOTAL_SELLABLE --> AVAILABLE["availableEggs\n= totalSellable − totalSold"]
    TOTAL_SOLD --> AVAILABLE

    AVAILABLE -->|Shown in| SALES_FORM[Sales Form\nstock warning if qty > available]
    AVAILABLE -->|Shown in| INV_PAGE[Inventory Page\nEgg Stock Summary]
    AVAILABLE -->|Shown in| CUST_PORTAL[Customer Portal\nEgg Availability widget]

    SALES_FORM -->|"POST /api/sales product=eggs\nrecord sale"| SALES_DB
```

---

## 9. Sales Deletion Workflow

Two-step deletion for employees; direct deletion for owners.

```mermaid
flowchart TD
    SALE[Sale record\nexists in DB]

    OWNER{Is user\nan owner?}

    SALE --> OWNER

    OWNER -->|Yes| OWNER_DELETE[Owner clicks Delete\nEnters reason]
    OWNER_DELETE -->|"store: deleteSale(id)\nAPI: DELETE /api/sales/id"| DELETED[Sale removed\nFlock count restored if birds]

    OWNER -->|No| EMP_REQUEST[Employee clicks Request Deletion\nEnters mandatory reason]
    EMP_REQUEST -->|"store: requestSaleDeletion(id, reason, name)\nAPI: PUT /api/sales/id { deletionRequested: true, ... }"| PENDING[Sale flagged\ndeletionRequested = true\nAmber highlight in UI]

    PENDING -->|Owner sees pending banner| OWNER_REVIEW{Owner reviews}

    OWNER_REVIEW -->|Approve| APPROVED["store: approveSaleDeletion(id)\nAPI: DELETE /api/sales/id\nFlock count restored if birds"]
    OWNER_REVIEW -->|Reject| REJECTED["store: rejectSaleDeletion(id)\nAPI: PUT /api/sales/id { deletionRequested: false }"]

    APPROVED --> DELETED
    REJECTED --> SALE
```

---

## 10. Revenue Calculation Flow

Shows how all revenue streams combine without double-counting.

```mermaid
flowchart TD
    subgraph Revenue Sources
        ESALES[sales\nproduct = eggs\nΣ totalAmount]
        BSALES[sales\nproduct = birds\nΣ totalAmount]
        BSS[birdStageSales\nΣ totalAmount]
    end

    ESALES --> SALES_REV[salesRevenue\n= egg sales + bird sales]
    BSALES --> SALES_REV
    BSS --> BIRD_STAGE_REV[birdStageRevenue\n= stage sales only]

    SALES_REV --> TOTAL_REV[Total Revenue\n= salesRevenue + birdStageRevenue]
    BIRD_STAGE_REV --> TOTAL_REV

    subgraph Expense Sources
        EXPENSES_TABLE[expenses table\nΣ amount]
        FEED_RECORDS[feedRecords\nΣ totalCost]
        VACC_RECORDS[vaccinationRecords\nΣ cost]
    end

    EXPENSES_TABLE --> TOTAL_EXP[Total Expenses]
    FEED_RECORDS --> TOTAL_EXP
    VACC_RECORDS --> TOTAL_EXP

    TOTAL_REV --> NET[Net P&L\n= Revenue − Expenses]
    TOTAL_EXP --> NET

    NET -->|"Displayed in:\nFinance P&L\nDashboard KPI\n6-month chart"| DISPLAY[UI]
```

---

## 11. Order Request Lifecycle (Customer Portal)

```mermaid
stateDiagram-v2
    [*] --> Pending : Customer places order
    Pending --> Confirmed : Owner/Employee confirms\n(SMS sent to customer)
    Confirmed --> Delivered : Owner/Employee dispatches\n(SMS sent to customer)
    Delivered --> Paid : Owner marks paid\n(SMS sent to customer)
    Pending --> Cancelled : Owner cancels
    Confirmed --> Cancelled : Owner cancels
    Paid --> [*]
    Cancelled --> [*]
```

---

## 12. Complete Entity Relationship Diagram

```mermaid
erDiagram
    settings {
        text id PK
        text ownerPinHash
        numeric pricePerEgg
        numeric pricePerTray
        numeric pricePerChick
        numeric birdPricingBrooder
        numeric birdPricingGrower
        numeric birdPricingLayer
    }

    sessions {
        text id PK
        text userType
        text userId
        text userName
        timestamp createdAt
        timestamp expiresAt
    }

    employees {
        text id PK
        text name
        text pinHash
        text role
        timestamp createdAt
    }

    employeeSalaries {
        text id PK
        text employeeId FK
        text employeeName
        numeric amount
        integer payDayOfMonth
        timestamp createdAt
    }

    cages {
        text id PK
        text name
        text type
        integer capacity
        timestamp createdAt
    }

    flocks {
        text id PK
        text name
        text dateAcquired
        text source
        integer initialCount
        integer currentCount
        numeric purchaseCostPerChick
        numeric initialWeight
        text breed
        text stage
        text cageId FK
        timestamp createdAt
    }

    mortalityRecords {
        text id PK
        text flockId FK
        text date
        integer count
        text cause
        timestamp createdAt
    }

    feedRecords {
        text id PK
        text flockId FK
        text date
        numeric quantityKg
        text feedType
        text feedSource
        numeric costPerKg
        numeric totalCost
        timestamp createdAt
    }

    feedDispenseRecords {
        text id PK
        text flockId FK
        text date
        numeric quantityKg
        text feedType
        text feedSource
        text notes
        timestamp createdAt
    }

    vaccinationRecords {
        text id PK
        text flockId FK
        text vaccineName
        text scheduledDate
        text completedDate
        text dosage
        numeric cost
        timestamp createdAt
    }

    eggCollections {
        text id PK
        text flockId FK
        text date
        integer count
        integer broken
        integer sellable
        timestamp createdAt
    }

    customers {
        text id PK
        text name
        text phone
        text email
        text address
        text type
        timestamp createdAt
    }

    customerPortalUsers {
        text id PK
        text customerId FK
        text name
        text phone
        text pinHash
        timestamp createdAt
    }

    sales {
        text id PK
        text customerId FK
        text flockId FK
        text product
        numeric quantity
        numeric pricePerUnit
        numeric totalAmount
        text date
        boolean deletionRequested
        text deletionReason
        timestamp createdAt
    }

    birdStageSales {
        text id PK
        text flockId FK
        text customerId FK
        text stage
        integer quantity
        numeric pricePerBird
        numeric breakEvenPrice
        numeric totalAmount
        text date
        timestamp createdAt
    }

    expenses {
        text id PK
        text category
        text description
        numeric amount
        text date
        text flockId FK
        timestamp createdAt
    }

    budgets {
        text id PK
        text category
        text period
        numeric amount
        text month
        text flockId FK
        timestamp createdAt
    }

    feedInventory {
        text id PK
        text feedType
        numeric currentStockKg
        numeric reorderLevelKg
        timestamp lastUpdated
    }

    alerts {
        text id PK
        text type
        text message
        text relatedId
        text route
        boolean read
        timestamp createdAt
    }

    orderRequests {
        text id PK
        text customerId FK
        text customerName
        text product
        numeric quantity
        numeric pricePerUnit
        numeric totalAmount
        text status
        text deliveryLocation
        text contactPhone
        boolean paidByCustomer
        boolean deliveryConfirmed
        timestamp createdAt
    }

    employees ||--o{ employeeSalaries : "has salary config"
    cages ||--o{ flocks : "houses"
    flocks ||--o{ mortalityRecords : "has deaths"
    flocks ||--o{ feedRecords : "has feed logs"
    flocks ||--o{ feedDispenseRecords : "has dispense logs"
    flocks ||--o{ vaccinationRecords : "has vaccinations"
    flocks ||--o{ eggCollections : "produces eggs"
    flocks ||--o{ birdStageSales : "has stage sales"
    flocks ||--o{ expenses : "may have expenses"
    customers ||--o{ customerPortalUsers : "may have portal access"
    customers ||--o{ sales : "buys in"
    customers ||--o{ birdStageSales : "may buy birds"
    customers ||--o{ orderRequests : "places orders"
    sales }o--o| flocks : "references flock"
```

---

## 13. API Request/Response Flow (Single Operation)

Example: employee logs feed dispensed to a flock.

```mermaid
sequenceDiagram
    actor Emp as Employee
    participant Form as EmployeePage Form
    participant Store as Zustand Store
    participant API as POST /api/feed-dispense
    participant FeedDB as feedDispenseRecords
    participant InvDB as feedInventory

    Emp->>Form: Select flock, feed type, quantity
    Form->>Form: Compute stockWarning\n(qty > feedInventory.currentStockKg?)
    alt Over stock
        Form-->>Emp: Red warning + submit disabled
    else Within stock
        Emp->>Form: Click Submit Feed Log
        Form->>Store: addFeedDispenseRecord(record)
        Store->>Store: feedDispenseRecords +1\nfeedInventory.currentStockKg − qty\n(optimistic update)
        Store-->>Form: UI reflects new state instantly
        Store->>API: POST /api/feed-dispense { record }
        API->>API: requireSession()
        API->>FeedDB: INSERT INTO feed_dispense_records
        API->>InvDB: UPDATE feed_inventory\nSET currentStockKg = GREATEST(0, current − qty)\nWHERE feedType = type
        API-->>Store: 201 { row }
        Store-->>Emp: toast "Dispensed X kg of layer feed"
    end
```
