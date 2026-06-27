import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('combines class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters falsy values', () => {
    expect(cn('foo', false, null, undefined, 0, 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', true && 'active', false && 'hidden')).toBe('base active');
  });

  it('merges tailwind classes correctly (later wins)', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2');
    expect(cn('text-red-500', 'text-blue-600')).toBe('text-blue-600');
    expect(cn('font-bold', 'font-normal')).toBe('font-normal');
  });

  it('merges conflicting tailwind padding classes', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('pt-4', 'pt-2')).toBe('pt-2');
  });

  it('preserves non-conflicting classes', () => {
    const result = cn('flex', 'items-center', 'justify-between');
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('justify-between');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('handles object syntax', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('handles array syntax', () => {
    expect(cn(['foo', 'bar'], ['baz'])).toBe('foo bar baz');
  });

  it('handles mixed arguments', () => {
    expect(cn('base', ['responsive', 'mobile'], { desktop: true, tablet: false })).toBe('base responsive mobile desktop');
  });
});
