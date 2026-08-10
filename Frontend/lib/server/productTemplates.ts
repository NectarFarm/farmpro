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
  // The costing denominator for this enterprise — exactly one per enterprise.
  // Usually the same product as isMainProduct, EXCEPT where the batch's asset
  // (the animal itself) differs from the ongoing commodity a farmer actually
  // costs feed/effort against (layers: spent hen vs eggs; dairy/goats: the
  // animal vs milk; ducks: the animal vs duck eggs; bees: the colony vs honey).
  isCostDriver?: boolean;
}

// Common byproduct most poultry/pig/livestock enterprises sell.
const MANURE: ProductDef = {
  name: 'Manure', baseUnit: 'kg', collectFrequency: 'weekly', flow: 'sale',
  saleUnits: [{ name: 'Sack (50kg)', perBase: 50, price: 300 }, { name: 'Kg', perBase: 1, price: 8 }],
};

// Cost driver for both dairy and goats: the animal (mature cow / live goat) is
// the main product (the asset sold once), but milk is the ongoing commodity a
// farmer actually costs feed/effort against.
const MILK: ProductDef = {
  name: 'Milk', baseUnit: 'litre', collectFrequency: 'daily', flow: 'sale',
  saleUnits: [{ name: 'Litre', perBase: 1, price: 60 }, { name: 'Jersey (5L)', perBase: 5, price: 280 }],
  isCostDriver: true,
};

// Cost driver for bees: the colony/nuc is the main product (the asset, rarely
// sold), but honey is what a beekeeper actually costs against.
const HONEY: ProductDef = {
  name: 'Honey', baseUnit: 'kg', collectFrequency: 'per_cycle', flow: 'sale',
  saleUnits: [{ name: 'Kg', perBase: 1, price: 800 }, { name: 'Jar (500g)', perBase: 0.5, price: 450 }],
  isCostDriver: true,
};

