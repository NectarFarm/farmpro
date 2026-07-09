import 'server-only';
import { NextResponse } from 'next/server';

export const ok = <T>(data: T) => NextResponse.json(data);
export const created = <T>(data: T) => NextResponse.json(data, { status: 201 });
export const unauthorized = (msg = 'Please sign in to continue.') => NextResponse.json({ error: msg }, { status: 401 });
export const forbidden = (msg = 'You do not have access to this.') => NextResponse.json({ error: msg }, { status: 403 });
export const notFound = (msg = 'Not found.') => NextResponse.json({ error: msg }, { status: 404 });
export const badRequest = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });
export const serverError = (msg = 'Something went wrong. Please try again.') =>
  NextResponse.json({ error: msg }, { status: 500 });
// Rate-limited — distinct from 500 so the client can back off and retry.
export const tooMany = (msg = 'Too many requests. Please wait and try again.', retryAfter = 60) =>
  NextResponse.json({ error: msg, retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
// Infra/DB unreachable — distinct from a 500 so the client can say "try again".
export const serviceUnavailable = (msg = 'Service is temporarily unavailable. Please try again in a moment.') =>
  NextResponse.json({ error: msg }, { status: 503 });
