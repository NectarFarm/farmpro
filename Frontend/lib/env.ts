import { z } from 'zod'

// IMPORTANT (ARCHITECTURE §6.3): secrets are SERVER-ONLY. DATABASE_URL is never
// exposed client-side, so it must not be read at browser-bundle load time.
// Client code reads NEXT_PUBLIC_* directly from process.env where needed.

// Server-only secrets. Call ONLY from Route Handlers / Server Actions / server-only modules.
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(16).default('dev-insecure-secret-change-me-please'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-3.5-sonnet'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
