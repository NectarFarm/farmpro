/**
 * Client-side SMS helper.
 * Delegates the actual send to the server route /api/sms, which holds the
 * Africa's Talking credentials. No API keys are exposed to the browser.
 */

export interface SmsResult {
  success: boolean;
  message: string;
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  try {
    const res = await fetch('/api/sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, message: json?.error ?? `SMS failed: HTTP ${res.status}` };
    return { success: json.success ?? false, message: json.message ?? '' };
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
