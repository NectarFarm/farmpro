import { z } from 'zod'

// IMPORTANT (ARCHITECTURE §6.3): secrets are SERVER-ONLY.
// The previous version required DATABASE_URL at module load, which throws in the
// browser bundle (DATABASE_URL is never exposed client-side). Split public vs server.

// Public — safe to ship to the browser. MUST be prefixed NEXT_PUBLIC_.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z
    .string()
    .url()
    .optional()
    .default('http://localhost:13000'),
})

export const env = publicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
})

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
