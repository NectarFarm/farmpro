> **As-built revision — 2026-06-24.** Updated to match the implemented system. The original inception version is preserved untouched at `docs/inception/CONCEPT_NOTE.md`. See `docs/AS_BUILT.md` for the full deviation list.

# Integrated Farm Management System (IFMS)
### A Mobile-First Operating System for Diversified Smallholder Farms

**Concept Note · Investor Brief**

| | |
|---|---|
| **Prepared by** | Kutswa |
| **Date** | June 2026 |
| **Location** | Kenya |
| **Stage** | Pre-seed / Pilot-ready |
| **Ask** | _[Insert funding amount and use of funds — see Section 9]_ |

---

## 1. The One-Line Pitch

**IFMS is the operating system for the modern African farm** — a dual-portal mobile and web platform that turns the daily reality of a mixed farm (poultry, pigs, fish, and crops) into structured data, so owners can see their costs, yields, and profit per animal in real time, and run the farm even when they are not standing in it.

---

## 2. The Problem

A growing class of Kenyan entrepreneurs are running **diversified farms** — chickens, pigs, fish, and crops on the same land. This model is resilient and profitable on paper. In practice, it is almost impossible to manage well, for four reasons.

### 2.1 The farm runs on memory, not data
Feed levels, mortalities, vaccinations, eggs collected, and money spent live in notebooks, WhatsApp messages, and the head of whoever was on site that day. The owner cannot answer simple, decision-critical questions:

- *How much feed is left right now, and when do I need to reorder?*
- *Which batch of birds is actually making me money?*
- *Why did this cohort of pigs cost more to raise than the last one?*

### 2.2 The owner and the worker are not on the same page
Most owners are not on the farm full-time. They depend on an employee to feed animals, collect produce, and notice problems. But there is no structured, accountable way to:
- assign what should be recorded each day,
- know **who** recorded a mortality and **prove** it with a photo,
- confirm a vaccine was actually given on schedule.

When the owner is away, the farm runs on trust. Trust does not scale.

### 2.3 The owner is financially blind
Without tracking cost **per cage, per pen, per pond, per plot**, an owner cannot tell which part of the farm subsidizes which. Feed waste, over-medication, and unprofitable batches hide inside a single bank balance.

### 2.4 The whole sector is invisible to capital
Banks, agri-lenders, and impact investors want to fund farms — but they need evidence: baselines, trends, yields, unit economics. A farm with no data is **uninvestable**, no matter how good the operator is. This is the gap that keeps capable smallholders small.

> **The core insight:** The problem is not that farmers lack effort. It is that the most important asset on the farm — operational data — is being thrown away every single day.

---

## 3. The Solution

IFMS captures that data at the point it is created — by the worker, on a phone, in under two minutes a task — and turns it into decisions, money insight, and a fundable track record for the owner.

### 3.1 What makes it intentional, not generic

**Two portals, one source of truth.**

| | **Owner Portal** (Web + Mobile) | **Worker Portal** (Mobile-first) |
|---|---|---|
| **User** | Farm owner / manager | Field employee |
| **Sees** | Full dashboard, costs, profit, analytics, reports | Only assigned daily tasks and the data they enter |
| **Controls** | **Decides exactly what the worker portal shows and what is hidden** | Nothing is hidden *from them that they need*; everything else is abstracted away |
| **Job to be done** | Decide, fund, and grow | Record reliably, fast |

> **The defining design principle:** The owner configures the worker's portal. Financials, margins, and strategy stay with the owner. The worker sees a clean, simple checklist — nothing more, nothing less than their job requires. This is what makes the tool trustworthy to the owner and usable for the worker.

**Built for the real Kenya.**
- **Offline-first:** the worker's phone records data with or without network and syncs when signal returns. Rural connectivity will not break the workflow.
- **Two-minute interactions:** if data entry is slow, workers fake it. Every form is designed to be fast, or the whole system fails.
- **Value for the worker too:** the worker gets a live "feed remaining" view so they never run out and get blamed. They have a reason to keep the data honest.
- **An AI advisor on top of the data:** owners and managers get a built-in AI farm advisor that answers questions grounded in their own live farm data — current KPIs, batches, open alerts, low stock, and recent production — turning the captured record into plain-language guidance.

### 3.2 What it tracks — the full farm ecocycle

