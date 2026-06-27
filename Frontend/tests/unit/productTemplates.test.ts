import { describe, it, expect } from 'vitest';
import { PRODUCT_TEMPLATES, enterpriseFromSpecies, ENTERPRISE_LABELS } from '@/lib/server/productTemplates';

describe('productTemplates', () => {
  describe('PRODUCT_TEMPLATES', () => {
    it('has all expected enterprise keys', () => {
      const keys = Object.keys(PRODUCT_TEMPLATES);
      expect(keys.sort()).toEqual(['broilers', 'catfish', 'layers', 'maize', 'pig_breed', 'pig_fatten', 'tilapia'].sort());
    });

    it('every product has a name, baseUnit, collectFrequency, and saleUnits', () => {
      for (const [, defs] of Object.entries(PRODUCT_TEMPLATES)) {
        for (const d of defs) {
          expect(d.name).toBeTruthy();
          expect(d.baseUnit).toBeTruthy();
          expect(['daily', 'weekly', 'monthly', 'per_cycle']).toContain(d.collectFrequency);
          expect(d.saleUnits.length).toBeGreaterThan(0);
          for (const u of d.saleUnits) {
            expect(u.name).toBeTruthy();
            expect(u.perBase).toBeGreaterThan(0);
            expect(u.price).toBeGreaterThan(0);
          }
        }
      }
    });

    it('every enterprise has exactly one main product', () => {
      for (const [, defs] of Object.entries(PRODUCT_TEMPLATES)) {
        expect(defs.filter((d) => d.isMainProduct === true)).toHaveLength(1);
      }
    });

    it('every sale unit price is in whole KES (no decimals)', () => {
      for (const defs of Object.values(PRODUCT_TEMPLATES)) {
        for (const d of defs) {
          for (const u of d.saleUnits) {
            expect(Number.isInteger(u.price)).toBe(true);
          }
        }
      }
    });

    it('the live animal is marked as an animal product — sold from stock, never collected', () => {
      // Animal products = the living stock you SELL (a per-head bird/piglet OR a
      // weight-sold fish/pig). They must never be treated as a collectible output.
      const animalMains = ['Live bird', 'Spent hen', 'Piglets', 'Pork (live weight)', 'Fish'];
      const harvested = ['Eggs', 'Manure', 'Maize grain'];
      for (const defs of Object.values(PRODUCT_TEMPLATES)) {
        for (const d of defs) {
          if (animalMains.includes(d.name)) expect(d.isAnimalProduct).toBe(true);
          if (harvested.includes(d.name)) expect(d.isAnimalProduct).toBeFalsy();
        }
      }
      // Every per-head product is still an animal product.
      for (const defs of Object.values(PRODUCT_TEMPLATES)) {
        for (const d of defs) if (d.baseUnit === 'head') expect(d.isAnimalProduct).toBe(true);
      }
    });

    it('layers template yields Eggs, Manure and the spent hen', () => {
      const names = PRODUCT_TEMPLATES.layers.map((d) => d.name);
      expect(names).toEqual(['Eggs', 'Manure', 'Spent hen']);
      expect(PRODUCT_TEMPLATES.layers.find((d) => d.isMainProduct)?.name).toBe('Spent hen');
      expect(PRODUCT_TEMPLATES.layers.find((d) => d.name === 'Eggs')?.collectFrequency).toBe('daily');
    });

    it('broilers template yields the live bird and manure', () => {
      const names = PRODUCT_TEMPLATES.broilers.map((d) => d.name);
      expect(names).toEqual(['Live bird', 'Manure']);
      expect(PRODUCT_TEMPLATES.broilers.find((d) => d.isMainProduct)?.name).toBe('Live bird');
    });

    it('pig_fatten yields pork and manure', () => {
      const names = PRODUCT_TEMPLATES.pig_fatten.map((d) => d.name);
      expect(names).toEqual(['Pork (live weight)', 'Manure']);
    });

    it('pig_breed yields piglets and manure', () => {
      const names = PRODUCT_TEMPLATES.pig_breed.map((d) => d.name);
      expect(names).toEqual(['Piglets', 'Manure']);
    });

    it('tilapia has only Fish', () => {
      expect(PRODUCT_TEMPLATES.tilapia.map((d) => d.name)).toEqual(['Fish']);
    });

    it('catfish has only Fish', () => {
      expect(PRODUCT_TEMPLATES.catfish.map((d) => d.name)).toEqual(['Fish']);
    });

    it('maize has Maize grain', () => {
      expect(PRODUCT_TEMPLATES.maize.map((d) => d.name)).toEqual(['Maize grain']);
    });
  });

  describe('enterpriseFromSpecies', () => {
    it.each([
      ['layer', 'layers'],
      ['LAYER', 'layers'],
      ['pullet layer', 'layers'],
      ['broiler', 'broilers'],
      ['BROILER', 'broilers'],
      ['cobb broiler', 'broilers'],
      ['pig', 'pig_fatten'],
      ['PORK', 'pig_fatten'],
      ['pig breeder', 'pig_breed'],
      ['sow', 'pig_breed'],
      ['sow breeding', 'pig_breed'],
      ['tilapia', 'tilapia'],
      ['TILAPIA', 'tilapia'],
      ['catfish', 'catfish'],
      ['fish (mixed)', 'catfish'],
      ['maize', 'maize'],
      ['CROP', 'maize'],
      ['chicken', 'layers'],
      ['poultry', 'layers'],
      ['hen', 'layers'],
      ['cattle', null],
      ['goat', null],
      ['', null],
    ])('maps "%s" → %s', (species, expected) => {
      expect(enterpriseFromSpecies(species)).toBe(expected);
    });
  });

  describe('ENTERPRISE_LABELS', () => {
    it('has labels for every template key', () => {
      for (const key of Object.keys(PRODUCT_TEMPLATES)) {
        expect(ENTERPRISE_LABELS[key]).toBeTruthy();
      }
    });

    it('every label is a non-empty string', () => {
      for (const label of Object.values(ENTERPRISE_LABELS)) {
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });
});
