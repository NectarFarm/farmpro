# UI kit — design system foundation (ui/governance-reference-redesign)

This is the shared foundation the reference-design port builds on: theme
tokens (`app/global.css`), a set of plain-React primitives
(`components/ui-kit/`), and the restructured app shell
(`components/farm/navigation.tsx`). Governance (`components/farm/
governance.tsx`) is the first screen built on it. Every other screen-port
package listed in `docs/ui-migration-map.md` builds on the same foundation —
this file is what they should read before touching a screen.

## Design intent

The bar is a human signature, not a templated compromise. Concretely, on
every screen built from this kit:

- **Varied page anatomy.** Not every screen is a page-header + 4 tiles +
  master-detail. `Dossier`/`Inspector` exist for a list+detail split;
  `EmptyState` for a screen with nothing in it yet; `PageHeader`/`Kpi` for a
  dashboard-shaped screen. Reach for the primitive that matches what the
  screen actually is — a settings hub, a live clock (Routines' "Today" tab),
  a document (Reports) — rather than forcing every screen into one shape for
  consistency's sake. Consistency here comes from shared tokens and shared
  primitives, not from a single template.
- **Real typographic hierarchy, used deliberately.** `font-display`
  (Fraunces) is for page titles, a Dossier/Inspector's own title, and a KPI's
  big number — the two or three places per screen where the eye should land
  first. It is not a decoration to sprinkle on every heading; a screen with
  five `font-display` elements has no hierarchy at all. Everything else —
  labels, body copy, buttons, table cells — is `font-sans` (Outfit).
- **Restrained colour.** Forest green (`--color-primary` / `bg-primary`,
  `text-primary`, `bg-primary-soft`) means primary action and current
  selection — nothing else. Amber (`--color-warning` / `bg-warning-soft`,
  `text-warning`) means "needs you" — a pending approval, an overdue task,
  a low-stock warning. Danger red is for destructive actions and errors only.
  Everything else on a page should be `fg`/`muted`/`subtle` ink. A screen
  reaching for a fourth accent colour to "make it pop" is the generated-design
  tell this system exists to avoid.
- **Generous, consistent spacing.** Cards are `rounded-xl` (18px) with
  `shadow-(--shadow-border)`, not a hairline border — see "Shadows, not
  borders" below. Section gaps are `gap-4`/`gap-5`/`mt-5`, not ad-hoc pixel
  values. When in doubt, use the same gap Governance already uses for the
  same kind of gap (page-header-to-tiles, tiles-to-tabs, tabs-to-content).

## Tokens (`app/global.css`)

Two layers, both already in `app/global.css`:

1. **Semantic app tokens** (`--background`, `--surface`, `--card`,
   `--text-primary`, `--text-muted`, `--primary-green`, `--status-ok`,
   `--primary-rgb`, …) — the ~30 tokens every existing `components/farm/*`
   screen already reads via inline `style={{ color: 'var(--text-muted)' }}`.
   These now hold the reference's palette (light-farm and dark-farm; see the
   file's own header comment for exactly what changed and why high-contrast/
   sun-mode were deliberately left alone).
2. **Reference-named Tailwind aliases**, added in the `@theme inline` block —
   `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-fg`,
   `--color-muted`, `--color-subtle`, `--color-primary`, `--color-primary-fg`,
   `--color-primary-soft`, `--color-border`, `--color-ring`, `--color-sidebar`
   (+ `-fg`/`-muted`/`-hover`/`-active`), `--color-warning`(+`-soft`),
   `--color-danger`(+`-soft`), `--color-success`(+`-soft`). Each one is a pure
   alias onto the SAME semantic token from (1) — `--color-bg: var(--background)`,
   `--color-primary: var(--primary-green)`, etc. This is what makes `bg-surface`
   (a ui-kit component) and `style={{ background: 'var(--surface)' }}` (an old
   screen) render identically, in every theme, from one source.

Also new: `--font-display` (Fraunces, serif) alongside `--font-sans` (now
Outfit, was Schibsted Grotesk); a widened radius scale (`--radius-xs` 4px
through `--radius-2xl` 32px, registered in `@theme inline` so Tailwind's
`rounded-*` utilities pick them up); `--shadow-border`/`-border-hover`/
`-raised` (see below); and `--sidebar-bg`/`-fg`/`-muted`/`-hover`/`-active`/
`-accent`/`-danger` — the sidebar is permanently dark regardless of the
active light/dark/high-contrast/sun-mode theme (matching the reference), so
these live once at `:root`, not inside any per-theme block.

