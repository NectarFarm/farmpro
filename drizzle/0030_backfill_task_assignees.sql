-- Backfill tasks.assignee_id from the pre-0029 "Assigned: <name>" convention.
--
-- Before migration 0029 the tasks table had no assignee column at all, so the
-- UI stored the chosen person's NAME as the first line of `notes`. Every task
-- created that way still carries its assignee only as text: once the app
-- starts reading the column, those tasks would silently show as Unassigned
-- even though the record of who was asked is sitting right there.
--
-- Matching is by exact name within the same tenant. That is the only key the
-- old format preserved — it stored a display name, not an id — so a task
-- whose stored name no longer matches any employee (someone renamed, someone
-- who left, a name typed differently) keeps its notes line and stays
-- unassigned. components/farm/tasks.tsx's assigneeNameFor still falls back to
-- reading that line, so nothing is lost on screen either way.
--
-- LIMIT 1 in the subquery is deliberate rather than incidental: two employees
-- can share a name, and picking the first by creation order is at least
-- deterministic and repeatable. A wrong guess here is visible and correctable
-- in the UI; a non-deterministic one would differ between environments.
UPDATE tasks t
SET assignee_id = (
  SELECT e.id
  FROM employees e
  WHERE e.tenant_id = t.tenant_id
    AND e.name = btrim(split_part(substring(t.notes FROM 11), E'\n', 1))
  ORDER BY e.created_at NULLS LAST, e.id
  LIMIT 1
)
WHERE t.assignee_id IS NULL
  AND t.notes LIKE 'Assigned: %';
