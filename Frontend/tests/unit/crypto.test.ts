import { describe, it, expect } from 'vitest';
import { hashSecret, verifySecret, signToken, verifyToken } from '@/lib/server/crypto';

describe('password/PIN hashing (PBKDF2)', () => {
  it('verifies a correct secret and rejects a wrong one', async () => {
    const hash = await hashSecret('demo1234');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifySecret('demo1234', hash)).toBe(true);
    expect(await verifySecret('wrong', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt) but both verify', async () => {
    const a = await hashSecret('samePin');
    const b = await hashSecret('samePin');
    expect(a).not.toBe(b);
    expect(await verifySecret('samePin', a)).toBe(true);
    expect(await verifySecret('samePin', b)).toBe(true);
  });

  it('rejects a malformed stored hash without throwing', async () => {
    expect(await verifySecret('x', 'not-a-real-hash')).toBe(false);
  });
});

describe('signed session tokens (HMAC)', () => {
  const SECRET = 'unit-test-secret-at-least-16-chars';

  it('round-trips a payload', async () => {
    const token = await signToken({ userId: 'u1', role: 'owner', exp: 999 }, SECRET);
    const out = await verifyToken<{ userId: string; role: string }>(token, SECRET);
    expect(out?.userId).toBe('u1');
    expect(out?.role).toBe('owner');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken({ userId: 'u1' }, SECRET);
    expect(await verifyToken(token, 'a-different-secret-1234567890')).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken({ role: 'worker' }, SECRET);
    const [, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ role: 'owner' })).toString('base64url') + '.' + sig;
    expect(await verifyToken(forged, SECRET)).toBeNull();
  });
});
