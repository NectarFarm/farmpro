-- Several photos per record, and a rejection worth acting on.
--
-- `records.photo_urls` — a record could only ever carry one photo
-- (`photo_url`). A mortality report above the farm's photo threshold often
-- needs more than one angle for a disease investigation, so this adds a
-- jsonb array of data-URL strings. `photo_url` is untouched and POST
-- /api/records keeps writing the FIRST photo there, so every existing
-- reader (approval detail, the mortality report, anything server-side that
-- has never heard of `photo_urls`) keeps working with zero changes. Existing
-- rows backfill their one photo into the new array so a reader that switches
-- to `photo_urls` doesn't see history go blank.
--
-- `approval_requests.decision_note` — POST /api/approvals/[id]/reject used
-- to take no body at all: a worker who got rejected learned nothing and
-- could do nothing about it. The route now requires a reason; this is where
-- it lives permanently (it is also copied onto the record's own
-- `data.decisionNote`, next to `data.approvalDecision`, since that's what
-- the worker's and approver's screens actually read — see lib/governance.ts).
-- Nullable: an approved request never sets it.
ALTER TABLE "approval_requests" ADD COLUMN "decision_note" text;
--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "records" SET "photo_urls" = jsonb_build_array("photo_url") WHERE "photo_url" IS NOT NULL AND "photo_url" <> '';
