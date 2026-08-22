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
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure
