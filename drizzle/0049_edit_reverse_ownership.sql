-- Item 23 (edit and reverse), ownership half: who recorded a sale/purchase,
-- so a later edit/reverse can be refused to a different non-owner actor
-- ("whoever may record it decides who may edit or reverse it" — the owner
-- role always bypasses, same as every other module gate). No backfill:
-- nothing before this column tracked who recorded it, so every existing row
-- stays null — not attributable to anyone, and treated as editable by any
-- actor the finance module gate already lets in (see
-- lib/permissions.ts's canModifyOwnRow).
ALTER TABLE "sales" ADD COLUMN "recorded_by" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "recorded_by" text;