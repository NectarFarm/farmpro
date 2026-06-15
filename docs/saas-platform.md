# SaaS Platform Roadmap

FarmPro is moving from a **single-farm app** to a **multi-tenant SaaS** where a *platform admin* (the platform owner) manages many *farmers* (tenants), controls their access, and sees what each is farming.

## Three layers

```
Platform Admin (you)            /admin — manages all farmers, grants permissions
   └── Farmer / Tenant          today's "owner"; isolated data; an enterprise type
         └── Employees, Customers   scoped to that farmer
```

## Locked decisions (defaults — change here if needed)

| Decision | Choice | Why |
|---|---|---|
| **Data isolation** | Shared DB, row-level `farmer_id` on every table | Cheapest, standard SaaS, one DB to operate. Enforced server-side on every query. |
| **Admin auth** | Email + password (separate from farmer PINs) | A super-admin that can see everything needs a real credential, not a 4-digit PIN. |
| **Permissions** | Per-feature toggles per farmer, with enterprise-type defaults | Matches "decide what each farmer sees" (sidebar items, dashboard cards, modules). |
| **Onboarding** | Admin creates farmers from the dashboard | Full control; simplest for early SaaS. Self-signup can come later. |

## ⚠ Security note
Tenant isolation **must be enforced on every server query**, not just hidden in the UI. If scoping lives only in the frontend, a farmer can read another farmer's data by calling the API directly. PR B below is the part that makes the platform safe for real, paying tenants — it cannot be skipped.

## Data model (target)

- `platform_admins` — `id, email (unique), password_hash, name, created_at`
- `farmers` (tenants) — `id, farm_name, owner_name, email, phone, enterprise_type, status (active|trial|suspended), permissions (jsonb), created_at`
- **Every existing table** gains `farmer_id` → `farmers.id` (PR B).
- `permissions` JSON shape (null ⇒ use enterprise-type defaults):
  ```json
  { "modules": { "eggs": true, "feed": true, "finance": true, "crops": false },
    "cards":   { "revenue": true, "mortality": true, "yield": false },
    "sidebar": { "analytics": true, "customers": true } }
  ```

## Permissions × enterprise type
Defaults derive from `enterprise_type` (a crop farmer shouldn't see egg cards), and the admin can override per farmer. The enterprise-type → default-feature map lives in one place so it stays consistent.

## Phased delivery

### PR A — Platform admin + farmer registry (the visible dashboard)
- `platform_admins` + `farmers` tables (data foundation). **← this commit**
- Admin auth (email + password) + `/admin` login.
- Admin dashboard: list farmers (farm name, enterprise type, status, created), create / suspend / edit a farmer, set permissions.

### PR B — Tenancy enforcement (the security-critical core)
- Add `farmer_id` to every domain table; scope **every** query by the session's farmer.
- Migrate existing single-farm data into one "default" farmer.
- Farmer login resolves to a tenant; sessions carry `farmer_id`.

### PR C — Permission-driven UI
- Frontend reads the farmer's permissions and shows/hides sidebar items, dashboard cards, and modules.
- Backend enforces entitlements (a farmer can't call an API for a module they lack).
- Enterprise-type default map + admin overrides.

### PR D — Polish
- Billing/plan hooks, usage metrics on the admin dashboard, audit log, optional self-signup.

## Status
- [ ] PR A — Platform admin + farmer registry
- [ ] PR B — Tenancy enforcement
- [ ] PR C — Permission-driven UI
- [ ] PR D — Polish
