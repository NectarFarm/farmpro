-- Adding `catalogue.manage` to CAPABILITIES made "full capability admin" mean
-- "holds all ten". A platform_staff row that held every one of the nine
-- previous capabilities was a full admin when it was saved and must stay one,
-- otherwise countFullCapabilityAdmins() can read 0 and the "last admin with
-- every capability" guard in /api/admin/staff/[id] stops protecting anything.
-- Only rows that held all nine are touched; a partly-capable row stays as it
-- was (still fail closed for the new capability). Idempotent.
UPDATE "platform_staff"
SET "capabilities" = array_append("capabilities", 'catalogue.manage')
WHERE NOT ('catalogue.manage' = ANY("capabilities"))
  AND "capabilities" @> ARRAY[
    'tenants.manage', 'users.manage', 'billing.manage', 'support.handle', 'support.assign',
    'staff.manage', 'onboarding.review', 'impersonate', 'analytics.view'
  ]::text[];
