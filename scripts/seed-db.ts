/**
 * Run once after `pnpm db:migrate` to seed default rows.
 * Usage: npx tsx scripts/seed-db.ts
 */
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { createHash } from 'crypto'
import { settings, feedInventory } from '../db/schema'
import { eq } from 'drizzle-orm'

const client = postgres(process.env.DATABASE_URL!)
const db = drizzle(client)

function hashPin(pin: string) {
  return createHash('sha256').update(pin).digest('hex')
}

async function main() {
  // Settings (owner PIN = '1234' by default — change via the Settings page)
  const [existing] = await db.select().from(settings).where(eq(settings.id, 'default')).limit(1)
  if (!existing) {
    await db.insert(settings).values({ id: 'default', ownerPinHash: hashPin('1234') })
    console.log('✅ Settings seeded (owner PIN: 1234)')
  } else {
    console.log('ℹ️  Settings row already exists — skipped')
  }

  // Feed inventory defaults
  const defaults = [
    { id: 'fi-1', feedType: 'starter' as const, currentStockKg: '200', reorderLevelKg: '50' },
    { id: 'fi-2', feedType: 'grower' as const, currentStockKg: '300', reorderLevelKg: '75' },
    { id: 'fi-3', feedType: 'layer' as const, currentStockKg: '400', reorderLevelKg: '100' },
    { id: 'fi-4', feedType: 'finisher' as const, currentStockKg: '150', reorderLevelKg: '50' },
  ]

  for (const row of defaults) {
    const [ex] = await db.select().from(feedInventory).where(eq(feedInventory.feedType, row.feedType)).limit(1)
    if (!ex) {
      await db.insert(feedInventory).values(row)
      console.log(`✅ Feed inventory seeded: ${row.feedType}`)
    }
  }

  console.log('✅ Database seed complete')
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
