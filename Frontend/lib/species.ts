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
export interface EnterpriseOption {
  key: string;
  Icon: LucideIcon;
  label: string;
  desc: string;
  color: string;
}

export const ENTERPRISE_OPTIONS: EnterpriseOption[] = [
  { key: 'layers', Icon: Egg, label: 'Layers', desc: 'Eggs + manure + spent hen', color: 'bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { key: 'broilers', Icon: Drumstick, label: 'Broilers', desc: 'Meat birds + manure', color: 'bg-orange-50 border-orange-200 hover:bg-orange-100' },
  { key: 'pig_fatten', Icon: PawPrint, label: 'Pigs (meat)', desc: 'Pork production + manure', color: 'bg-pink-50 border-pink-200 hover:bg-pink-100' },
  { key: 'pig_breed', Icon: PawPrint, label: 'Pigs (breeding)', desc: 'Piglets + manure', color: 'bg-rose-50 border-rose-200 hover:bg-rose-100' },
  { key: 'tilapia', Icon: Fish, label: 'Tilapia', desc: 'Fish for harvest', color: 'bg-cyan-50 border-cyan-200 hover:bg-cyan-100' },
  { key: 'catfish', Icon: Fish, label: 'Catfish', desc: 'Fish for harvest', color: 'bg-sky-50 border-sky-200 hover:bg-sky-100' },
  { key: 'goats', Icon: PawPrint, label: 'Goats', desc: 'Meat + milk + manure', color: 'bg-teal-50 border-teal-200 hover:bg-teal-100' },
  { key: 'dairy', Icon: Milk, label: 'Dairy cattle', desc: 'Milk + calves + manure', color: 'bg-blue-50 border-blue-200 hover:bg-blue-100' },
  { key: 'ducks', Icon: Bird, label: 'Ducks', desc: 'Duck eggs + meat + manure', color: 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100' },
  { key: 'rabbits', Icon: Rabbit, label: 'Rabbits', desc: 'Meat + breeding stock + manure', color: 'bg-violet-50 border-violet-200 hover:bg-violet-100' },
  { key: 'bees', Icon: Bug, label: 'Bees', desc: 'Honey + wax + colonies', color: 'bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { key: 'maize', Icon: Wheat, label: 'Maize / crops', desc: 'Grain harvest', color: 'bg-green-50 border-green-200 hover:bg-green-100' },
];

// Map enterprise key to icon for the batch table and units.
export function enterpriseIcon(key: string): LucideIcon {
  return ENTERPRISE_OPTIONS.find(e => e.key === key)?.Icon ?? Leaf;
}