1. **Production units & batches** — Define cages, pens, ponds, and plots. Group animals into batches by age/cohort. Move batches between units. Add new species (goats, cattle, bees) without rebuilding anything.
2. **Feed & inventory** — Log feed and raw ingredients, purchases and costs, mixed-feed recipes, and allocation of a labelled feed to the specific batch that uses it. System auto-calculates consumption and flags low stock.
3. **Health & vaccination** — Record every vaccine/treatment against a batch, with auto-scheduled next-due reminders, cost, and a photo. *Nothing applied is ever lost.*
4. **Mortality** — Log deaths by batch, **tagged with who recorded it and a timestamped photo** for accountability and remote diagnosis.
5. **Production & harvest** — Each batch defines its **own products** with priced sale units and collection frequencies, so the system is enterprise-specific rather than egg-centric: a layer batch tracks eggs and manure, a broiler or pig batch tracks meat, a pond tracks fish, a plot tracks grain. A pig or maize farm never sees an egg field. Products and their prices are the farmer's own — fully editable, not hard-coded.
6. **Financials** — Cost per production unit using activity-based costing (chick/fingerling + feed + meds + labor ÷ output). Profit & loss by species, batch, and period. Break-even per cycle.
7. **Dashboard & reporting** — Owner's executive dashboard with the metrics that matter, plus **exportable, visual reports (PDF/Excel/CSV)** ready for an investor, a lender, or the owner's own planning.

---

## 4. How We Measure Whether It Works

We do not assume impact — we instrument it. The system captures a **baseline in Month 1**, then reports improvement against it.

**Operational metrics**
- **Feed Conversion Ratio (FCR)** per batch — the single most powerful efficiency number; feed is the largest cost.
- **Mortality rate** per batch, mapped to the day of cycle — so spikes point to a cause.
- **Production per unit** — eggs per hen, kg per pond, yield per plot.
- **Inventory accuracy** — recorded stock vs. physical count.

**Financial metrics**
- **Gross margin per cage/pen/pond/plot.**
- **Cost of production per unit** (per crate of eggs, per kg of fish/pork).
- **Break-even age** per cycle.

**Investor & impact metrics**
- Output per square meter (land-use efficiency).
- Jobs supported and worker hours (livelihood impact, SDG 8).
- Total food produced in kg (food security, SDG 2).
- Resource efficiency — e.g., fish-pond water reused for crop irrigation.

> Targets (e.g., "reduce FCR by 15%, mortality by 20% in Year 1") should be set against the pilot farm's real baseline once Month 1 data is in — we will not publish numbers we cannot stand behind.

---

## 5. The Market & Why Now

- Diversified smallholder and SME farms are a large, underserved segment across Kenya and the wider region.
- Mobile penetration and mobile-money behavior mean farmers and workers already operate on phones.
- Lenders and agri-investors are actively looking for farms with verifiable data to fund — IFMS makes its users fundable, which compounds the platform's value.

> _Note: insert specific, sourced market-size figures here before sending to an investor — do not use estimates you cannot defend in the room._

---

## 6. Business Model

IFMS is a multi-tenant SaaS platform — each farm is an isolated tenant on a single shared service, with subscription tiers and per-feature access wired into the product. Revenue lines:
- **Tiered subscription** per farm — **free / standard / pro** plans, with individual features (advanced reporting, the AI advisor, and more) gated by plan and toggled per farm from a platform admin dashboard.
- **Premium analytics & reporting** (donor/lender-ready report packs) on the higher tiers.
- **Future:** facilitation fees from connecting data-rich farms to lenders, input suppliers, and buyers.

The first goal is not revenue — it is **proving retention and impact on the pilot farm**, which de-risks everything after it.

---

## 7. Why This Is Defensible

| | Typical farm app | **IFMS** |
|---|---|---|
| Worker portal | Limited or none | Full, **owner-configured** |
| Offline | Rare | Core design principle |
| Photos | Basic | On every record type, with accountability |
| Multi-species | Usually one | Diversified from day one |
| Owner control of visibility | Shared/equal access | Owner controls what the worker sees |
| Cost tracking | Farm-level | **Per production unit** |
| Investor reporting | Afterthought | Built in from the start |

The moat is **the data and the workflow trust**: once a farm runs on IFMS, its history, costs, and reporting live here — and that history is exactly what unlocks its financing.

---

## 8. Roadmap

| Phase | Timeline | Goal |
|---|---|---|
| **1 — Pilot build** | Months 0–3 | Worker mobile app + owner dashboard, built as a single full-stack web/mobile application; **built and proven**, ready to deploy on founder's own farm |
| **2 — Prove it** | Months 1–6 | Baseline → first measured improvements in FCR, mortality, cost visibility |
| **3 — Impact report** | Month 6 | Documented before/after results — the asset that raises the next round |
| **4 — Early expansion** | Months 6–12 | Onboard 5–10 neighboring farms; validate willingness to pay |

---

## 9. The Ask

_[Specify here:]_
- **Amount sought:** _[KES / USD __]_
- **Use of funds:** product build, pilot deployment, founder/operations runway for ___ months.
- **What the investor gets:** _[equity %, convertible terms, or grant milestones]_.
- **Milestones this funds:** working product + a documented, data-backed impact report from a live farm — the proof needed to raise and scale.

---

## 10. Why Me

_[2–4 sentences in your own voice: that you own and operate a real diversified farm in Kenya (chickens, pigs, fish, crops); that you live the problem daily; that you are building the tool you yourself need; and that this gives you a built-in pilot site and authentic credibility no outside founder can match.]_

---

> **IFMS turns the everyday farmer into a data-driven enterprise — and a data-driven enterprise into a fundable one.**
