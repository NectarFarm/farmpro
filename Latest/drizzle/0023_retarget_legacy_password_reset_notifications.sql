-- Retarget password-reset notifications created BEFORE recipient scoping.
--
-- 0022 added notifications.user_id / notifications.role and made
-- "both NULL" mean a genuine tenant-wide broadcast, so existing rows would
-- keep behaving as before. For most notification types that is the right
-- call. For password_reset it is not: those rows carry the requester's name
-- and email, and leaving them as broadcasts means every user in the tenant --
-- workers included -- keeps seeing them. Verified after 0022: an owner and a
-- manager could both still read a password-reset notification meant for an
-- administrator.
--
-- The new producer files these under the platform sentinel tenant targeted at
-- super_admin (app/api/auth/forgot-password/route.ts). This aligns the
-- historical rows with that, so the visibility predicate stops treating them
-- as broadcasts.
--
-- Scoped to source_type = 'password_reset' only. Other legacy rows (task,
-- alert, approval) carry no personal data and stay broadcasts deliberately.
UPDATE "notifications"
SET "role" = 'super_admin',
    "user_id" = NULL,
    "tenant_id" = 'platform'
WHERE "source_type" = 'password_reset'
  AND "role" IS NULL
  AND "user_id" IS NULL;
