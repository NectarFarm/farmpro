import 'server-only';
// Default products per enterprise — so a pig batch never gets "eggs", and a layer
// batch gets eggs (sold by tray or piece) + manure. The farmer can edit after.

export interface ProductDef {
  name: string;
  baseUnit: string;
  collectFrequency: 'daily' | 'weekly' | 'monthly' | 'per_cycle';
  flow?: 'sale' | 'expense';
  saleUnits: { name: string; perBase: number; price: number }[];
  isAnimalProduct?: boolean;
  isMainProduct?: boolean;
}

// Common byproduct most poultry/pig enterprises sell.
const MANURE: ProductDef = {
  name: 'Manure', baseUnit: 'kg', collectFrequency: 'weekly', flow: 'sale',
  saleUnits: [{ name: 'Sack (50kg)', perBase: 50, price: 300 }, { name: 'Kg', perBase: 1, price: 8 }],
};

// Each enterprise's default products. Exactly ONE is the main product (the animal
// itself or the primary harvest); the rest are secondary outputs the batch yields
// (eggs, manure). On batch creation ALL of these are created, so a layer batch gets
// its Eggs product automatically — not just the spent hen.
export const PRODUCT_TEMPLATES: Record<string, ProductDef[]> = {
  layers: [
    { name: 'Eggs', baseUnit: 'piece', collectFrequency: 'daily', saleUnits: [{ name: 'Tray (30)', perBase: 30, price: 360 }, { name: 'Piece', perBase: 1, price: 13 }] },
    MANURE,
    { name: 'Spent hen', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bird', perBase: 1, price: 400 }], isAnimalProduct: true, isMainProduct: true },
  ],
  broilers: [
    { name: 'Live bird', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bird', perBase: 1, price: 600 }], isAnimalProduct: true, isMainProduct: true },
    MANURE,
  ],
  pig_fatten: [
    { name: 'Pork (live weight)', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 350 }], isMainProduct: true },
    MANURE,
  ],
  pig_breed: [
    { name: 'Piglets', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Piglet', perBase: 1, price: 3500 }], isAnimalProduct: true, isMainProduct: true },
    MANURE,
  ],
  tilapia: [{ name: 'Fish', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 400 }], isMainProduct: true }],
  catfish: [{ name: 'Fish', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 400 }], isMainProduct: true }],
  maize: [{ name: 'Maize grain', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bag (90kg)', perBase: 90, price: 3500 }, { name: 'Kg', perBase: 1, price: 45 }], isMainProduct: true }],
};

// Best-effort map from a free-text species to an enterprise template.
export function enterpriseFromSpecies(species: string): string | null {
  const s = species.toLowerCase();
  if (s.includes('layer') || (s.includes('chick') && s.includes('lay'))) return 'layers';
  if (s.includes('broiler')) return 'broilers';
  if ((s.includes('pig') && s.includes('breed')) || s.includes('sow')) return 'pig_breed';
  if (s.includes('pig') || s.includes('pork')) return 'pig_fatten';
  if (s.includes('tilapia')) return 'tilapia';
  if (s.includes('catfish') || s.includes('fish')) return 'catfish';
  if (s.includes('maize') || s.includes('crop')) return 'maize';
  if (s.includes('chick') || s.includes('poultry') || s.includes('hen')) return 'layers';
  return null;
}

export const ENTERPRISE_LABELS: Record<string, string> = {
  layers: 'Layers (eggs)', broilers: 'Broilers (meat)', pig_fatten: 'Pig fattening',
  pig_breed: 'Pig breeding', tilapia: 'Tilapia', catfish: 'Catfish', maize: 'Maize',
};
