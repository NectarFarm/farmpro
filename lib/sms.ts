/**
 * Africa's Talking SMS integration
 * Works client-side via their REST API (username + API key stored in .env)
 * NEXT_PUBLIC_AT_USERNAME and NEXT_PUBLIC_AT_API_KEY must be set.
 * For production, proxy through a Next.js API route to hide keys.
 */

export interface SmsResult {
  success: boolean;
  message: string;
}

function normalizeKenyanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  if (digits.length === 9) return `+254${digits}`;
  return `+${digits}`;
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const username = process.env.NEXT_PUBLIC_AT_USERNAME;
  const apiKey   = process.env.NEXT_PUBLIC_AT_API_KEY;
  const phone    = normalizeKenyanPhone(to);

  if (!username || !apiKey) {
    console.warn("[SMS] AT credentials not set — logging instead:", { to: phone, message });
    return { success: true, message: `[Demo] SMS queued to ${phone}: "${message}"` };
  }

  try {
    const body = new URLSearchParams({
      username,
      to: phone,
      message,
      // sender-id left blank → sandbox default
    });

    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "apiKey": apiKey,
      },
      body: body.toString(),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const status = json?.SMSMessageData?.Recipients?.[0]?.status ?? "Unknown";
    if (status === "Success") return { success: true, message: `SMS sent to ${phone}` };
    return { success: false, message: `AT status: ${status}` };
  } catch (err) {
    return { success: false, message: `SMS failed: ${(err as Error).message}` };
  }
}

// ── Pre-built message templates ────────────────────────────────────────────────
export function smsOrderConfirmed(customerName: string, product: string, qty: number, total: string, farm: string): string {
  return `Hi ${customerName}, your order of ${qty} ${product} (${total}) from ${farm} is CONFIRMED. We will notify you when it is out for delivery.`;
}

export function smsOrderDelivered(customerName: string, total: string, farm: string): string {
  return `Hi ${customerName}, your order from ${farm} is OUT FOR DELIVERY. Amount due: ${total}. Please have payment ready.`;
}

export function smsOrderPaid(customerName: string, total: string, farm: string): string {
  return `Hi ${customerName}, payment of ${total} received. Thank you for your business with ${farm}!`;
}
