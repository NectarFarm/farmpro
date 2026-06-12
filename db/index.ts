import 'server-only'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

declare global {
  var postgresClient: ReturnType<typeof postgres> | undefined
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

if (!globalThis.postgresClient) {
  globalThis.postgresClient = postgres(process.env.DATABASE_URL, {
    prepare: false,
  })
}

export const db = drizzle(globalThis.postgresClient)
