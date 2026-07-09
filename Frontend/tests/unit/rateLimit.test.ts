import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  clientIp,
  checkLoginRateLimit,
  checkWriteRateLimit,
  checkReadRateLimit,
  writeRateLimited,
  readRateLimited,
} from '@/lib/server/rateLimit';

// Each test uses a unique key so module-level bucket state never leaks between tests.
let keyCounter = 0;
const uniqueKey = () => `test-${++keyCounter}-${Date.now()}`;

describe('checkRateLimit — token bucket', () => {
  it('allows the first `max` requests', () => {
    const key = uniqueKey();
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(key, 5, 60_000);
      expect(r.allowed).toBe(true);
    }
  });

  it('blocks when tokens are exhausted', () => {
    const key = uniqueKey();
    for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 60_000);
    const r = checkRateLimit(key, 5, 60_000);
    expect(r.allowed).toBe(false);
    expect(typeof (r as { allowed: false; retryAfter: number }).retryAfter).toBe('number');
    expect((r as { allowed: false; retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(1);
  });

  it('different keys do not share a bucket', () => {
    const a = uniqueKey();
    const b = uniqueKey();
    for (let i = 0; i < 5; i++) checkRateLimit(a, 5, 60_000);
    // a is exhausted, b should still be allowed
    expect(checkRateLimit(b, 5, 60_000).allowed).toBe(true);
  });

  it('allows requests with max = 1 exactly once', () => {
    const key = uniqueKey();
    expect(checkRateLimit(key, 1).allowed).toBe(true);
    expect(checkRateLimit(key, 1).allowed).toBe(false);
  });

  it('returns retryAfter as a positive integer seconds', () => {
    const key = uniqueKey();
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    const r = checkRateLimit(key, 3, 60_000);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfter).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(r.retryAfter)).toBe(true);
    }
  });

  it('defaults windowMs to 60 seconds', () => {
    const key = uniqueKey();
    expect(checkRateLimit(key, 3).allowed).toBe(true);
  });
});

describe('clientIp — request IP extraction', () => {
  it('returns the first IP from X-Forwarded-For', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' },
    });
    expect(clientIp(req)).toBe('203.0.113.42');
  });

  it('falls back to X-Real-IP when no X-Forwarded-For', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '198.51.100.99' },
    });
    expect(clientIp(req)).toBe('198.51.100.99');
  });

  it('falls back to a hash of user-agent when no IP headers', () => {
    const req = new Request('http://localhost', {
      headers: { 'user-agent': 'TestAgent/1.0' },
    });
    const ip = clientIp(req);
    expect(ip).toMatch(/^ip:[0-9a-f]+$/);
  });

  it('produces a stable hash for the same headers', () => {
    const req = () =>
      new Request('http://localhost', {
        headers: { 'user-agent': 'SameAgent', 'accept': 'application/json' },
      });
    expect(clientIp(req())).toBe(clientIp(req()));
  });

  it('produces a different hash for different user-agents', () => {
    const a = clientIp(new Request('http://localhost', { headers: { 'user-agent': 'AgentA' } }));
    const b = clientIp(new Request('http://localhost', { headers: { 'user-agent': 'AgentB' } }));
    expect(a).not.toBe(b);
  });

  it('handles missing headers gracefully (undefined user-agent)', () => {
    const req = new Request('http://localhost');
    const ip = clientIp(req);
    expect(ip).toMatch(/^ip:[0-9a-f]+$/);
  });
});

describe('checkLoginRateLimit', () => {
  it('returns allowed on the first call', () => {
    const req = new Request('http://localhost');
    expect(checkLoginRateLimit(req).allowed).toBe(true);
  });
});

describe('checkWriteRateLimit', () => {
  it('returns allowed on the first call', () => {
    const req = new Request('http://localhost');
    expect(checkWriteRateLimit(req).allowed).toBe(true);
  });
});

describe('checkReadRateLimit', () => {
  it('returns allowed on the first call', () => {
    const req = new Request('http://localhost');
    expect(checkReadRateLimit(req).allowed).toBe(true);
  });
});

describe('writeRateLimited / readRateLimited — guard helpers', () => {
  // The write/read caps are configurable via RATE_LIMIT_WRITE_MAX/READ_MAX (e.g.
  // loosened for the CI/integration test gate — see docker-compose.yml), so read
  // the actual configured value here instead of hardcoding the 30/100 defaults.
  const writeMax = Number(process.env.RATE_LIMIT_WRITE_MAX) || 30;
  const readMax = Number(process.env.RATE_LIMIT_READ_MAX) || 100;

  it('writeRateLimited returns null when under the limit', () => {
    const req = new Request('http://localhost');
    expect(writeRateLimited(req)).toBeNull();
  });

  it('readRateLimited returns null when under the limit', () => {
    const req = new Request('http://localhost');
    expect(readRateLimited(req)).toBeNull();
  });

  it('writeRateLimited returns a 429 Response when exhausted', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '10.0.0.99' },
    });
    for (let i = 0; i < writeMax; i++) checkWriteRateLimit(req);
    const r = writeRateLimited(req);
    expect(r).not.toBeNull();
    expect(r!.status).toBe(429);
  });

  it('readRateLimited returns a 429 Response when exhausted', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '10.0.0.98' },
    });
    for (let i = 0; i < readMax; i++) checkReadRateLimit(req);
    const r = readRateLimited(req);
    expect(r).not.toBeNull();
    expect(r!.status).toBe(429);
  });

  it('writeRateLimited preserves the Retry-After header', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '10.0.0.97' },
    });
    for (let i = 0; i < writeMax; i++) checkWriteRateLimit(req);
    const r = writeRateLimited(req);
    expect(r!.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('checkRateLimit — edge cases', () => {
  it('handles max=0 (even the first request is blocked)', () => {
    const key = uniqueKey();
    // With max=0 the bucket starts with 0 tokens and refill adds 0, so every request is denied.
    expect(checkRateLimit(key, 0).allowed).toBe(false);
  });

  it('uses a custom windowMs for refill rate', () => {
    const key = uniqueKey();
    // 2 requests allowed in a 1-hour window
    expect(checkRateLimit(key, 2, 3_600_000).allowed).toBe(true);
    expect(checkRateLimit(key, 2, 3_600_000).allowed).toBe(true);
    expect(checkRateLimit(key, 2, 3_600_000).allowed).toBe(false);
  });

  it('is deterministic for the same key and params', () => {
    const key = uniqueKey();
    expect(checkRateLimit(key, 10).allowed).toBe(true);
    expect(checkRateLimit(key, 10).allowed).toBe(true);
    // After 2 calls, 8 tokens remain
    const remaining = 8;
    for (let i = 0; i < remaining; i++) checkRateLimit(key, 10);
    expect(checkRateLimit(key, 10).allowed).toBe(false);
  });
});
