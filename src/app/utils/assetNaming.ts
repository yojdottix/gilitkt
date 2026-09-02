/**
 * Deriving asset_name and type from a filename.
 *
 * These wrap the functions the CSV importer already uses, so a manually entered
 * asset is indistinguishable from an imported one. Two separate implementations of
 * "what should this be called" is how the two paths would silently drift.
 */
import { generateAssetName, generateTypeFromFilename, IMAGE_EXTENSION_RE } from './csvParser';

/**
 * The types the app can actually display.
 *
 * IMPORTANT: these strings are what the sidebar counts. An asset stored with any
 * other value belongs to no category, so it never appears under any section and is
 * effectively invisible — you can only find it by searching. That's why the
 * "Uncategorized" choice stores `Other` rather than the literal word.
 */
export const SELECTABLE_TYPES = [
  { value: 'Spot', label: 'Spot Illustration' },
  { value: 'Micro', label: 'Micro Illustration' },
  { value: 'Icon', label: 'Icon' },
  { value: 'Supergraphic', label: 'Supergraphic' },
  { value: 'Other', label: 'Uncategorized' },
] as const;

export const VALID_TYPE_VALUES = SELECTABLE_TYPES.map((t) => t.value) as readonly string[];

/**
 * Coerce anything into a type the sidebar can see.
 *
 * `generateTypeFromFilename` returns "General" when it can't tell — and "General"
 * is one of those invisible values, counted by no category. Mapping it to "Other"
 * here means manual entries can never land in that hole.
 */
export function normalizeType(type: string | undefined | null): string {
  const t = (type || '').trim();
  return VALID_TYPE_VALUES.includes(t) ? t : 'Other';
}

/** asset_name derived from a filename: drop the extension, underscores to spaces. */
export function deriveAssetName(filename: string): string {
  return generateAssetName((filename || '').trim());
}

/** Best guess at the type from the filename prefix, always a visible value. */
export function detectType(filename: string): string {
  return normalizeType(generateTypeFromFilename((filename || '').trim()));
}

/**
 * The canonical key for matching one filename against another.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * Every filename comparison used the raw string, so `Halim.png` and `halim.png`
 * were two different assets. The consequences were silent and all bad:
 *
 *   - The database check graded a re-upload as "New" rather than "Replaced", so
 *     the link was never replaced and the asset kept pointing at the retired file.
 *   - The import then CREATED a second row, leaving two entries for one artwork,
 *     each with a different link, with nothing to say which was current.
 *   - The in-batch duplicate guard missed it too, so a CSV carrying both
 *     spellings imported both without complaint.
 *
 * Casing carries no meaning here. Lightroom exports, spreadsheets and hand-typed
 * rows disagree about it constantly, and nobody intends `Halim` and `halim` to be
 * separate artwork.
 *
 * The extension carries no meaning either, for the same reason. The library holds
 * `tds_ic_purchase_list_blue.png` while the sheet you are pasting from, or your
 * own typing, says `tds_ic_purchase_list_blue` — and every failure above repeated
 * itself: the row graded as New, the link was never replaced, and the import
 * created a second entry for artwork that was already there. Nobody means those
 * two spellings as different assets; `asset_name` has always dropped the
 * extension too, so the two rows were even displayed under one identical name.
 *
 * The cost of collapsing it is that `foo.png` and `foo.svg` become one asset.
 * That is the intended trade: a Lightroom link points at one exported file, so a
 * single asset carrying both spellings is a duplicate to be reconciled rather
 * than two things to keep apart — and it is surfaced as such by the callers that
 * build an index off this key.
 *
 * USE FOR LOOKUPS ONLY — never store it. `nama_file` keeps whatever casing and
 * extension it was created with, because that is the string people copy, paste
 * and search for. Rewriting stored filenames would silently rename thousands of
 * assets, which is a far bigger change than fixing a comparison.
 */
export function assetKey(filename: string | undefined | null): string {
  return (filename || '')
    .trim()
    .toLowerCase()
    .replace(IMAGE_EXTENSION_RE, '');
}

/** Strip whitespace and a leading/trailing quote people paste in by accident. */
export function cleanFilename(value: string): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

/**
 * When an asset last changed in any way — created, relinked, retyped or renamed.
 *
 * "Most Recent" used to read `created_at` alone, which quietly excluded the most
 * useful case: an asset that was re-uploaded to Lightroom and relinked. Its
 * artwork is new, but its created_at is months old, so it sat wherever it always
 * had and nobody saw the redesign.
 *
 * Takes the later of the two timestamps rather than preferring updated_at,
 * because Appwrite sets both on creation and a clock or import quirk shouldn't be
 * able to rank a brand new asset below an old one.
 */
export function lastTouchedAt(asset: { created_at?: string; updated_at?: string }): number {
  const created = asset.created_at ? Date.parse(asset.created_at) : NaN;
  const updated = asset.updated_at ? Date.parse(asset.updated_at) : NaN;
  const valid = [created, updated].filter((t) => !Number.isNaN(t));
  return valid.length > 0 ? Math.max(...valid) : 0;
}
