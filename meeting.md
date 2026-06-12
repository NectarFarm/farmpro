MEETING MINUTES
Poultry Farm Management System — UI Review & Validation
Date
June 6, 2025
Meeting Type
Product Review & Validation — UI Prototype Walkthrough
Platform
Google Meet (Virtual)
Prepared By
Meeting Secretary
Distribution
Farm Owner, Development Team, Angel (Stakeholder)

1. Attendees
The following individuals participated in the meeting:
    • Farm Owner (System Client / Primary Stakeholder)
    • Development Team Lead (System Presenter)
    • Angel (Stakeholder — joined mid-session)
    • Additional team members (audio/connectivity troubleshooting noted)

2. Meeting Objective
The primary objective of this meeting was to present and validate a prototype user interface (UI) for a Poultry Farm Management System developed for the client. The development team sought feedback and confirmation from stakeholders that the proposed modules, features, and workflows aligned with business requirements.

3. System Overview
The system is a web-based farm management platform designed to manage poultry operations including flock lifecycle tracking, expense management, egg collection, sales, and analytics. It is architected with role-based access for three user types:
    • Farm Owner — Full access to all data, settings, and reports.
    • Farm Employee — Operational data entry (egg collection, feed logging, mortality recording).
    • Customer — Limited portal access for placing orders and viewing pricing.
The system also incorporates a login/PIN-based authentication mechanism, with the intention to scale to multiple farm owners in future.

4. Module-by-Module Review
4.1 Dashboard (Farm Owner View)
The dashboard is the landing page upon login. It was presented and reviewed with the following key components:
    • Active Birds: Displays the current count of live birds (e.g., 1,175 active after 25 deaths from an original 1,200).
    • Active Flocks: Shows the number of bird batches currently in the system (3 batches presented).
    • Revenue: Displays income generated from egg or bird sales, with profit/loss indication.
    • Cost of Operations: Aggregates all recorded expenses including feeds, vaccinations, chick purchase costs, and employee salaries.
    • Mortality Rate: Calculated as the number of deaths against the original flock count (e.g., 25 deaths = 2% mortality).
    • Egg Production Chart: Daily egg collection displayed as a line graph to identify production trends.
    • Daily Revenue Chart: Hover-enabled bar chart showing revenue per day.
    • Active Flocks Summary: Quick-view listing of current flock groups.
    • Quick Stats Panel: Unread alerts count, overdue vaccinations, monthly expenses summary, and total customer count.
Filtering Options: The dashboard supports filtering data by 7 days, 30 days, and by month.
    • Agreed Addition: Annual filter option to be added, enabling daily, weekly, monthly, and yearly views for financial analysis purposes.
4.2 Flock Manager
The Flock Manager module enables the creation and management of bird batches (flocks). Each flock can be independently tracked through distinct lifecycle stages.
    • Flock Lifecycle Stages: Brooder → Grower → Layers → Disposal/Sale Stock
    • Advancing a Flock: Users can promote a flock to the next stage using the 'Advance Stage' function.
    • Flock Details Form: Name, breed, source/supplier, cost, initial count, initial weight.
    • Per-Flock Tabs:
    • Vaccination: Vaccine name, scheduled date, cost, and optional notes.
    • Mortality: Date, number of deaths, running log with timestamps.
    • Feeds: Category selection, quantity (kg), and total cost.
    • Egg Collection: Number of eggs collected per session.
    • Valuation: Estimated minimum sale value of current flock based on cumulative costs incurred.
    • Agreed Clarification: Vaccination records and mortality logs are immutable after entry (grayed-out/non-editable dates) to maintain data integrity. Mortality records carry timestamps to ensure chronological accuracy.
    • Agreed Addition: A fourth stage ('Disposal/Sale Stock') to be added to the lifecycle. Ability to select the type of bird when advancing stages.
4.3 Expenses & Budgeting
This module handles financial tracking at both the planning and operational levels.
    • Monthly Budget: Farm owner sets a budget per expense category (Feeds, Vaccines, Medications, Labour, Utilities, Chicks, Miscellaneous).
    • Expense Categories: Main categories with optional subcategories (e.g., Feeds > Starter Mash, Grower Mash, Layer Mash).
    • Expense Logging: Expenses can be recorded and assigned to specific flocks (e.g., medication for a specific batch).
    • Budget Breakdown Chart: Pie/bar chart showing proportional spend across categories.
    • Six-Month Expense Overview: Historical breakdown of all recorded expenses over six months.
    • Miscellaneous Expenses: Captures unplanned costs such as repairs and ad hoc purchases.
    • Agreed Addition: Feed subcategories to be expanded for granular tracking. A 'Jogos' (cockerel) category to be considered as a procurement line item.
