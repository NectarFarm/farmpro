import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth'
import { handleApiError } from '@/lib/errors'

/**
 * Server-side Africa's Talking SMS proxy.
 * Credentials (AT_USERNAME, AT_API_KEY) stay on the server and are never
 * shipped to the browser. If unset, the route runs in demo mode (logs only).
 */

function normalizeKenyanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('254')) return `+${digits}`
  if (digits.startsWith('0') && digits.length === 10) return `+254${digits.slice(1)}`
  if (digits.length === 9) return `+254${digits}`
  return `+${digits}`
}

export async function POST(req: NextRequest) {
  try {
    await requireSession()
    const { to, message } = await req.json()
    if (!to || !message) {
      return NextResponse.json({ error: 'to and message are required' }, { status: 400 })
    }

    const username = process.env.AT_USERNAME
    const apiKey = process.env.AT_API_KEY
    const phone = normalizeKenyanPhone(String(to))

    if (!username || !apiKey) {
      console.warn('[SMS] AT credentials not set — logging instead:', { to: phone, message })
      return NextResponse.json({ success: true, message: `[Demo] SMS queued to ${phone}` })
    }

    const body = new URLSearchParams({ username, to: phone, message: String(message) })
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey,
      },
      body: body.toString(),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const status = json?.SMSMessageData?.Recipients?.[0]?.status ?? 'Unknown'
    if (status === 'Success') {
      return NextResponse.json({ success: true, message: `SMS sent to ${phone}` })
    }
    return NextResponse.json({ success: false, message: `AT status: ${status}` })
  } catch (error) {
    const { error: message, status } = handleApiError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
