import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return `Ksh ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function isOverdue(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}

export function daysDiff(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Strip server-managed timestamp fields before passing a request body to Drizzle.
// Drizzle's `timestamp` columns expect Date objects; JSON bodies carry strings.
export function stripMeta<T = any>(body: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { createdAt: _c, updatedAt: _u, lastUpdated: _l, ...rest } = body as Record<string, unknown>
  return rest as unknown as T
}

export function calcMortalityRate(initial: number, deaths: number): number {
  if (initial === 0) return 0;
  return (deaths / initial) * 100;
}

export function linearRegression(data: number[]): number[] {
  const n = data.length;
  if (n < 2) return data;
  const xMean = (n - 1) / 2;
  const yMean = data.reduce((s, v) => s + v, 0) / n;
  const num = data.reduce((s, v, i) => s + (i - xMean) * (v - yMean), 0);
  const den = data.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  const projected: number[] = [];
  for (let i = 0; i < 7; i++) {
    projected.push(Math.max(0, Math.round(intercept + slope * (n + i))));
  }
  return projected;
}

