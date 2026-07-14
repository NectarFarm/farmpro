import 'server-only';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { errorLogs } from '@/db/schemas';
import { getSession } from '@/lib/server/session';

// Server-side error observability for API route handlers.
//
// Client-side crashes already reach the `error_logs` table via
// lib/errorReporter.ts -> POST /api/errors. Route handlers, by contrast, had
// nowhere queryable to land: an uncaught exception produced Next.js's default
// 500 and left only raw Vercel function logs behind. `withErrorLogging` closes
// that gap — it wraps a handler so any UNEXPECTED throw is recorded in the same
// table (same columns/shape as the client path) and turned into a safe generic
// 500 that never leaks the message or stack to the caller.
//
// It only catches genuine throws. Routes that deliberately `return` a 400/401/
// 403/404/etc. flow through untouched — those are normal control flow, not
// exceptions, so the wrapper never sees them.

const STACK_MAX = 4000; // matches the client reporter's cap and errorLogs.stack usage
const MESSAGE_MAX = 2000; // matches errorSchema.message in app/api/errors/route.ts

// Best-effort persistence of a route failure. Deliberately swallows everything:
// a broken logging pipeline (DB down, etc.) must never turn one failed request
// into two, so the very last resort is a console.error and nothing more.
async function logRouteError(routeName: string, req: Request, err: unknown): Promise<void> {
  try {
    let tenantId: string | null = null;
    let userId: string | null = null;
    try {
      const session = await getSession();
      tenantId = session?.tenantId ?? null;
      userId = session?.userId ?? null;
    } catch {
      // Session lookup itself can throw (bad cookie, env) — log without it.
    }

    const message = (err instanceof Error ? err.message : String(err)).slice(0, MESSAGE_MAX);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, STACK_MAX) : null;
    let url: string | null = null;
    try {
      url = new URL(req.url).pathname.slice(0, 500);
    } catch {
      // Non-standard request URL — skip it rather than fail the log.
    }

    await db.insert(errorLogs).values({
      id: crypto.randomUUID(),
      tenantId,
      userId,
      context: routeName.slice(0, 200),
      severity: 'error',
      message,
      digest: null,
      stack,
      url,
      userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    });
  } catch (loggingErr) {
    // Last resort: even the DB insert failed. Surface it to the platform logs so
    // the failure isn't completely invisible, but never rethrow.
    console.error(`[apiErrorHandler] failed to persist error for ${routeName}:`, loggingErr);
  }
}

/**
 * Wrap a Next.js App Router route handler so uncaught exceptions are logged to
 * the `error_logs` table and answered with a safe generic 500.
 *
 * Generic over the handler's trailing args so it fits both plain handlers
 * `(req)` and dynamic-segment handlers `(req, ctx)` without changing their
 * signatures.
 *
 * @param routeName Stable identifier for the route (stored in `context`), e.g. 'POST /api/purchases'.
 * @param handler   The original route handler.
 */
export function withErrorLogging<Args extends unknown[]>(
  routeName: string,
  handler: (req: Request, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      await logRouteError(routeName, req, err);
      return NextResponse.json(
        { error: 'Internal server error', errorCode: 'SERVER_ERROR' },
        { status: 500 },
      );
    }
  };
}
