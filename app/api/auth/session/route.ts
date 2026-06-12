import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

export async function GET() {
  try {
    const session = await getSession()
    return NextResponse.json(session ?? null)
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
