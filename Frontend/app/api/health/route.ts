import { NextResponse } from 'next/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Previously a static 200 with no DB check — it would report "healthy" even if
// Neon were unreachable. An uptime monitor hitting this endpoint needs it to
// actually reflect whether the app can serve real requests. A 3s cap keeps this
// fast for monitors even under a slow cold-start, rather than hanging.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('db health check timed out')), ms)),
  ])
}

export async function GET() {
  try {
    await withTimeout(db.execute(sql`select 1`), 3000)
    return NextResponse.json(
      { success: true, message: 'ok', db: 'up' },
      { status: 200, headers: corsHeaders }
    )
  } catch {
    return NextResponse.json(
      { success: false, message: 'database unreachable', db: 'down' },
      { status: 503, headers: corsHeaders }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  })
}