4.4 Feed Management & Inventory
The inventory module tracks feed stock levels across four feed types: Starter, Grower, Layer, and Finisher.
    • Reorder Alerts: Each feed category has a configurable reorder threshold (e.g., alert when below 20 kg).
    • Stock Additions: New stock can be recorded directly from the inventory module with supplier/source details.
    • Stock Transaction History: Exportable log of all stock additions.
    • Key Discussion — Feed Conversion Ratio (FCR): Stakeholders requested that the system incorporate stage-specific FCR averages (e.g., Chick = 10g/day, Grower = 25–30g/day, Layer = [to be researched]) to automatically compute daily feed consumption based on flock size. This should inform reorder level recommendations and support feed issuance management.
    • Agreed Addition — Feed Source Tracking: A dropdown field to be added to feed entries to indicate whether the feed was 'Purchased' or 'Produced on-farm' (as some farmers mix their own feed).
4.5 Egg Collection & Management
Egg collection is recorded per flock session. The system tracks daily egg production and feeds into the dashboard analytics.
    • Recording Unit: Eggs recorded in individual units, with provision to convert to trays for reporting.
    • Key Discussion — Breakage Tracking: Stakeholders raised the need to separately record broken eggs at the point of collection. Broken eggs represent a loss (consumed on-farm, not sold) and must be accounted for to maintain accurate stock and revenue reconciliation. Example: Collect 415 eggs, 6 broken = 409 sellable eggs.
    • Agreed Addition: A 'Breakages' field to be added to the egg collection form. Breakage quantities to be treated as a loss item in financial reporting.
4.6 Sales & Customer Management
The sales module manages all commercial transactions.
    • Sales Recording: Captures product type (eggs, birds), quantity, customer, and price per unit.
    • Revenue Tracking: Auto-updates total revenue metrics on the dashboard.
    • Customer Profiles: Name, phone number, email (optional), address, customer type (retail/bulk), and full order history with revenue totals.
    • Bulk Customer Management: Repeat/bulk buyers can be pre-registered for fast order entry.
    • Sales Deletion Workflow: Delete function is present but requires a workflow review.
    • Agreed — Sales Deletion Governance: Sale deletions must require: (1) a mandatory reason/justification from the initiator, and (2) approval from the farm manager/owner before the record is removed. This prevents unauthorized deletion of sales records by employees.
4.7 Analytics
The analytics module provides insight into production, sales, and customer trends.
    • Average Daily Egg Production: Calculated over the selected period (7, 30, 90 days, or custom date range).
    • Best Customer Ranking: Identifies top customers by revenue within the selected period.
    • Weekly Sales Volume: Trend chart for egg sales quantities.
    • Customer Demand Over Time: Demand trend analysis (noted as work-in-progress).
    • Price Trend Analysis: Pricing movements over time.
    • Demand Projection vs. Actuals: Forecasting module (noted as not yet fully configured).
    • Custom Date Range: Start and end date selectors for flexible reporting periods.
4.8 Reporting
The system can generate printable/downloadable PDF reports containing:
    • Total Revenue breakdown
    • Cost and Expense summaries
    • Net profit/loss calculations
    • Flock performance data
Report Variants: A filtered 'AKASF-only' report can be generated for sharing with external stakeholders (e.g., workers), which omits sensitive financial data.
    • Agreed: Report structure and layout to be finalised in collaboration with the farm owner to ensure the format meets operational and financial reporting needs.
4.9 Notifications & Alerts
    • Unread notification badge on dashboard quick stats.
    • Alerts for overdue vaccinations.
    • Alerts when feed stock falls below configured reorder threshold.
    • Notifications visible and dismissible once read.
4.10 Settings & Configuration
    • Farm Name: Configurable — used in report headers.
    • Currency: Currency selection (all monetary values to be displayed in Kenya Shillings — KES).
    • Product Pricing: Set default prices per egg, per tray, per chick, and per bird at each lifecycle stage.
    • Employee Management: Add employees with name and PIN. Assign salary amounts and payroll dates (auto-logged as a recurring monthly expense).
    • Alert Thresholds: Configurable reorder levels per feed category.
    • Cage/Section Management: Tracks physical housing sections for birds.
    • PIN Management: Separate PINs for owner, employees, and customers.
