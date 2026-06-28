import { describe, it, expect, afterEach } from 'vitest';
import { uuid } from '@/lib/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = globalThis.crypto;

describe('uuid (works in insecure LAN contexts)', () => {
  afterEach(() => { Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true }); });

  it('returns a valid v4 UUID normally', () => {
    expect(uuid()).toMatch(V4);
  });

  it('still works when crypto.randomUUID is UNAVAILABLE (http://<lan-ip>)', () => {
    // Simulate an insecure context: randomUUID gone, but getRandomValues present.
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff; return a; } },
      configurable: true,
    });
    const id = uuid();
    expect(id).toMatch(V4);          // valid v4 from getRandomValues
  });

  it('still works when crypto is entirely missing (Math.random fallback)', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    expect(uuid()).toMatch(V4);
  });

  it('produces unique ids', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuid()));
    expect(set.size).toBe(1000);
  });
});
