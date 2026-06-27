// Client-safe species → friendly UI noun, so the same screens read naturally for
// birds, pigs, fish and crops. (Kept out of productTemplates.ts, which is server-only.)

export function headNoun(species: string | undefined, count = 2): string {
  const s = (species ?? '').toLowerCase();
  if (/pig|sow|pork|hog|boar|piglet/.test(s)) return count === 1 ? 'pig' : 'pigs';
  if (/fish|tilapia|catfish|fingerling/.test(s)) return 'fish';
  if (/maize|crop|plant|vegetable|bean|tomato|kale|cabbage|seed|grain/.test(s)) return count === 1 ? 'plant' : 'plants';
  if (/chick|broiler|layer|hen|poultry|bird|duck|turkey|quail/.test(s)) return count === 1 ? 'bird' : 'birds';
  return count === 1 ? 'animal' : 'animals';
}

// Heading for the per-batch analysis card (a "flock" only makes sense for poultry).
export function groupNoun(species: string | undefined): string {
  const s = (species ?? '').toLowerCase();
  if (/chick|broiler|layer|hen|poultry|bird|duck|turkey|quail/.test(s)) return 'Flock';
  if (/pig|sow|pork|hog|boar|piglet/.test(s)) return 'Herd';
  if (/fish|tilapia|catfish|fingerling/.test(s)) return 'Stock';
  if (/maize|crop|plant|vegetable|bean|tomato|kale|cabbage|seed|grain/.test(s)) return 'Crop';
  return 'Batch';
}