// Each enterprise's default products. Exactly ONE is the main product (the animal
// itself or the primary harvest); the rest are secondary outputs the batch yields
// (eggs, manure). On batch creation ALL of these are created, so a layer batch gets
// its Eggs product automatically — not just the spent hen.
export const PRODUCT_TEMPLATES: Record<string, ProductDef[]> = {
  layers: [
    { name: 'Eggs', baseUnit: 'piece', collectFrequency: 'daily', saleUnits: [{ name: 'Tray (30)', perBase: 30, price: 360 }, { name: 'Piece', perBase: 1, price: 13 }], isCostDriver: true },
    MANURE,
    { name: 'Spent hen', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bird', perBase: 1, price: 400 }], isAnimalProduct: true, isMainProduct: true },
  ],
  broilers: [
    { name: 'Live bird', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bird', perBase: 1, price: 600 }], isAnimalProduct: true, isMainProduct: true, isCostDriver: true },
    MANURE,
  ],
  pig_fatten: [
    { name: 'Pork (live weight)', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 350 }], isAnimalProduct: true, isMainProduct: true, isCostDriver: true },
    MANURE,
  ],
  pig_breed: [
    { name: 'Piglets', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Piglet', perBase: 1, price: 3500 }], isAnimalProduct: true, isMainProduct: true, isCostDriver: true },
    MANURE,
  ],
  tilapia: [{ name: 'Fish', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 400 }], isAnimalProduct: true, isMainProduct: true, isCostDriver: true }],
  catfish: [{ name: 'Fish', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 400 }], isAnimalProduct: true, isMainProduct: true, isCostDriver: true }],
  maize: [{ name: 'Maize grain', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bag (90kg)', perBase: 90, price: 3500 }, { name: 'Kg', perBase: 1, price: 45 }], isMainProduct: true, isCostDriver: true }],
  goats: [
    { name: 'Live goat', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Head', perBase: 1, price: 5000 }, { name: 'Kg live weight', perBase: 1, price: 350 }], isAnimalProduct: true, isMainProduct: true },
    MILK,
    MANURE,
  ],
  dairy: [
    { name: 'Mature cow', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Head', perBase: 1, price: 40000 }], isAnimalProduct: true, isMainProduct: true },
    MILK,
    { name: 'Calf', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Head', perBase: 1, price: 8000 }], isAnimalProduct: true },
    MANURE,
  ],
  ducks: [
    { name: 'Eggs (duck)', baseUnit: 'piece', collectFrequency: 'daily', saleUnits: [{ name: 'Tray (30)', perBase: 30, price: 450 }, { name: 'Piece', perBase: 1, price: 18 }], isCostDriver: true },
    { name: 'Live duck', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Bird', perBase: 1, price: 800 }], isAnimalProduct: true, isMainProduct: true },
    MANURE,
  ],
  rabbits: [
    { name: 'Rabbit meat', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 600 }, { name: 'Whole rabbit (2kg)', perBase: 2, price: 1100 }], isAnimalProduct: true, isMainProduct: true, isCostDriver: true },
    { name: 'Breeding stock', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Buck', perBase: 1, price: 2000 }, { name: 'Doe', perBase: 1, price: 2500 }], isAnimalProduct: true },
    MANURE,
  ],
  bees: [
    HONEY,
    { name: 'Wax', baseUnit: 'kg', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Kg', perBase: 1, price: 500 }] },
    { name: 'Colony / nuc', baseUnit: 'head', collectFrequency: 'per_cycle', saleUnits: [{ name: 'Nuc (5 frames)', perBase: 1, price: 6000 }], isAnimalProduct: true, isMainProduct: true },
  ],
};

// Best-effort map from a free-text species to an enterprise template.
export function enterpriseFromSpecies(species: string): string | null {
  const s = species.toLowerCase();
  if (s.includes('layer') || (s.includes('chick') && s.includes('lay')) || s.includes('kienyeji') || s.includes('indigenous chicken')) return 'layers';
  if (s.includes('broiler')) return 'broilers';
  if ((s.includes('pig') && s.includes('breed')) || s.includes('sow') || s.includes('piglet')) return 'pig_breed';
  if (s.includes('pig') || s.includes('pork') || s.includes('hog') || s.includes('boar')) return 'pig_fatten';
  if (s.includes('tilapia')) return 'tilapia';
  if (s.includes('catfish') || s.includes('fish') || s.includes('pond')) return 'catfish';
  if (s.includes('maize') || s.includes('crop') || s.includes('corn')) return 'maize';
  if (s.includes('chick') || s.includes('poultry') || s.includes('hen') || s.includes('rooster') || s.includes('cock')) return 'layers';
  if (s.includes('goat') || s.includes('kid')) return 'goats';
  if (s.includes('cow') || s.includes('dairy') || s.includes('cattle') || s.includes('calf') || s.includes('bull') || s.includes('heifer')) return 'dairy';
  if (s.includes('duck') || s.includes('muscovy')) return 'ducks';
  if (s.includes('rabbit') || s.includes('bunny') || s.includes('doe') || s.includes('buck')) return 'rabbits';
  if (s.includes('bee') || s.includes('honey') || s.includes('apiary') || s.includes('hive')) return 'bees';
  return null;
}

// Single source of truth for "what enterprise is this batch": the persisted
// column, set unambiguously from the creation-time picker, wins whenever it's
// present. Falls back to the free-text species matcher above only for batches
// created before the `enterprise` column existed, or via free-text species
// entry (setup wizard) with no picker involved.
export function resolveEnterprise(batch: { enterprise?: string | null; species?: string | null }): string | null {
  return batch.enterprise || enterpriseFromSpecies(batch.species ?? '');
}

export const ENTERPRISE_LABELS: Record<string, string> = {
  layers: 'Layers (eggs)', broilers: 'Broilers (meat)', pig_fatten: 'Pig fattening',
  pig_breed: 'Pig breeding', tilapia: 'Tilapia', catfish: 'Catfish', maize: 'Maize',
  goats: 'Goats (meat + milk)', dairy: 'Dairy cattle (milk)', ducks: 'Ducks (eggs + meat)',
  rabbits: 'Rabbits (meat + breeding)', bees: 'Bees (honey + wax)',
};

// Average live weight (kg) of ONE animal at sale, for batches whose main product is
// sold BY WEIGHT (fish, pork). Used to cap a kg sale against the living headcount
// (sellable kg ≈ head × avgWeight) and to convert kg sold back into head removed.
// A weight-sampling record refines this per batch; this is the sensible default.
const DEFAULT_LIVE_WEIGHT_KG: Record<string, number> = {
  pig_fatten: 80,
  tilapia: 0.4,
  catfish: 1.0,
  goats: 30,
  dairy: 400,
  ducks: 1.5,
  rabbits: 2,
};

export function defaultLiveWeightKg(species: string, enterprise?: string | null): number | null {
  const ent = enterprise || enterpriseFromSpecies(species);
  return ent && DEFAULT_LIVE_WEIGHT_KG[ent] != null ? DEFAULT_LIVE_WEIGHT_KG[ent] : null;
}
