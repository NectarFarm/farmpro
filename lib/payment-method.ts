// ── Payment method, as a real choice (forms-audit slice) ────────────────────
// `sales.method` / `purchases.paymentMethod` were both free text — "Mpesa" /
// "M-Pesa" / "mpesa" / "MPESA" all became different values in every report
// that groups by payment method, and none of them carried a reference a
// bookkeeper could reconcile against a till or M-Pesa statement.
//
// The column stays free text on both tables (an old row's whatever-it-says
// value still displays and still saves) — this is a client-side + shared
// constraint, not a DB enum: the fixed list below is what the Record Sale/
// Purchase sheets now offer, nothing more, no schema redesign.
//
// No 'server-only'/'use client' — pure data, safe to import from a route
// handler or a client component.

export const PAYMENT_METHODS = ['M-Pesa', 'Cash', 'Bank transfer', 'Credit', 'Cheque'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

// The reference field's label, per method — plain language for what a
// bookkeeper would actually call the number they're typing in.
const REFERENCE_LABELS: Partial<Record<PaymentMethod, string>> = {
  'M-Pesa': 'M-Pesa code',
  'Bank transfer': 'Bank reference',
  Cheque: 'Cheque no.',
}

/** Whether this method has a reference field at all — Cash and Credit don't
 * (there is nothing to reconcile a cash handover or an unpaid balance
 * against). */
export function referenceLabel(method: string): string | null {
  return REFERENCE_LABELS[method as PaymentMethod] ?? null
}

/** Credit means unpaid: choosing it is what drives "amount due" + "due date"
 * in both the sale and purchase sheets. */
export function isCreditMethod(method: string): boolean {
  return method === 'Credit'
}
