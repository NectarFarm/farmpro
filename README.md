# Poultry Farm Management System

A comprehensive, full-stack management platform designed to streamline poultry farm operations, track bird lifecycles, and monitor financial performance. This system provides granular control over production, inventory, and sales through a role-based architecture.

## 🚀 Key Modules

### 📊 Dashboard & Analytics
*   **Real-time KPIs:** Monitor active bird counts, revenue, operational costs, and mortality rates.
*   **Production Trends:** Visualized egg collection and daily revenue charts using Recharts.
*   **Temporal Filtering:** Analyze performance across 7 days, 30 days, monthly, or annual views.

### 🐣 Flock Lifecycle Management
*   **Stage Tracking:** Manage batches through distinct stages: *Brooder* → *Grower* → *Layer* → *Disposal/Sale Stock*.
*   **Health Logs:** Comprehensive vaccination scheduling and mortality tracking with automated rate calculations.
*   **Valuation Engine:** Real-time break-even analysis and margin tracking per flock based on cumulative costs.

### 🥚 Production & Inventory
*   **Egg Collection:** Detailed logging of daily collections with dedicated tracking for breakages and sellable stock.
*   **Feed Management:** Inventory tracking across multiple feed types (Starter, Grower, Layer, Finisher).
*   **FCR Analysis:** Integrated Feed Conversion Ratio (FCR) recommendations to optimize bird nutrition and reduce waste.

### 💰 Financials & Sales
*   **Expense Tracking:** Categorized logging for feeds, vaccines, labor, utilities, and chicks.
*   **Budgeting:** Monthly and cycle-based budget planning with variance analysis.
*   **Sales Workflow:** Secure sales recording for eggs and birds with a mandatory approval workflow for record deletions.

### 👥 Multi-Portal Access
*   **Farm Owner:** Full administrative access to financials, settings, and reporting.
*   **Employee Portal:** Streamlined interface for logging daily operational data (Eggs, Feed, Mortality).
*   **Customer Portal:** Restricted access for registered buyers to view live pricing and submit order requests.

## 🛠 Tech Stack

*   **Frontend:** [Next.js 15+](https://nextjs.org/) (App Router), TypeScript, Tailwind CSS
*   **State Management:** [Zustand](https://github.com/pmndrs/zustand)
*   **Database:** PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
*   **Visualization:** [Recharts](https://recharts.org/)
*   **Icons:** Lucide React

## 📂 Project Structure

```text
├── app/              # Next.js App Router (Pages & API Routes)
├── components/       # UI Components & Role-based Page Modules
├── db/               # Database Schema & Drizzle Configuration
├── lib/              # Core Logic, Store, PDF Generation, & Utils
├── public/           # Static Assets
└── scripts/          # Database Seeding & Build Utilities
```

## ⚙️ Getting Started

### Prerequisites
*   Node.js (LTS)
*   PostgreSQL
*   pnpm (recommended)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Configure environment variables (`.env`):
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/poultry_db
   ```

4. Initialize the database:
   ```bash
   pnpm db:generate
   pnpm db:push
   pnpm db:seed
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

## 📄 License
This project is licensed under the MIT License.
# farmpro
