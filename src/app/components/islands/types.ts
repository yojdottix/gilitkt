/**
 * An Island is a user-made collection of assets.
 *
 * 2.0 renames the concept from "Project" — the old name implied a work item
 * with a deadline, when these are really just curated shelves. Only the wording
 * and the UI changed; the shape and the storage key are untouched, so existing
 * collections survive the upgrade and old backups still restore.
 */
export interface Island {
  id: string;
  name: string;
  description?: string;
  /** Accent colour, picked from ISLAND_COLORS. */
  color?: string;
  /** nama_file of each member asset. */
  asset_ids: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Deliberately still "gili-projects". Renaming it would orphan every island
 * anyone has already made, and there is nothing to gain from a tidier key that
 * no user ever sees.
 */
export const ISLAND_STORAGE_KEY = "gili-projects";

/** Sidebar/count key for islands. Not an asset type, so it isn't in getAssetCounts(). */
export const ISLANDS_KEY = "Islands";

/** Sidebar/count key for the superuser's published collections. */
export const CURATED_KEY = "Curated";

export const ISLAND_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
];
