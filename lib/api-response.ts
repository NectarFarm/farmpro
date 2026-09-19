export type ApiSuccess<T> = {
  success: true
  data: T
  error?: never
}

export type ApiFailure = {
  success: false
  data?: never
  error: string
  // Per-field validation messages, keyed by request-body field name, as
  // returned by routes that validate server-side (issues #251/#252). Optional
  // because most failures — 401s, 500s, network errors — have no field to
  // blame. `error` always carries a human-readable summary, so callers that
  // ignore `fields` keep working unchanged.
  fields?: Record<string, string>
  // Seconds until a 429 lockout lifts. Same number the route already puts on
  // the Retry-After header — the client needs it in the envelope because
  // parseApiResponse used to drop headers, so the login screen could only
  // print the rounded "12 min" string and never tick it down. Optional: only
  // throttle responses send it. Never a remaining-attempt count.
  retryAfterSeconds?: number
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure
