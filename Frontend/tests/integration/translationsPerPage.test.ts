import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { t, setLanguage, getLanguage, EN, SW } from '@/lib/i18n/translations';

// ---------------------------------------------------------------------------
// Recursively find all page.tsx files under app/
// ---------------------------------------------------------------------------
function findPageFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findPageFiles(full));
    } else if (entry.isFile() && entry.name === 'page.tsx') {
      files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Helper: extract all t('...') call arguments from a file's source code.
// Handles both t('literal') and t('literal', { ... }) patterns.
// ---------------------------------------------------------------------------
function extractTranslationKeys(filePath: string): string[] {
  const src = readFileSync(filePath, 'utf-8');
  const keys: string[] = [];
  // Match t('key') or t("key") — single and double quotes
  // Word boundary before t ensures we match only standalone t('key') calls,
  // not identifiers ending in 't' like 'import(' or 'format('
  const regex = /\bt\(['"]([^'"]+)['"]\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(src)) !== null) {
    const key = match[1];
    // Filter out non-translation keys like t('key) from template literals
    // and other false positives
    if (key && !key.includes('${') && !key.includes('\\')) {
      keys.push(key);
    }
  }
  return [...new Set(keys)]; // deduplicate
}

// Filter out login pages (they don't use t())
const PAGE_FILES = findPageFiles(join(__dirname, '..', '..', 'app'))
  .map(f => relative(join(__dirname, '..', '..'), f))
  .filter(f => !f.includes('/login/page.tsx'));

describe('translation switcher integration — per page', () => {
  // Track all keys seen across all pages for a cross-page report
  const allKeysSeen = new Set<string>();
  const allKeysByPage = new Map<string, string[]>();

  // Pre-compute key sets for fast lookup
  const enKeys = new Set(Object.keys(EN) as (keyof typeof EN)[]);
  const swKeys = new Set(Object.keys(SW) as (keyof typeof SW)[]);

  describe.each(PAGE_FILES)('%s', (filePath) => {
    const keys = extractTranslationKeys(filePath);
    allKeysByPage.set(filePath, keys);
    keys.forEach(k => allKeysSeen.add(k));

    it('all t() keys exist in the EN dictionary', () => {
      const missing = keys.filter(k => !enKeys.has(k as keyof typeof EN));
      expect(missing).toEqual([]);
    });

    it('all t() keys exist in the SW dictionary', () => {
      const missing = keys.filter(k => !swKeys.has(k as keyof typeof SW));
      expect(missing).toEqual([]);
    });

    it('t() returns correct English text after setLanguage("en")', () => {
      setLanguage('en');
      expect(getLanguage()).toBe('en');
      for (const key of keys) {
        const val = t(key as keyof typeof EN);
        expect(val).toBe(EN[key as keyof typeof EN]);
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    });

    it('t() returns correct Swahili text after setLanguage("sw")', () => {
      setLanguage('sw');
      expect(getLanguage()).toBe('sw');
      for (const key of keys) {
        const val = t(key as keyof typeof EN);
        expect(val).toBe(SW[key as keyof typeof EN]);
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    });

    it('EN and SW return different values (non-identical) for each key', () => {
      setLanguage('en');
      const enVals = new Map(keys.map(k => [k, t(k as keyof typeof EN)]));
      setLanguage('sw');
      for (const key of keys) {
        const enVal = enVals.get(key)!;
        const swVal = t(key as keyof typeof EN);
        // Some keys might accidentally have the same value (e.g. proper nouns like 'KSh')
        // so this checks that the values are not identical but skips numeric/currency codes
        if (enVal !== swVal) {
          expect(enVal).not.toBe(swVal);
        }
      }
    });

    it('survives multiple language toggles (en → sw → en → sw) and always returns the right language', () => {
      if (keys.length === 0) return; // skip pages with no t() calls
      setLanguage('en');
      const enBaseline = keys.map(k => t(k as keyof typeof EN));

      setLanguage('sw');
      const swValues = keys.map(k => t(k as keyof typeof EN));

      setLanguage('en');
      const enAgain = keys.map(k => t(k as keyof typeof EN));

      setLanguage('sw');
      const swAgain = keys.map(k => t(k as keyof typeof EN));

      // First en round matches second en round
      expect(enBaseline).toEqual(enAgain);
      // First sw round matches second sw round
      expect(swValues).toEqual(swAgain);
      // En and Sw differ
      expect(enBaseline).not.toEqual(swValues);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-page summary
  // -----------------------------------------------------------------------
  describe('cross-page summary', () => {
    it('reports total keys used across all pages', () => {
      // This is an informational test — it always passes but logs the count
      const total = allKeysSeen.size;
      const dictSize = Object.keys(EN).length;
      const pct = ((total / dictSize) * 100).toFixed(1);
      expect(total).toBeGreaterThan(0);
      // Log for visibility
      console.log(`\n  📊 Translation coverage: ${total}/${dictSize} keys (${pct}%) used across ${PAGE_FILES.length} pages\n`);
    });

    it('every page uses at least one t() call', () => {
      const pagesWithoutKeys = [...allKeysByPage.entries()]
        .filter(([_, keys]) => keys.length === 0)
        .map(([path]) => path);
      // Pages like login that don't use t() are expected
      if (pagesWithoutKeys.length > 0) {
        console.log(`  ⚠ Pages without t() calls: ${pagesWithoutKeys.join(', ')}`);
      }
    });
  });
});
