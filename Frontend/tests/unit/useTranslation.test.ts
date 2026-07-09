import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLanguage, getLanguage, EN, SW } from '@/lib/i18n/translations';

describe('t() translation function', () => {
  beforeEach(() => {
    // Reset to English before each test
    setLanguage('en');
  });

  it('returns the English value when language is set to en', () => {
    setLanguage('en');
    expect(t('dashboard')).toBe('Dashboard');
    expect(t('save')).toBe('Save');
    expect(t('farm')).toBe('Farm');
  });

  it('returns the Swahili value when language is set to sw', () => {
    setLanguage('sw');
    expect(t('dashboard')).toBe('Dashibodi');
    expect(t('save')).toBe('Hifadhi');
    expect(t('farm')).toBe('Shamba');
  });

  it('returns English for every key after setLanguage("en")', () => {
    setLanguage('en');
    // Spot-check a spread of keys across sections
    const samples = ['dashboard', 'settings', 'save', 'cancel', 'today', 'active',
      'fcr', 'layers', 'eggs', 'morningRound', 'feeding',
      'farmDashboard', 'addBatch', 'platformConsole', 'manageFarms',
      'errorRequired', 'name', 'total', 'page'] as (keyof typeof EN)[];
    for (const key of samples) {
      expect(t(key)).toBe(EN[key]);
    }
  });

  it('returns Swahili for every key after setLanguage("sw")', () => {
    setLanguage('sw');
    const keys = Object.keys(SW) as (keyof typeof EN)[];
    const samples = ['dashboard', 'settings', 'save', 'cancel', 'today', 'active',
      'fcr', 'layers', 'eggs', 'morningRound', 'feeding',
      'farmDashboard', 'addBatch', 'platformConsole', 'manageFarms',
      'errorRequired', 'name', 'total', 'page'] as (keyof typeof EN)[];
    for (const key of samples) {
      expect(t(key)).toBe(SW[key]);
    }
  });

  it('returns a different value for en vs sw for the same key', () => {
    setLanguage('en');
    const enVal = t('dashboard');
    setLanguage('sw');
    const swVal = t('dashboard');
    expect(enVal).not.toBe(swVal);
    expect(enVal).toBe('Dashboard');
    expect(swVal).toBe('Dashibodi');
  });

  it('switching language multiple times always returns the correct language', () => {
    setLanguage('en');
    expect(t('save')).toBe('Save');

    setLanguage('sw');
    expect(t('save')).toBe('Hifadhi');

    setLanguage('en');
    expect(t('save')).toBe('Save');

    setLanguage('sw');
    expect(t('save')).toBe('Hifadhi');

    setLanguage('en');
    expect(t('save')).toBe('Save');
  });

  it('interpolates params correctly', () => {
    const result = t('errorMinLength', { n: 8 });
    expect(result).toBe('Must be at least 8 characters');
  });

  it('interpolates params in Swahili', () => {
    setLanguage('sw');
    const result = t('errorMinLength', { n: 8 });
    expect(result).toBe('Lazima iwe angalau herufi 8');
  });

  it('falls back to the key itself if the key does not exist in either dictionary', () => {
    // Cast to bypass TypeScript since we're testing runtime fallback behavior
    const result = (t as (key: string) => string)('nonexistent_key_xyz');
    expect(result).toBe('nonexistent_key_xyz');
  });

  it('getLanguage() returns the currently set language', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');

    setLanguage('sw');
    expect(getLanguage()).toBe('sw');

    setLanguage('en');
    expect(getLanguage()).toBe('en');
  });
});