4.11 Employee Portal
Employees log in with their assigned PIN and access a simplified interface:
    • Today's Activity Summary: Eggs collected, mortality logged, and alerts.
    • Egg Collection Form: Select flock, enter quantity, submit.
    • Mortality Logging: Select flock, record number of deaths and date.
    • Agreed Addition: Employee portal to include a feed logging function (recording actual feeds dispensed to birds per session), separate from feed stock purchases.
4.12 Customer Portal
Customers can be granted limited system access via a PIN:
    • View pricing: Price per egg and price per tray.
    • View farm contact and location details.
    • Submit orders: Select product type, enter quantity, submit.
    • Order notification: Farm owner/system receives an alert upon customer order submission.

5. Key Decisions & Agreements
#
Decision / Agreement
Module
Status
1
Add yearly filter to dashboard (daily / weekly / monthly / annual)
Dashboard
Agreed
2
Currency to be standardised to Kenya Shillings (KES) throughout all modules
System-wide
Agreed
3
Sales deletions to require mandatory reason entry and manager approval
Sales
Agreed
4
Feed entries to include 'Purchased' vs 'Produced on-farm' dropdown
Feed Mgmt
Agreed
5
Egg collection form to include a 'Breakages' field
Eggs
Agreed
6
Incorporate stage-based Feed Conversion Ratio (FCR) for reorder calculations
Inventory
Agreed
7
Add fourth flock lifecycle stage: Disposal / Sale Stock
Flock Mgmt
Agreed
8
Employee portal to include feed dispensing log functionality
Employee
Agreed
9
Report layout and structure to be co-designed with farm owner
Reporting
Agreed
10
System to track and value all farm products (eggs, birds, manure) individually
Valuation
Future
11
Payroll automation module to be considered at a later development stage
Payroll
Future

6. Action Items
#
Action Item
Owner
Priority
1
Add annual filter to all dashboard charts and KPI widgets
Dev Team
High
2
Standardise all currency display to Kenya Shillings (KES)
Dev Team
High
3
Implement two-step deletion workflow for sales records (reason + manager approval)
Dev Team
High
4
Add 'Purchased / Produced on-farm' dropdown to feed entry forms
Dev Team
Medium
5
Add 'Breakages' field to egg collection form; treat breakages as loss in reporting
Dev Team
High
6
Research and document FCR averages per lifecycle stage (Chick, Grower, Layer)
Farm Owner + Dev
Medium
7
Integrate FCR into inventory reorder level calculations
Dev Team
Medium
8
Add fourth flock lifecycle stage and stage-type selection on advancement
Dev Team
Medium
9
Add feed dispensing log to employee portal
Dev Team
Medium
10
Add optional notes field to vaccination records (display in flock detail view)
Dev Team
Low
11
Collaborate with farm owner to finalise report structure and layout
Dev Team + Owner
Medium
12
Remove JSON export option from inventory; replace with Excel or PDF export
Dev Team
Low
13
Review and finalise bird valuation module logic across all product types
Dev Team
Future
14
Evaluate payroll automation module requirements for future development
Dev Team
Future

7. Items Deferred to Future Development
    • Payroll automation and payslip generation.
    • Full multi-product valuation (eggs, birds, manure) with individual pricing and sale workflow.
    • Customer refund/credit note workflow.
    • Broiler/dual-purpose bird support (current scope is layers only).
    • Delivery tracking and logistics management.
    • Multi-farm / multi-owner SaaS model (planned long-term).

8. Other Notes
    • Technical: Minor connectivity and audio issues were experienced during the session (Wi-Fi instability, microphone permissions). These did not materially impact the agenda.
    • UI/UX: Stakeholder (Angel) requested the inclusion of yellow as an accent colour in the employee portal interface. This has been incorporated.
    • Security: The login PIN system is designed to support multi-user access. Employee and customer portals are intentionally restricted in scope to prevent exposure of sensitive financial data.
    • Terminology: 'Jogos' refers to cockerels. Where mixed-stock batches are managed, pricing and lifecycle logic will require separate handling.

9. Next Steps
The development team will implement all agreed changes and additions from this review session. A follow-up review meeting will be scheduled once the updated prototype is ready for validation.
    1. Development team to implement all agreed action items (see Section 6 above).
    2. Farm owner and development team to collaborate on FCR data research and report format design.
    3. Follow-up validation meeting to be scheduled upon completion of the updated prototype.

Prepared by: ___________________________     Date: _______________
Approved by: ___________________________     Date: ____________