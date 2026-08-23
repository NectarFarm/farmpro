#!/usr/bin/env node
// ── Apply pending migrations at deploy time ─────────────────────────────────
// Why this exists: nothing ran migrations on deploy. The build was `next
// build` and nothing else, so every schema change since the last time someone
// remembered to run `pnpm db:migrate` by hand sat unapplied in production
// while the code that needed it went live. That is not a hypothetical — task
// creation returned 500 in production because `tasks.assignee_id` existed in
// the code and not in the database, six migrations behind.
//
// Two deliberate behaviours:
//
//   No DATABASE_URL -> skip, don't fail. Preview builds have no database
//   configured, and a preview that cannot build is worse than a preview
//   whose migrations were not needed.
//
//   Migration fails -> the BUILD fails. Deploying code against a schema that
//   cannot hold it is exactly the failure this script was written for, and
//   shipping it anyway just moves the error from the build log to the user.
import { spawnSync } from 'node:child_process'

if (!process.env.DATABASE_URL) {
  console.log('[deploy-migrate] No DATABASE_URL — skipping migrations for this build.')
  process.exit(0)
}

console.log('[deploy-migrate] Applying pending migrations…')
const result = spawnSync('npx', ['drizzle-kit', 'migrate'], { stdio: 'inherit', env: process.env })

if (result.status !== 0) {
  console.error('[deploy-migrate] Migrations failed — refusing to build against a schema that cannot hold this code.')
  process.exit(result.status ?? 1)
}

console.log('[deploy-migrate] Migrations applied.')
