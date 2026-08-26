#!/usr/bin/env node
// ── Migration/journal drift check ───────────────────────────────────────────
// The silent failure this catches: drizzle-kit applies the migrations listed
// in drizzle/meta/_journal.json, NOT whatever .sql files happen to be in the
// folder. A .sql file with no journal entry is skipped without a word — the
// build goes green, the deploy succeeds, and the column is simply missing in
// production. That is the same class of failure scripts/deploy-migrate.mjs
// was written for, one level further up.
//
// It also guards the numbering collision we kept nearly shipping: two open
// branches both claiming 0035 merge cleanly (different files, both appended
// to the journal) and leave a duplicate idx behind.
//
// CI runs `pnpm build`, which is plain `next build` — it never exercises the
// `vercel-build` path, so nothing else in CI would notice any of this.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'drizzle'
const problems = []

const journal = JSON.parse(readFileSync(join(DIR, 'meta/_journal.json'), 'utf8'))
const entries = journal.entries ?? []
const tags = entries.map((e) => e.tag)
const tagSet = new Set(tags)
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, ''))
const fileSet = new Set(files)

for (const f of files.filter((f) => !tagSet.has(f)).sort()) {
  problems.push(`${f}.sql has no _journal.json entry — drizzle-kit would skip it silently, and the schema change would never reach production.`)
}
for (const t of tags.filter((t) => !fileSet.has(t)).sort()) {
  problems.push(`_journal.json lists "${t}" but drizzle/${t}.sql does not exist — the migration would fail at deploy time.`)
}

const dupTags = tags.filter((t, i) => tags.indexOf(t) !== i)
for (const t of new Set(dupTags)) problems.push(`_journal.json lists "${t}" more than once.`)

const idxs = entries.map((e) => e.idx)
const dupIdx = idxs.filter((n, i) => idxs.indexOf(n) !== i)
for (const n of new Set(dupIdx)) {
  problems.push(`_journal.json has two entries with idx ${n} — usually two branches that each claimed the same migration number. Renumber the later one.`)
}
for (let i = 1; i < idxs.length; i++) {
  if (idxs[i] <= idxs[i - 1]) {
    problems.push(`_journal.json entries are out of order at idx ${idxs[i]} (after ${idxs[i - 1]}) — they must ascend in apply order.`)
    break
  }
}

if (problems.length > 0) {
  console.error('[check-migrations] Migration set is inconsistent:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  process.exit(1)
}

console.log(`[check-migrations] OK — ${entries.length} migrations, journal and .sql files agree.`)
