import { NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

export async function POST() {
  try {
    await deleteSession()
    return NextResponse.json({ success: true })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
