// ── PaymentProvider seam (SaaS back-office backend) ─────────────────────────
// No real payment gateway exists anywhere in this codebase or this task —
// the flow POST /api/billing/payments backs is "the tenant tells us they
// paid, an admin with billing.manage confirms it against their own bank/
// mobile-money statement, confirming activates the subscription". This
// interface is the seam a REAL gateway (M-Pesa, MTN MoMo, a card processor)
// slots into later without every route that touches a payment needing to
// change — only the provider implementation swapped in
// lib/billing/subscriptions.ts's `getPaymentProvider()` would need to.
//
// Deliberately NOT building a fake gateway: `ManualPaymentProvider` below
// does exactly what today's manual flow needs (record a claim, let a human
// decide) and nothing else — no invented webhook, no invented signature
// verification, no invented "processing" state a real gateway would have
// but this one cannot honestly claim to.
import 'server-only'

export interface SubmitPaymentInput {
  subscriptionId: string
  tenantId: string
  amountCents: number
  currency: string
  method: string
  reference: string
  payerNote: string
  submittedBy: string
}

export interface SubmitPaymentResult {
  // 'pending' for a provider that cannot itself verify a payment (the manual
  // flow: nothing here confirms anything, a human does, later). A real
  // gateway integration could return 'confirmed' here if it verifies
  // synchronously — the caller (POST /api/billing/payments) branches on this
  // rather than assuming every submission is always pending.
  status: 'pending' | 'confirmed'
  providerRef?: string
}

export interface PaymentProvider {
  readonly name: string
  submitPayment(input: SubmitPaymentInput): Promise<SubmitPaymentResult>
}

// The only implementation that exists today. Records nothing itself (the
// caller is the one that inserts the `payments` row) — this just represents
// "how would we ask a gateway to take this payment", and for a flow with no
// gateway, the honest answer is "we can't; a human must review it".
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual'

  // No parameter: this implementation genuinely ignores every field of
  // SubmitPaymentInput (there is nothing to submit anywhere) — a function
  // with fewer parameters than the interface it implements is structurally
  // compatible in TypeScript, so this satisfies PaymentProvider without an
  // unused-parameter warning for a name nothing here needs.
  async submitPayment(): Promise<SubmitPaymentResult> {
    return { status: 'pending' }
  }
}

let _provider: PaymentProvider | null = null

/**
 * The active payment provider. Always `ManualPaymentProvider` today — no env
 * var or config selects a different one because no other implementation
 * exists yet. A future gateway integration replaces this function's body,
 * not its call sites.
 */
export function getPaymentProvider(): PaymentProvider {
  if (!_provider) _provider = new ManualPaymentProvider()
  return _provider
}
