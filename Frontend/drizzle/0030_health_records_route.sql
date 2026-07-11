-- Worker-logged health records (vaccine/medication/supplement doses) already
-- collect a delivery route (Drinking water / Injection / Oral / Spray / Feed
-- mix) in the form, but had no column to persist it — the value was silently
-- discarded on every write. See lib/server/syncHandlers.ts handleHealth.
ALTER TABLE "health_records" ADD COLUMN "route" text;
