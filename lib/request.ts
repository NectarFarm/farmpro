import type { ApiResponse } from './api-response'

export type { ApiFailure, ApiResponse, ApiSuccess } from './api-response'

type ApiEnvelope = {
  success: boolean
  data?: unknown
  error?: unknown
  fields?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return (
    isRecord(value) &&
    typeof value.success === 'boolean' &&
    ('data' in value || 'error' in value)
  )
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback

  if (typeof payload.error === 'string' && payload.error) {
    return payload.error
  }
  if (
    isRecord(payload.error) &&
    typeof payload.error.message === 'string' &&
    payload.error.message
  ) {
    return payload.error.message
  }
  if (typeof payload.message === 'string' && payload.message) {
    return payload.message
  }
  return fallback
}

// Server-side validation routes return a `fields` map alongside `error` so a
// form can mark every offending input at once. Without this the map was
// silently dropped here — parseApiResponse rebuilt a fresh { success, error }
// object — and field-level errors could never reach the UI.
function errorFields(payload: unknown): Record<string, string> | undefined {
  if (!isRecord(payload) || !isRecord(payload.fields)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(payload.fields)) {
    if (typeof value === 'string' && value) out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

function failure(payload: unknown, fallback: string): ApiResponse<never> {
  const fields = errorFields(payload)
  return {
    success: false,
    error: errorMessage(payload, fallback),
    ...(fields ? { fields } : {}),
  }
}

export async function parseApiResponse<T>(
  response: Response
): Promise<ApiResponse<T>> {
  const fallback = response.ok
    ? 'Request failed'
    : response.statusText || `Request failed with status ${response.status}`

  if (response.status === 204) {
    return { success: true, data: undefined as T }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      success: false,
      error: response.ok ? 'Invalid JSON response' : fallback,
    }
  }

  // New API routes return the standard envelope. Preserve its semantics instead
  // of wrapping it again as { success: true, data: envelope }.
  if (isApiEnvelope(payload)) {
    if (!response.ok || !payload.success) {
      return failure(payload, fallback)
    }
    return {
      success: true,
      data: payload.data as T,
    }
  }

  if (!response.ok) {
    return failure(payload, fallback)
  }

  // Compatibility for existing routes that still return a bare success value.
  return {
    success: true,
    data: payload as T,
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  // Incident guard (2026-07): this module is imported by Client Components.
  // Do not import database or server-only env modules here. A previous `./env`
  // import eagerly validated DATABASE_URL in the browser and crashed rendering.
  const baseUrl = typeof window === 'undefined'
    ? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:13000'
    : window.location.origin

  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`

  try {
    const headers = new Headers(options.headers)
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(fullUrl, {
      ...options,
      headers,
    })

    return await parseApiResponse<T>(response)
  } catch (error) {
    console.error(`Fetch error for ${fullUrl}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export const apiClient = {
  get: <T>(url: string, options?: RequestInit) =>
    request<T>(url, { ...options, method: 'GET' }),
  post: <T>(url: string, body: unknown, options?: RequestInit) =>
    request<T>(url, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown, options?: RequestInit) =>
    request<T>(url, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  // Added for issue #228: PATCH /api/notifications/[id] (mark read) is the
  // first client caller of a partial-update route.
  patch: <T>(url: string, body?: unknown, options?: RequestInit) =>
    request<T>(url, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(url: string, options?: RequestInit) =>
    request<T>(url, { ...options, method: 'DELETE' }),
}
