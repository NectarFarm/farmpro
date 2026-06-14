# Multi-Enterprise Roadmap

FarmPro began as a poultry-only system. This document describes how it generalises to support **livestock (pigs, etc.), aquaculture (fish), and crops**, while keeping the poultry experience sharp.

## Core insight

Every farm enterprise shares the same lifecycle skeleton — only the vocabulary and a few modules differ:

| Concept | Poultry | Pigs / livestock | Fish | Crops |
|---|---|---|---|---|
| Batch you raise | flock | herd / pen | pond / tank stock | planting / field |
| Stocking | chicks | piglets | fingerlings | seed |
| Inputs | feed | feed | feed | fertiliser, pesticide, seed |
| Health events | mortality, vaccination | mortality, vaccination | mortality, water treatment | pest / disease, crop loss |
| Growth stages | brooder → layer | weaner → finisher | fry → harvest | germination → harvest |
| Production | eggs | weight gain | weight gain | yield (kg / bags) |
| Sales, Finance, Customers, Employees | shared | shared | shared | shared |

The Finance, Budget, Customer, Sales, Expense and Employee modules are **already enterprise-neutral**. The poultry assumptions live in a handful of enums, a few modules (egg collection, FCR), and the vocabulary.

## Design principles

1. **One codebase, configuration-driven.** No per-vertical forks. A farm picks an *enterprise type*; that drives vocabulary and which modules show.
2. **Lookup tables over enums.** Hardcoded enums become editable tables, exactly like the existing `flock_stages` table (the proven pattern).
3. **Never regress poultry.** Defaults seed the current poultry behaviour so existing farms are unaffected.
4. **Stay shippable each step.** Each PR keeps the app working; no big-bang rewrite.

## Phased delivery

### PR1 — Enterprise foundation (configurable lists)
- `settings.enterprise_type` — `poultry | pigs | fish | crops | mixed`.
- Convert enums to lookup tables (each mirrors `flock_stages`):
  - `cage_type` → **`location_types`** (cage / pen / pond / tank / field / plot)
  - `feed_type` → **`input_types`** (with category: feed / fertiliser / medication / seed; and a unit)
  - `product_type` / `order_product` → **`product_types`** (unit + sold-by: count / weight / tray)
  - `cost_category` → **`cost_categories`**
- Each gets CRUD API, store state, and a Settings section. *(location_types lands first as the reference implementation.)*

### PR2 — Terminology + module visibility
- A terminology map keyed by `enterprise_type` (flock→herd→pond→planting, bird→pig→fish→plant, etc.) driving UI labels.
- Show/hide modules per enterprise: egg collection + FCR for poultry/layers; weight-gain for livestock/fish; yield for crops.

### PR3 — Generalise core entities
- `flocks` → conceptual **batches** (keep table, relabel; add `unit`/`measure`).
- `egg_collections` → **production_records** (type: eggs / weight / milk / yield).
- `mortality_records` → **loss_events** (death / cull / crop loss).
- `vaccination_records` → **health_events** (vaccination / treatment / spray).

### PR4 — Crops
Crops break the per-head counting model, so they get a batch variant:
- Area-based sizing (acres / hectares) instead of head count.
- Seasons / planting & expected-harvest dates.
- Yield-by-weight harvest records; inputs = seed / fertiliser / pesticide.
- No per-animal mortality; "crop loss %" instead.

### PR5 — Polish
- Data migration helpers for existing poultry farms.
- Per-enterprise dashboards, reports, and tests.

## Status
- [ ] PR1 — Enterprise foundation
- [ ] PR2 — Terminology + module visibility
- [ ] PR3 — Generalise core entities
- [ ] PR4 — Crops
- [ ] PR5 — Polish
