// ── Structured logger (scalability audit item C) ────────────────────────────
// Previously this wrote a plain "[timestamp] [LEVEL] message" string via
// console.*, with any extra args tacked on as separate console arguments.
// That reads fine in a local terminal but is useless to a log aggregator
// (Vercel's log drain / any JSON-based collector): there is nothing to parse
// a level or a field out of, so "show me every error for tenant X" is not a
// query you can write against it.
//
// This version writes one JSON object per line (level, message, timestamp,
// plus whatever structured `context` the caller passes) instead. It is
// deliberately still just `console.*` — no external logging SaaS, no
// credentials, nothing beyond what stdout can already carry — Vercel (and
// any other host) captures stdout/stderr and a JSON line is what turns that
// captured stream into something greppable/queryable downstream.
//
// Request correlation: `withRequestId` binds a request id to Node's
// AsyncLocalStorage for the lifetime of the callback (and everything it
// awaits, including nested async calls), so every log line emitted anywhere
// in that call tree carries the same `requestId` automatically — no need to
// thread it through every function signature by hand. Nothing in this
// codebase runs a shared request-scoped wrapper (there is no middleware.ts),
// so route handlers that want correlated logs opt in explicitly by wrapping
// their body in `logger.withRequestId(...)` — see
// app/api/cron/cleanup-sessions/route.ts for the pattern.
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'
type LogContext = Record<string, unknown>

const requestContext = new AsyncLocalStorage<{ requestId: string }>()

class Logger {
  private write(level: LogLevel, message: string, context?: LogContext) {
    const requestId = requestContext.getStore()?.requestId
    const line: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(requestId ? { requestId } : {}),
      ...(context ?? {}),
    }
    // JSON.stringify on a context value that isn't plain-serializable (an
    // Error, a bigint) would throw or silently drop it — never let a logging
    // call itself be the thing that crashes a request. Errors are
    // re-serialized field-by-field; anything else that still can't be
    // stringified falls back to String(value) rather than throwing.
    const json = safeStringify(line)
    if (level === 'error') console.error(json)
    else if (level === 'warn') console.warn(json)
    else console.log(json)
  }

  info(message: string, context?: LogContext) {
    this.write('info', message, context)
  }

  warn(message: string, context?: LogContext) {
    this.write('warn', message, context)
  }

  error(message: string, context?: LogContext) {
    this.write('error', message, context)
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      this.write('debug', message, context)
    }
  }

  /** Returns a function that logs `message` (debug level) with elapsed ms
   * when called — unchanged usage from before, still opt-in per call site. */
  time(message: string, context?: LogContext) {
    const start = Date.now()
    return () => {
      const ms = Date.now() - start
      this.debug(`${message} completed`, { ...context, ms })
    }
  }

  /** Runs `fn` with a request id bound to every log line it (or anything it
   * awaits) emits via this logger, so grepping one `requestId` in the log
   * stream reconstructs one request/job's full set of log lines. Generates a
   * fresh id unless the caller supplies one (e.g. an inbound `x-request-id`
   * header worth propagating). */
  withRequestId<T>(fn: (requestId: string) => T, requestId: string = randomUUID()): T {
    return requestContext.run({ requestId }, () => fn(requestId))
  }

  /** The request id bound by the nearest enclosing `withRequestId`, if any —
   * for a log call that wants to attach it to something other than a log
   * line (e.g. an error response body), without re-deriving it. */
  currentRequestId(): string | undefined {
    return requestContext.getStore()?.requestId
  }
}

function safeStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, (_key, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack }
      if (typeof v === 'bigint') return v.toString()
      return v
    })
  } catch {
    return JSON.stringify({ ...value, context: String(value.context) })
  }
}

export const logger = new Logger()
