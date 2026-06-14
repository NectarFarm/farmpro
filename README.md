# FarmPro — Farm Management System

Web-based farm management platform built for Kenyan farms. Role-based access for farm owner, employees, and customers.

Poultry is fully supported today; the system is being generalised into a **multi-enterprise** platform (livestock/pigs, fish/aquaculture, and crops) via a configuration-driven design — see [Multi-Enterprise Roadmap](docs/multi-enterprise.md). A farm picks an **enterprise type** in Settings, and the configurable lists (stages, location types, and more) adapt the system to that enterprise.

## Running the app

```bash
cp .env.example .env          # set SESSION_SECRET (min 32 chars)
docker compose up --build -d  # builds, migrates, seeds, starts on :13000
```

That's it. The compose file handles Postgres, migrations, and seeding automatically.

Default owner PIN: `1234`

## Local development

```bash
pnpm install
# fill DATABASE_URL and SESSION_SECRET in .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev                      # runs on :13000
```

## Testing

Unit and component tests run on [Vitest](https://vitest.dev/) with React Testing Library (jsdom). No database or running server is required — backend logic is tested through pure functions, and store/data-flow integrity is tested directly against the Zustand store with `fetch` stubbed.

```bash
pnpm test              # run the whole suite once
pnpm test:watch        # re-run on change while developing
pnpm test path/to/file # run a single file, e.g. pnpm test lib/__tests__/store.test.ts
```

What's covered:

| Area | File | What it guards |
|---|---|---|
| **Backend utils** | [lib/__tests__/utils.test.ts](lib/__tests__/utils.test.ts) | `stripMeta` strips server timestamps, mortality-rate math, currency/date formatting, demand regression |
| **Backend errors** | [lib/__tests__/errors.test.ts](lib/__tests__/errors.test.ts) | HTTP status mapping; unknown errors masked as 500 (no internal leak) |
| **Data integrity** | [lib/__tests__/store.test.ts](lib/__tests__/store.test.ts) | Bird sales / stage sales / mortality decrement & restore flock counts; feed records & dispensing decrement inventory; counts clamp at 0; salary auto-generation is idempotent |
| **Employee portal** | [components/pages/__tests__/EmployeePage.test.tsx](components/pages/__tests__/EmployeePage.test.tsx) | Flock dropdowns list active flocks, exclude terminal (sold/disposed) flocks, and work with custom (renamed) stage ids |

Tests live in `__tests__/` folders next to the code they cover, named `*.test.ts(x)`. The store tests mirror the server-side side-effects in [app/api/](app/api/), so the optimistic client updates and the database writes stay in agreement.

## What it does

| Module | Highlights |
|---|---|
| **Dashboard** | KPI cards (birds, revenue, costs, mortality), egg & revenue charts, 7d / 30d / month / year filters |
| **Flock Manager** | Configurable lifecycle stages (default: Brooder → Grower → Layer → Disposal/Sold). Per-flock tabs for vaccinations, mortality, feed, egg collection (with breakages), and valuation |
| **Sales** | Egg and bird sales with live stock availability checks. Two-step deletion: employees request with a reason, owner approves |
| **Finance** | P&L statement (egg sales + bird stage sales vs. expenses), 6-month revenue/expense chart, per-category budgets |
| **Inventory** | Feed stock levels (Starter/Grower/Layer/Finisher), configurable reorder alerts, stock-add history |
| **Employees** | Add employees with PINs. Employees log egg collections, feed, and mortality via a simplified portal |
| **Customers** | Customer profiles with order history. Customer portal for pricing and order requests |
| **Settings** | Farm name, **enterprise type** (poultry/pigs/fish/crops/mixed), egg/chick pricing, configurable flock stages (name, order, price per bird, terminal role), configurable **location types** (cage/pen/pond/field…), employee & customer PIN management |

## Tech stack

- **Next.js 16** (App Router, server components + API routes)
- **PostgreSQL** + **Drizzle ORM**
- **Zustand** (API-backed store, optimistic updates)
- **Tailwind CSS v4** + shadcn/ui
- **Recharts**

## Auth

PIN-based, three roles: `owner` / `employee` / `customer`. HTTP-only session cookies, SHA-256 PIN hashing. Default owner PIN is `1234` — change it in Settings after first login.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes | Min 32 chars, used to sign session cookies |
| `PORT` | No | Default `13000` |
| `AT_USERNAME` | No | Africa's Talking username for order-status SMS (server-side only) |
| `AT_API_KEY` | No | Africa's Talking API key. If unset, SMS runs in demo mode (logs only) |

## Documentation

| Document | Description |
|---|---|
| [Requirements](docs/requirements.md) | Functional and non-functional requirements, data requirements |
| [System Design](docs/system-design.md) | Architecture, database schema, API map, auth design, deployment model |
| [Data Flow & Diagrams](docs/data-flow.md) | Mermaid flowcharts: ER diagram, state machines, sequence diagrams |
| [Multi-Enterprise Roadmap](docs/multi-enterprise.md) | How FarmPro generalises to livestock, fish, and crops |
| [Test Plan](docs/test-plan.md) | Unit, API, E2E, security, and performance tests + pre-deployment checklist |
| [Contributing](docs/CONTRIBUTING.md) | Coding standards and conventions for contributors |

## Not yet implemented (roadmap)

- FCR-based reorder level suggestions in Inventory
- PDF/Excel export for Inventory (currently JSON)
- Payroll automation
