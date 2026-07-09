import { describe, it, expect, vi } from 'vitest';
import { productFieldKey, defaultsForBatch, mainProductForBatch } from '@/lib/server/products';

vi.mock('@/db', () => ({
  db: { insert: vi.fn(), select: vi.fn(), update: vi.fn() },
}));

describe('products', () => {
  describe('productFieldKey', () => {
    it.each([
      ['Eggs', 'collect_eggs'],
      ['Live bird', 'collect_live_bird'],
      ['Pork (live weight)', 'collect_pork_live_weight'],
      ['Maize grain', 'collect_maize_grain'],
      ['Fish', 'collect_fish'],
      ['Manure', 'collect_manure'],
      ['Bag (50kg)', 'collect_bag_50kg'],
      ['Spent hen', 'collect_spent_hen'],
      ['Piglets', 'collect_piglets'],
      ['Live goat', 'collect_live_goat'],
      ['Milk', 'collect_milk'],
      ['Honey', 'collect_honey'],
      ['Rabbit meat', 'collect_rabbit_meat'],
    ])('converts "%s" → "%s"', (name, expected) => {
      expect(productFieldKey(name)).toBe(expected);
    });

    it('strips leading and trailing underscores', () => {
      expect(productFieldKey('!special chars!')).toBe('collect_special_chars');
    });

    it('handles empty string', () => {
      expect(productFieldKey('')).toBe('collect_');
    });
  });

  describe('defaultsForBatch', () => {
    it('returns layer templates for "layers" enterprise', () => {
      const defs = defaultsForBatch('chicken', 'layers');
      expect(defs.length).toBeGreaterThan(0);
      expect(defs.map((d) => d.name)).toContain('Spent hen');
    });

    it('returns broiler templates for "broilers" enterprise', () => {
      const defs = defaultsForBatch('broiler', 'broilers');
      expect(defs.map((d) => d.name)).toContain('Live bird');
    });

    it('returns goat templates for "goats" enterprise', () => {
      const defs = defaultsForBatch('goat', 'goats');
      expect(defs.map((d) => d.name)).toContain('Live goat');
    });

    it('returns dairy templates for "dairy" enterprise', () => {
      const defs = defaultsForBatch('dairy', 'dairy');
      expect(defs.map((d) => d.name)).toContain('Milk');
    });

    it('auto-detects enterprise from species when no enterprise given', () => {
      expect(defaultsForBatch('layer').map((d) => d.name)).toContain('Spent hen');
      expect(defaultsForBatch('broiler').map((d) => d.name)).toContain('Live bird');
      expect(defaultsForBatch('pig').map((d) => d.name)).toContain('Pork (live weight)');
      expect(defaultsForBatch('tilapia').map((d) => d.name)).toContain('Fish');
      expect(defaultsForBatch('maize').map((d) => d.name)).toContain('Maize grain');
      expect(defaultsForBatch('goat').map((d) => d.name)).toContain('Live goat');
      expect(defaultsForBatch('cow').map((d) => d.name)).toContain('Milk');
      expect(defaultsForBatch('rabbit').map((d) => d.name)).toContain('Rabbit meat');
      expect(defaultsForBatch('bee').map((d) => d.name)).toContain('Honey');
    });

    it('returns empty array for unknown species without enterprise', () => {
      expect(defaultsForBatch('camel')).toEqual([]);
      expect(defaultsForBatch('')).toEqual([]);
    });

    it('falls back to species detection for unknown enterprise key', () => {
      const defs = defaultsForBatch('chicken', 'bogus');
      expect(defs.length).toBeGreaterThan(0);
      expect(defs.map((d) => d.name)).toContain('Spent hen');
    });

    it('enterprise takes precedence over species detection', () => {
      const layer = defaultsForBatch('broiler', 'layers');
      expect(layer.map((d) => d.name)).toContain('Spent hen');
      expect(layer.map((d) => d.name)).not.toContain('Live bird');
    });
  });

  describe('mainProductForBatch', () => {
    it('returns the main product for each enterprise', () => {
      expect(mainProductForBatch('chicken', 'layers')?.name).toBe('Spent hen');
      expect(mainProductForBatch('broiler', 'broilers')?.name).toBe('Live bird');
      expect(mainProductForBatch('pig', 'pig_fatten')?.name).toBe('Pork (live weight)');
      expect(mainProductForBatch('pig', 'pig_breed')?.name).toBe('Piglets');
      expect(mainProductForBatch('tilapia', 'tilapia')?.name).toBe('Fish');
      expect(mainProductForBatch('goat', 'goats')?.name).toBe('Live goat');
      expect(mainProductForBatch('cow', 'dairy')?.name).toBe('Mature cow');
      expect(mainProductForBatch('duck', 'ducks')?.name).toBe('Live duck');
      expect(mainProductForBatch('rabbit', 'rabbits')?.name).toBe('Rabbit meat');
      expect(mainProductForBatch('bee', 'bees')?.name).toBe('Colony / nuc');
    });

    it('auto-detects enterprise from species', () => {
      expect(mainProductForBatch('layer')?.name).toBe('Spent hen');
      expect(mainProductForBatch('broiler')?.name).toBe('Live bird');
      expect(mainProductForBatch('tilapia')?.name).toBe('Fish');
      expect(mainProductForBatch('goat')?.name).toBe('Live goat');
      expect(mainProductForBatch('cow')?.name).toBe('Mature cow');
    });

    it('returns null for unknown species', () => {
      expect(mainProductForBatch('camel')).toBeNull();
      expect(mainProductForBatch('')).toBeNull();
    });
  });

  // The isAnimalProduct flag is the switch that decides, on sale, whether stock is
  // drawn from the live headcount (per-head livestock) or from harvested output
  // (sold by weight/quantity). Getting this wrong is what made selling "the animal
  // itself" silently fail, so pin the classification per species.
  describe('animal-itself classification (drives inventory decrement)', () => {
    it.each([
      ['layers', 'Spent hen', true],
      ['broilers', 'Live bird', true],
      ['pig_breed', 'Piglets', true],
      ['goats', 'Live goat', true],
      ['ducks', 'Live duck', true],
    ])('%s main product "%s" is sold per head → isAnimalProduct=true', (ent, name, flag) => {
      const main = mainProductForBatch('', ent);
      expect(main?.name).toBe(name);
      expect(main?.isAnimalProduct ?? false).toBe(flag);
      expect(main?.baseUnit).toBe('head');
    });

    // Weight-sold ANIMALS (fish, pork) are still live stock — an animal product —
    // even though they're priced by the kilo. They're sold from the batch (capped by
    // biomass) and must never be treated as a collectible output.
    it.each([
      ['pig_fatten', 'Pork (live weight)'],
      ['tilapia', 'Fish'],
      ['catfish', 'Fish'],
      ['rabbits', 'Rabbit meat'],
    ])('%s main product "%s" is a weight-sold ANIMAL (isAnimalProduct=true, baseUnit=kg)', (ent, name) => {
      const main = mainProductForBatch('', ent);
      expect(main?.name).toBe(name);
      expect(main?.isAnimalProduct).toBe(true);
      expect(main?.baseUnit).toBe('kg');
    });

    it('a CROP main product (maize) is harvested, NOT an animal', () => {
      const main = mainProductForBatch('', 'maize');
      expect(main?.name).toBe('Maize grain');
      expect(main?.isAnimalProduct ?? false).toBe(false);
    });
  });
});
