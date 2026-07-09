import 'server-only'
import { cache } from 'react'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

// Shared type for "either the top-level db or a transaction handle" — functions
// that must be callable both standalone and inside db.transaction() take this.
export type DbClient = PgDatabase<PostgresJsQueryResultHKT, Record<string, never>>

// Connection strategy depends on the runtime, because the two have OPPOSITE needs:
//
// • Cloudflare Workers (workerd) forbids reusing an I/O object (the DB socket)
//   created in one request from another. A cross-request cached client makes a
//   fresh isolate await a connection promise from a different request's context,
//   which the runtime flags as "hung" → Error 1101. So there we create one client
//   PER REQUEST, scoped via React's `cache()` (reused within a request, discarded
//   between them), with max:1.
//
// • The Node server (`node server.js`, our Docker image) is a single long-lived
//   process. A per-request client there NEVER gets closed promptly (it lingers
//   until idle_timeout), so a burst of requests opens a new Postgres connection
//   each and exhausts `max_connections` ("sorry, too many clients already"). The
//   correct pattern is ONE bounded pool shared across requests.
const isWorkers =
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

function makeClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }
  return postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: isWorkers ? 1 : 10, // Node: a small shared pool; Workers: one per request
    idle_timeout: 20,
  })
}

// Node: a single pool cached on globalThis (survives module re-eval / HMR, bounded
// by `max`). Workers: per-request via cache() (no illegal cross-request reuse).
const globalForDb = globalThis as typeof globalThis & {
  __ifmsPgClient?: ReturnType<typeof postgres>
}
const getClient = isWorkers
  ? cache(makeClient)
  : () => (globalForDb.__ifmsPgClient ??= makeClient())

function getDb() {
  return drizzle(getClient())
}

// Lazy proxy: the DB connection is only established at runtime (not at build /
// module-eval time) and is resolved per request through `getClient()`.
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop: string | symbol) {
    // Resolve the real per-request drizzle instance and BIND methods to it, so
    // drizzle's internal `this` (session/dialect) is correct when called as db.select().
    const real = getDb() as unknown as Record<string | symbol, unknown>
    const value = real[prop]
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value
  },
})
