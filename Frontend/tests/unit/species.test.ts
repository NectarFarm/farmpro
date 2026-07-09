import { describe, it, expect } from 'vitest';
import { headNoun, groupNoun } from '@/lib/species';

describe('headNoun', () => {
  it('returns "bird" / "birds" for poultry species', () => {
    expect(headNoun('broiler', 1)).toBe('bird');
    expect(headNoun('layer', 2)).toBe('birds');
    expect(headNoun('chicken', 5)).toBe('birds');
    expect(headNoun('duck', 1)).toBe('duck');
    expect(headNoun('turkey', 2)).toBe('birds');
  });

  it('returns "pig" / "pigs" for pig species', () => {
    expect(headNoun('pig', 1)).toBe('pig');
    expect(headNoun('sow', 2)).toBe('pigs');
    expect(headNoun('piglet', 3)).toBe('pigs');
    expect(headNoun('pork', 1)).toBe('pig');
  });

  it('returns "fish" for fish species (always plural)', () => {
    expect(headNoun('tilapia', 1)).toBe('fish');
    expect(headNoun('catfish', 2)).toBe('fish');
    expect(headNoun('fingerling', 5)).toBe('fish');
  });

  it('returns "goat" / "goats" for caprine species', () => {
    expect(headNoun('goat', 1)).toBe('goat');
    expect(headNoun('kid', 2)).toBe('goats');
  });

  it('returns "cow" / "cows" for bovine species', () => {
    expect(headNoun('cow', 1)).toBe('cow');
    expect(headNoun('cattle', 2)).toBe('cows');
    expect(headNoun('dairy', 1)).toBe('cow');
    expect(headNoun('calf', 2)).toBe('cows');
  });

  it('returns "rabbit" / "rabbits" for lagomorphs', () => {
    expect(headNoun('rabbit', 1)).toBe('rabbit');
    expect(headNoun('bunny', 2)).toBe('rabbits');
  });

  it('returns "hive" / "hives" for bees', () => {
    expect(headNoun('bee', 1)).toBe('hive');
    expect(headNoun('honey', 2)).toBe('hives');
  });

  it('returns "plant" / "plants" for crops', () => {
    expect(headNoun('maize', 1)).toBe('plant');
    expect(headNoun('tomato', 2)).toBe('plants');
    expect(headNoun('kale', 1)).toBe('plant');
  });

  it('returns "animal" / "animals" as the default fallback', () => {
    expect(headNoun('unknown', 1)).toBe('animal');
    expect(headNoun('unknown', 2)).toBe('animals');
    expect(headNoun(undefined, 1)).toBe('animal');
    expect(headNoun('', 1)).toBe('animal');
  });

  it('is case-insensitive', () => {
    expect(headNoun('BROILER', 1)).toBe('bird');
    expect(headNoun('Pig', 2)).toBe('pigs');
    expect(headNoun('TILAPIA', 1)).toBe('fish');
  });
});

describe('groupNoun', () => {
  it('returns "Flock" for poultry species', () => {
    expect(groupNoun('broiler')).toBe('Flock');
    expect(groupNoun('layer')).toBe('Flock');
    expect(groupNoun('duck')).toBe('Flock');
  });

  it('returns "Herd" for pigs and goats', () => {
    expect(groupNoun('pig')).toBe('Herd');
    expect(groupNoun('sow')).toBe('Herd');
    expect(groupNoun('goat')).toBe('Herd');
  });

  it('returns "Stock" for fish species', () => {
    expect(groupNoun('tilapia')).toBe('Stock');
    expect(groupNoun('catfish')).toBe('Stock');
  });

  it('returns "Colony" for rabbits', () => {
    expect(groupNoun('rabbit')).toBe('Colony');
  });

  it('returns "Apiary" for bees', () => {
    expect(groupNoun('bee')).toBe('Apiary');
  });

  it('returns "Crop" for plant species', () => {
    expect(groupNoun('maize')).toBe('Crop');
    expect(groupNoun('tomato')).toBe('Crop');
  });

  it('returns "Batch" as the default fallback', () => {
    expect(groupNoun(undefined)).toBe('Batch');
    expect(groupNoun('')).toBe('Batch');
    expect(groupNoun('unknown')).toBe('Batch');
  });

  it('is case-insensitive', () => {
    expect(groupNoun('CHICKEN')).toBe('Flock');
    expect(groupNoun('Fish')).toBe('Stock');
  });
});
