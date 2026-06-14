# FarmPro — Poultry Farm Management System

Web-based management platform for Kenyan poultry operations. Role-based access for farm owner, employees, and customers.

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
pnpm dev                      # runs on :3000
```

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
| **Settings** | Farm name, egg/chick pricing, configurable flock stages (name, order, price per bird, terminal role), employee & customer PIN management |

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

## Documentation

| Document | Description |
|---|---|
| [Requirements](docs/requirements.md) | Functional and non-functional requirements, data requirements |
| [System Design](docs/system-design.md) | Architecture, database schema, API map, auth design, deployment model |
| [Data Flow & Diagrams](docs/data-flow.md) | Mermaid flowcharts: ER diagram, state machines, sequence diagrams |
| [Test Plan](docs/test-plan.md) | Unit, API, E2E, security, and performance tests + pre-deployment checklist |

## Not yet implemented (roadmap)

- FCR-based reorder level suggestions in Inventory
- PDF/Excel export for Inventory (currently JSON)
- Payroll automation
