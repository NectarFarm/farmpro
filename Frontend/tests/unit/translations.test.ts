import { describe, it, expect } from 'vitest';
import { EN, SW } from '@/lib/i18n/translations';

describe('Swahili translations', () => {
  const enKeys = Object.keys(EN) as (keyof typeof EN)[];
  const swKeys = new Set(Object.keys(SW) as (keyof typeof SW)[]);

  it('has a Swahili translation for every English key', () => {
    const missing = enKeys.filter((key) => !swKeys.has(key));
    expect(missing).toEqual([]);
  });

  it('has no extra Swahili keys that do not exist in English', () => {
    const enSet = new Set(enKeys);
    const extra = Object.keys(SW).filter((key) => !enSet.has(key as keyof typeof EN));
    expect(extra).toEqual([]);
  });

  it('every Swahili value is a non-empty string', () => {
    const empty = enKeys.filter((key) => {
      const val = SW[key];
      return typeof val !== 'string' || val.trim().length === 0;
    });
    expect(empty).toEqual([]);
  });

  it('every English value is a non-empty string', () => {
    const empty = enKeys.filter((key) => {
      const val = EN[key];
      return typeof val !== 'string' || val.trim().length === 0;
    });
    expect(empty).toEqual([]);
  });

  it('has the same number of keys in both languages', () => {
    expect(Object.keys(EN).length).toBe(Object.keys(SW).length);
  });
});
