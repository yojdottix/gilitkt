export const PROJECT_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", 
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16"
];

/**
 * Short labels for the type chip, where the full name is too long to sit over
 * the artwork.
 *
 * The first five keys are the values `asset.type` actually holds. This map used
 * to be keyed on 'Spot' and 'Micro' alone, which match nothing in the data, so
 * every lookup fell through to the raw type string and the shortening never
 * happened. The short forms are kept below as aliases in case older records
 * still carry them.
 */
export const ASSET_TYPE_LABELS = {
  'Spot Illustration': 'Spot Illus',
  'Micro Illustration': 'Micro Illus',
  'Icons': 'Icon',
  'Supergraphic': 'Supergraphic',
  'Other': 'Other',

  'Spot': 'Spot Illus',
  'Micro': 'Micro Illus',
  'Icon': 'Icon',
  'General': 'Other'
} as const;

/**
 * Badge/label text for an asset type. Falls back to the raw type string rather
 * than to a hardcoded "Spot Illus", which used to mislabel every Supergraphic
 * and Other asset as a Spot Illustration.
 */
export function getAssetTypeLabel(type: string | undefined | null): string {
  if (!type) return 'Other';
  return ASSET_TYPE_LABELS[type as keyof typeof ASSET_TYPE_LABELS] ?? type;
}

/**
 * The Asset Type filter's options, in the order the design lists them.
 *
 * `value` is what `asset.type` actually holds — the short forms — and `label` is
 * the full name the design writes. Three of the five differ, which is why this
 * can't be derived from ASSET_TYPE_LABELS: that map runs the other way, and its
 * keys include legacy aliases that would show up here as duplicate rows.
 *
 * These are the same five buckets the sidebar counts, so a type outside the list
 * (the "General" fallback from extractTypeFromFilename) is filtered out by any
 * selection — exactly as it already is by the sidebar's own categories.
 */
export const ASSET_TYPE_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Spot', label: 'Spot Illustration' },
  { value: 'Micro', label: 'Micro Illustration' },
  { value: 'Icon', label: 'Icon' },
  { value: 'Supergraphic', label: 'Supergraphic' },
  { value: 'Other', label: 'Other' },
];