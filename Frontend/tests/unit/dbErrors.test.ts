import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { pgErrorCode } from '@/lib/server/dbErrors';

describe('pgErrorCode', () => {
  it('reads the SQLSTATE off a real DrizzleQueryError-wrapped postgres error', () => {
    const cause = Object.assign(new Error('duplicate key value'), { code: '23505' });
    const e = new DrizzleQueryError('insert into "x" ...', [], cause as Error);
    expect(pgErrorCode(e)).toBe('23505');
    // and the flat shape (e.code) is NOT what carries it — regression guard
    // against re-introducing the bug this helper exists to fix.
    expect((e as unknown as { code?: string }).code).toBeUndefined();
  });

  it('walks a nested cause chain, not just one level', () => {
    const root = Object.assign(new Error('root'), { code: '40001' });
    const middle = new Error('middle', { cause: root });
    const top = new Error('top', { cause: middle });
    expect(pgErrorCode(top)).toBe('40001');
  });

  it('reads a flat code directly, for backward compatibility with hand-built errors', () => {
    const e = Object.assign(new Error('flat'), { code: '42P01' });
    expect(pgErrorCode(e)).toBe('42P01');
  });

  it('returns undefined when no code is found anywhere in the chain', () => {
    expect(pgErrorCode(new Error('plain'))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode('a string')).toBeUndefined();
  });

  it('does not infinite-loop on a circular cause chain', () => {
    const a: { message: string; cause?: unknown } = { message: 'a' };
    const b: { message: string; cause?: unknown } = { message: 'b', cause: a };
    a.cause = b;
    expect(pgErrorCode(a)).toBeUndefined();
  });
});