**Shadows, not borders.** The reference's cards use `shadow-(--shadow-border)`
— a soft 1px "border-shaped" shadow — instead of `border: 1px solid`. Prefer
this for any new card-shaped surface (`rounded-xl bg-surface p-4
shadow-(--shadow-border)`); reach for a real `border-border` only where the
reference itself uses one (table row dividers, an input's own outline).

**Don't touch light-farm/dark-farm's palette values again without reading the
header comment in `app/global.css` first** — it documents a specific,
deliberate choice (status-ok tracks primary per theme rather than the
reference's own "success is theme-constant" convention) that a later change
could easily undo by accident.

## Primitives (`components/ui-kit/`)

All plain React + Tailwind classes + `cn()` (from `@/lib/utils`, already
installed: `clsx` + `tailwind-merge`). **No Radix, no class-variance-
authority** — neither is installed, and every primitive below has a small
enough variant set that a plain lookup object does the same job. Add a Radix
dependency only if a primitive genuinely cannot be built without it (a real
focus-trap requirement, roving-tabindex menu, etc.) — ask first.

| File | Exports | Notes |
|---|---|---|
| `button.tsx` | `Button` | `variant`: default/secondary/ghost/outline/danger/sidebar. `size`: default/sm/lg/icon/icon-sm. No `asChild` (nothing in this app renders a Button "as" an `<a>` — every destination is a `navigate()` call). |
| `badge.tsx` | `Badge` | `variant`: default/primary/warning/danger/success/outline. Pill status chip. |
| `avatar.tsx` | `Avatar`, `initials` | `size`: sm/md/lg. Deterministic tone-by-name-hash (no per-user colour column needed). |
| `input.tsx` | `Input` | Standard text input, themed. |
| `label.tsx` | `Label` | Small muted form label. |
| `separator.tsx` | `Separator` | `orientation`: horizontal/vertical. |
| `scroll-area.tsx` | `ScrollArea` | Plain `overflow-y-auto` + themed thin scrollbar — no library. |
| `dialog.tsx` | `Dialog`, `DialogTitle`, `DialogDescription` | Controlled (`open`/`onOpenChange`), centred modal. Same `position: fixed` overlay convention `components/farm/governance.tsx`'s hand-rolled sheets already used — no DOM portal needed (the app shell has no transform/overflow ancestor that would break `fixed`). |
| `sheet.tsx` | `Sheet`, `SheetTitle` | Controlled, `side`: left/right/bottom. Bottom is what mobile master-detail and the nav's "More" sheet use. |
| `tooltip.tsx` | `Tooltip` | Hover/focus only, no provider needed — each instance owns its own show/hide state. |
| `dropdown-menu.tsx` | `DropdownMenu`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuCheckboxItem` | Click-outside + Escape to close. Fine for a short single-level list (Notices, farm switcher); not a full menu-bar replacement. |
| `page-header.tsx` | `PageHeader`, `Kpi` | `PageHeader`: eyebrow + `font-display` title + lede + actions — the block every top-level screen leads with. `Kpi`: one stat tile, optionally clickable, `tone`: plain/warn/ok/danger. |
| `segmented.tsx` | `Segmented`, `Chips` | `Segmented`: wide tab bar, each segment can carry a one-line hint (Governance's Approvals/Roles & rules/Audit trail). `Chips`: small pill-row filter (status/role/entity chips). |
| `inspector.tsx` | `Dossier`, `Inspector`, `Kv` | `Dossier`: the in-page "paper" for a master-detail right pane. `Inspector`: the same content as a full sheet, for a screen not yet split into its own list+Dossier layout — mobile: full sheet with a back control; desktop: a centred sheet, not a skinny drawer. `Kv`: one label/value row. |
| `empty-state.tsx` | `EmptyState` | Icon + title + body + optional action, for a genuinely empty list — never invented content. |
| `field.tsx` | `Field`, `controlClass` | `Field`: label + control wrapper. `controlClass`: the raw class string so a `<select>` or composed control can match `Input`'s look without importing `Input` itself. |
| `continue.tsx` | `Continue` | Adapted from the reference (which used TanStack Router `<Link>`): takes `{ label, hint, onClick }[]` instead of `{ to, label, hint }[]`, since this app navigates via `useNav().navigate()`, not `<a href>`. |
| `index.ts` | barrel | `export * from './x'` for every file above. |

## Porting a screen: the rule

**Keep the API layer, swap the presentation.** Concretely, when porting a
reference page onto an existing `components/farm/*.tsx` screen:

1. Find the screen's real data calls (`apiClient.get/post/put/delete(...)`,
   `useNav()`, `useToast()`, `useConfirm()`) and do not change the URL,
   method, payload shape, or any permission/role check.
2. Find the matching reference file (see `docs/ui-migration-map.md` §1 for
   the reference-item → local-`ScreenId` table, and §2 for the per-page
   layout/feature breakdown) and port its JSX structure and Tailwind classes,
   substituting the reference's mock-data reads (`useAppStore`, `src/data/
   seed.ts`) with the screen's own real state.
3. Reach for a `components/ui-kit/*` primitive before writing a new inline
   style — if the reference component doing the same job is `Badge`/`Kpi`/
   `Segmented`/etc., use the ported version, not a hand-rolled equivalent.
4. Where the reference shows something the real API can't back (a field,
   a count, a diff), render it **only when the payload actually has it**, and
   say so in the PR/report — never invent a number or fake an empty diff into
   looking populated. `governance.tsx`'s "What changed" section (only shown
   when `meta.changes` is present) and "People on roles" tile (a real,
   additive `GET /api/employees` read) are the reference examples for this.
5. `components/farm/ui-shared.tsx`, `icons.tsx`, `data.ts`, `data-table.tsx`,
   `status-timeline.tsx` are **frozen** (docs/ui-migration-map.md D12) — they
   have many consumers across screens that haven't ported yet. If a port
   needs a change to one of them, it's a foundation-package request, not an
   in-package edit.
6. Run `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` and `pnpm build`
   before calling a port done — same gates as every other change in this repo.

## What changed for every screen automatically (no per-screen edit needed)

Because the alias layer in `app/global.css` points every reference-named
Tailwind token at the same variable an old inline style already reads:

- The whole app's light theme shifted to the reference's warm palette, and
  its body/display fonts shifted to Outfit/Fraunces, the moment `app/layout.tsx`
  and `app/global.css` changed — no other file needed to change for that.
- Every screen's `.farm-card`, `.btn-primary`, `.chip-*`, etc. (the existing
  CSS-class system in `app/global.css`) picked up the new colours the same
  way, since those classes read the same semantic tokens.
- The sidebar (`components/farm/navigation.tsx`'s `AppSidebar`) is now
  permanently dark in every theme — a pure CSS/token change, no JSX
  restructure was needed for the colour switch itself (the IA restructure —
  new section groupings, the mobile "More" sheet — was a separate, larger
  change; see `docs/ui-migration-map.md` §1 and §5 for exactly what moved).

## Global changes that could visibly affect other screens

Anything reading these tokens/classes shifts in appearance the moment this
foundation lands, even before that screen's own port package runs:

- `--background`, `--surface`, `--card`, `--card-hover`, `--border-subtle`,
  `--text-primary/-secondary/-muted/-dim`, `--primary-green`(+`-strong`),
  `--on-primary`, `--status-ok/-warning/-critical`, and their `--*-rgb`
  triplets — light-farm and dark-farm only (high-contrast/sun-mode
  untouched).
- `--font-sans` (Outfit, was Schibsted Grotesk) and the new `--font-display`
  (Fraunces) — every screen's body text re-renders in the new typeface.
- `--radius-control` moved 10px → 12px (`--radius-card`/`--radius-chip`
  unchanged in value). Any screen using `var(--radius-control)` picks up the
  1px-larger radius automatically.
- `TopNav`'s `showBell` default flipped `false` → `true` (see
  `components/farm/navigation.tsx`): every screen using the shared `TopNav`
  without explicitly passing `showBell` now shows the notifications bell,
  suppressed only for vet/auditor sessions and while already on the
  Notifications screen. This is how "notifications move to the top-right
  bell" (docs/ui-migration-map.md §1) reaches every screen without a
  per-screen edit.
- The desktop sidebar's section groups and the mobile bottom bar's tab set
  changed (owner/manager only — worker/vet/auditor/admin keep their existing
  tab sets, restyled only). See `docs/ui-migration-map.md` §1 for the exact
  before/after mapping.
