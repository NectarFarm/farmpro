// ── Shared admin-console types + format helpers (package H1) ────────────────
// Mirrors docs/backoffice-api.md's response shapes exactly — field names and
// nullability match what each route actually returns, nothing invented.

export type TicketCategory = 'question' | 'bug' | 'billing' | 'complaint' | 'feature_request' | 'account';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_on_customer' | 'resolved' | 'closed';
export type TicketSource = 'chatbot' | 'form' | 'admin';

export const TICKET_CATEGORIES: readonly TicketCategory[] = ['question', 'bug', 'billing', 'complaint', 'feature_request', 'account'];
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high', 'urgent'];
export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed'];

export interface AdminTicket {
  id: string;
  seq: number;
  number: string;
  tenantId: string;
  tenantName: string;
  raisedBy: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo: string | null;
  source: TicketSource;
  rating: number | null;
  ratingComment: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorKind: 'customer' | 'staff' | 'bot' | 'system';
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  ticketId: string;
  kind: 'created' | 'status_changed' | 'assigned' | 'priority_changed' | 'replied' | 'rated';
  fromValue: string | null;
  toValue: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface AdminTicketDetail {
  ticket: AdminTicket;
  messages: TicketMessage[];
  events: TicketEvent[];
  tenant: { id: string; name: string } | null;
  raiser: { id: string; name: string; email: string } | null;
}

export interface ApiTenant {
  id: string;
  name: string;
  active: boolean;
  createdAt: string | null;
  farms: number;
  users: number;
}

export interface TenantSafeUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string | null;
}

export interface TenantSubscriptionSummary {
  id: string;
  planId: string;
  planName: string;
  planCode: string;
  planCurrency: string;
  period: PlanPeriod;
  status: string;
  needsPlan: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  amountDueCents: number;
  cancelAtPeriodEnd: boolean;
}

export interface TenantPayment {
  id: string;
  subscriptionId: string;
  tenantId: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string;
  payerNote: string;
  status: 'pending' | 'confirmed' | 'rejected';
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  createdAt: string;
}

export interface TenantAdminNote {
  id: string;
  tenantId: string;
  authorId: string;
  authorName: string;
  note: string;
  createdAt: string;
}

export interface TenantOverview {
  tenant: { id: string; name: string; active: boolean; createdAt: string | null };
  users: TenantSafeUser[];
  subscription: TenantSubscriptionSummary | null;
  usage: { farms: number; users: number; units: number };
  limits: PlanLimits | null;
  payments: TenantPayment[];
  openTicketCount: number;
  notes: TenantAdminNote[];
  lastActivityAt: string | null;
}

export type PlanPeriod = 'monthly' | 'quarterly' | 'annual';
export type PlanLimits = { maxFarms: number | null; maxUsers: number | null; maxUnits: number | null };
export type PlanPrices = Partial<Record<PlanPeriod, number>>;

export interface AdminPlan {
  id: string;
  code: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  limits: PlanLimits;
  prices: PlanPrices;
  currency: string;
  trialDays: number;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type DiscountKind = 'percent' | 'fixed';

export interface AdminDiscount {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  appliesToPlans: string[] | null;
  appliesToPeriods: PlanPeriod[] | null;
  tenantId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  isActive: boolean;
  createdBy: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type SubscriptionStatus = 'trialing' | 'pending_payment' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface AdminSubscriptionRow {
  tenantId: string;
  tenantName: string;
  tenantActive: boolean;
  subscriptionId: string;
  planId: string;
  planCode: string;
  planName: string;
  planCurrency: string;
  period: PlanPeriod;
  status: SubscriptionStatus;
  needsPlan: boolean;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  listPriceCents: number;
  discountAmountCents: number;
  amountDueCents: number;
  cancelAtPeriodEnd: boolean;
}

export interface AdminPaymentRow {
  id: string;
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  amountCents: number;
  currency: string;
  method: string;
  reference: string;
  payerNote: string;
  status: 'pending' | 'confirmed' | 'rejected';
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  createdAt: string;
}

export interface ApiStats {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  onboardRequestsByStatus: Record<'pending' | 'approved' | 'rejected' | 'info-needed', number>;
}

export function centsToDisplay(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const diffMs = Date.now() - d;
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (mins > 0) {
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.round(days / 30);
    return `${months}mo ago`;
  }
  const inMins = -mins;
  if (inMins < 60) return `in ${inMins}m`;
  const inHours = Math.round(inMins / 60);
  if (inHours < 24) return `in ${inHours}h`;
  const inDays = Math.round(inHours / 24);
  return `in ${inDays}d`;
}

// Days remaining until an ISO timestamp, or null if it's already past /
// absent. Used for "trials ending within 7 days" on the Overview inbox.
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  const diff = d - Date.now();
  if (diff < 0) return null;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}
