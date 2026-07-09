import { z } from 'zod'

// IMPORTANT (ARCHITECTURE §6.3): secrets are SERVER-ONLY. DATABASE_URL is never
// exposed client-side, so it must not be read at browser-bundle load time.
// Client code reads NEXT_PUBLIC_* directly from process.env where needed.

// Server-only secrets. Call ONLY from Route Handlers / Server Actions / server-only modules.
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url({
    message: 'DATABASE_URL is required in production. Set it in .env or your deployment environment.',
  }).optional()
    .refine(
      (v) => {
        // In production, DATABASE_URL is required
        if (process.env.NODE_ENV === 'production' && !v) return false;
        return true;
      },
      { message: 'DATABASE_URL is required when NODE_ENV=production' },
    ),
  SESSION_SECRET: z.string().min(16).default('dev-insecure-secret-change-me-please')
    .refine(
      (v) => {
        // In production, the insecure fallback must never be the actual signing
        // secret — anyone who's read this file could forge a valid session cookie.
        if (process.env.NODE_ENV === 'production' && v === 'dev-insecure-secret-change-me-please') return false;
        return true;
      },
      { message: 'SESSION_SECRET must be set to a real secret in production (the insecure default is not allowed).' },
    ),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-3.5-sonnet'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // SECURITY: rate-limit settings (optional, sensible defaults)
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().positive().default(5),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(60_000),
  // Whether to mark session cookies `Secure`. Default OFF so login works over
  // plain HTTP (e.g. http://<lan-ip>:13000). Set COOKIE_SECURE=true ONLY when the
  // app is served over HTTPS (e.g. behind a TLS-terminating reverse proxy).
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must never be called in the browser')
  }
  return serverEnvSchema.parse(process.env)
}
