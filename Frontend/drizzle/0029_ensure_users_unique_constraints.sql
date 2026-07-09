-- Corrective, idempotent re-application of 0023_users_unique_phone_email.sql.
-- On at least one environment, 0023's hash was recorded as applied in
-- __drizzle_migrations without its ALTER TABLE statements actually taking
-- effect (confirmed directly: users.phone/users.email had no constraint even
-- though the migration tracker showed it done). Since drizzle only ever runs
-- a given migration hash once, that environment would never retry it and every
-- `insert ... on conflict ("phone")` write kept failing with Postgres error
-- 42P10 (no unique/exclusion constraint matching the ON CONFLICT target).
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this uses a guarded DO
-- block: a no-op wherever 0023 already succeeded, self-healing wherever it
-- didn't. 0023 itself is left untouched — editing an already-shipped
-- migration's SQL changes its hash and would make drizzle re-run it (and fail)
-- on every environment where it already applied cleanly.
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
