// Client-safe species → friendly UI noun, so the same screens read naturally for
// birds, pigs, fish and crops. (Kept out of productTemplates.ts, which is server-only.)
import { Egg, Drumstick, PawPrint, Fish, Milk, Bird, Rabbit, Bug, Wheat, Leaf, type LucideIcon } from 'lucide-react';

export function headNoun(species: string | undefined, count = 2): string {
  const s = (species ?? '').toLowerCase();
  if (/pig|sow|pork|hog|boar|piglet/.test(s)) return count === 1 ? 'pig' : 'pigs';
  if (/fish|tilapia|catfish|fingerling/.test(s)) return 'fish';
  if (/goat|kid/.test(s)) return count === 1 ? 'goat' : 'goats';
  if (/cow|cattle|dairy|calf|bull|heifer/.test(s)) return count === 1 ? 'cow' : 'cows';
  if (/duck|muscovy/.test(s)) return count === 1 ? 'duck' : 'ducks';
  if (/rabbit|bunny/.test(s)) return count === 1 ? 'rabbit' : 'rabbits';
  if (/bee|honey/.test(s)) return count === 1 ? 'hive' : 'hives';
  if (/maize|crop|plant|vegetable|bean|tomato|kale|cabbage|seed|grain/.test(s)) return count === 1 ? 'plant' : 'plants';
  if (/chick|broiler|layer|hen|poultry|bird|duck|turkey|quail/.test(s)) return count === 1 ? 'bird' : 'birds';
  return count === 1 ? 'animal' : 'animals';
}

// Heading for the per-batch analysis card (species-aware collective noun).
export function groupNoun(species: string | undefined): string {
  const s = (species ?? '').toLowerCase();
  if (/chick|broiler|layer|hen|poultry|bird|duck|turkey|quail/.test(s)) return 'Flock';
  if (/pig|sow|pork|hog|boar|piglet/.test(s)) return 'Herd';
  if (/fish|tilapia|catfish|fingerling/.test(s)) return 'Stock';
  if (/goat|kid/.test(s)) return 'Herd';
  if (/cow|cattle|dairy|calf|bull|heifer/.test(s)) return 'Herd';
  if (/rabbit|bunny/.test(s)) return 'Colony';
  if (/bee|honey/.test(s)) return 'Apiary';
  if (/maize|crop|plant|vegetable|bean|tomato|kale|cabbage|seed|grain/.test(s)) return 'Crop';
  return 'Batch';
}

// Enterprise → icon + display label for the visual species picker.
export type EnterpriseGroup = 'Poultry' | 'Fish' | 'Livestock' | 'Other';

export interface EnterpriseOption {
  key: string;
  Icon: LucideIcon;
  label: string;
  desc: string;
  group: EnterpriseGroup;
  // The species value auto-filled on the batch when this tile is picked.
  // Deliberately NOT derived from `desc` (marketing copy like "Eggs + manure"
  // doesn't identify a species) — each value here is chosen to read correctly
  // as species text AND match lib/server/productTemplates.ts's
  // enterpriseFromSpecies() regex, so costing/lifecycle/alerts resolve
  // correctly even for the rare batch that predates the `enterprise` column.
  defaultSpecies: string;
}

export const ENTERPRISE_OPTIONS: EnterpriseOption[] = [
  { key: 'layers', Icon: Egg, label: 'Layers', desc: 'Eggs + manure + spent hen', group: 'Poultry', defaultSpecies: 'Layer hens' },
  { key: 'broilers', Icon: Drumstick, label: 'Broilers', desc: 'Meat birds + manure', group: 'Poultry', defaultSpecies: 'Broiler chickens' },
  { key: 'ducks', Icon: Bird, label: 'Ducks', desc: 'Duck eggs + meat + manure', group: 'Poultry', defaultSpecies: 'Ducks' },
  { key: 'tilapia', Icon: Fish, label: 'Tilapia', desc: 'Fish for harvest', group: 'Fish', defaultSpecies: 'Tilapia' },
  { key: 'catfish', Icon: Fish, label: 'Catfish', desc: 'Fish for harvest', group: 'Fish', defaultSpecies: 'Catfish' },
  { key: 'pig_fatten', Icon: PawPrint, label: 'Pigs (meat)', desc: 'Pork production + manure', group: 'Livestock', defaultSpecies: 'Pigs (fattening)' },
  { key: 'pig_breed', Icon: PawPrint, label: 'Pigs (breeding)', desc: 'Piglets + manure', group: 'Livestock', defaultSpecies: 'Breeding pigs' },
  { key: 'goats', Icon: PawPrint, label: 'Goats', desc: 'Meat + milk + manure', group: 'Livestock', defaultSpecies: 'Goats' },
  { key: 'dairy', Icon: Milk, label: 'Dairy cattle', desc: 'Milk + calves + manure', group: 'Livestock', defaultSpecies: 'Dairy cattle' },
  { key: 'rabbits', Icon: Rabbit, label: 'Rabbits', desc: 'Meat + breeding stock + manure', group: 'Livestock', defaultSpecies: 'Rabbits' },
  { key: 'bees', Icon: Bug, label: 'Bees', desc: 'Honey + wax + colonies', group: 'Other', defaultSpecies: 'Bees' },
  { key: 'maize', Icon: Wheat, label: 'Maize / crops', desc: 'Grain harvest', group: 'Other', defaultSpecies: 'Maize' },
];

// Enterprise options bucketed by animal family, in display order — the shape
// the visual picker actually renders (heading + tile grid per group), rather
// than one flat undifferentiated 12-tile grid.
export function groupedEnterpriseOptions(): { group: EnterpriseGroup; options: EnterpriseOption[] }[] {
  const order: EnterpriseGroup[] = ['Poultry', 'Fish', 'Livestock', 'Other'];
  return order
    .map((group) => ({ group, options: ENTERPRISE_OPTIONS.filter((o) => o.group === group) }))
    .filter((g) => g.options.length > 0);
}

// Map enterprise key to icon for the batch table and units.
export function enterpriseIcon(key: string): LucideIcon {
  return ENTERPRISE_OPTIONS.find(e => e.key === key)?.Icon ?? Leaf;
}

// Client-safe broiler check (mirrors lib/server/productTemplates.ts'
// enterpriseFromSpecies, which is server-only and can't be imported from a
// 'use client' page). Used to gate meat-bird-specific UI like the ADG/weight
// projection on the weight-sampling page — that projection assumes a ~40g
// day-old-chick start weight and a ~2.5kg sale target, neither of which holds
// for layers, pigs, fish, or other enterprises.
export function isBroilerSpecies(species: string | undefined): boolean {
  return /broiler/.test((species ?? '').toLowerCase());
}
