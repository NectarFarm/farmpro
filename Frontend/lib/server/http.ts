import 'server-only';
import { NextResponse } from 'next/server';

// Standard error response with a machine-readable errorCode for client-side
// branching. Every error helper returns `{ error, errorCode, ... }`.

export const ok = <T>(data: T) => NextResponse.json(data);
export const created = <T>(data: T) => NextResponse.json(data, { status: 201 });

export const unauthorized = (msg = 'Please sign in to continue.') =>
  NextResponse.json({ error: msg, errorCode: 'AUTH_UNAUTHORIZED' }, { status: 401 });
export const forbidden = (msg = 'You do not have access to this.') =>
  NextResponse.json({ error: msg, errorCode: 'AUTH_FORBIDDEN' }, { status: 403 });
export const notFound = (msg = 'Not found.') =>
  NextResponse.json({ error: msg, errorCode: 'NOT_FOUND' }, { status: 404 });
export const badRequest = (msg: string) =>
  NextResponse.json({ error: msg, errorCode: 'VALIDATION_ERROR' }, { status: 400 });
export const serverError = (msg = 'Something went wrong. Please try again.') =>
  NextResponse.json({ error: msg, errorCode: 'SERVER_ERROR' }, { status: 500 });
// Rate-limited — distinct from 500 so the client can back off and retry.
export const tooMany = (msg = 'Too many requests. Please wait and try again.', retryAfter = 60) =>
  NextResponse.json({ error: msg, errorCode: 'RATE_LIMITED', retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
// Infra/DB unreachable — distinct from a 500 so the client can say "try again".
export const serviceUnavailable = (msg = 'Service is temporarily unavailable. Please try again in a moment.') =>
  NextResponse.json({ error: msg, errorCode: 'SERVICE_UNAVAILABLE' }, { status: 503 });
