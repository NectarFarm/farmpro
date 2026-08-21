import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

// One shared postgres pool per process (Node dev / `next start` / Docker).
//
// Why not the previous per-request client? React's `cache()` does not actually
// memoize per request inside ROUTE HANDLERS (it only scopes during React
// rendering), so the old lazy proxy opened a fresh postgres client — a fresh
// socket — on every property access. Route handlers that touch the DB more than
// once (e.g. POST /api/auth/login, which runs several queries per request)
// burned ~1 connection per query and exhausted the server's connection cap under
// sustained bursts (issue #221 review / lockout testing). A shared pool reuses
// connections across requests — the standard Node setup.
//
// Creation is lazy (first `db.*` access), so module import — including during
// `next build`, where DATABASE_URL may be unset — never throws.
//
// Cloudflare workerd (the open-next deploy is a PoC): a shared socket cannot be
// reused across requests there, and the previous per-request strategy was broken
// in practice (one socket per query). If the workerd deploy is ever revived,
// revisit with a pool that is genuinely scoped per request.
let _client: ReturnType<typeof postgres> | null = null

function getClient() {
  if (!_client) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set')
    }
    _client = postgres(process.env.DATABASE_URL, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  }
  return _client
}

function getDb() {
  return drizzle(getClient())
}

// Lazy proxy: the DB connection is only established at runtime (not at build /
// module-eval time). Wrapping the same pool in a fresh drizzle instance per
// property access is cheap and harmless — all queries share the pool.
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop: string | symbol) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
