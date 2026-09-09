/**
 * The Harbor: the shelves the superuser moors for everyone else.
 *
 * ── WHY THIS IS NOT THE ISLAND FEATURE ────────────────────────────────────────
 * A user's own islands live in localStorage (see islands/types.ts). That is the
 * right home for them: they are personal, they are edited constantly, and nobody
 * else ever needs to see them.
 *
 * Harbor islands are the opposite. One person writes them, everyone reads them,
 * and they change rarely — which is exactly the shape of the library snapshot, so
 * they are published the same way: one JSON file in the settings bucket, fetched
 * directly by every client. No database rows, so no per-viewer read cost, and no
 * auth to arrange — the bucket is already world-readable and only the superuser
 * screens can reach the publish call.
 *
 * The payload holds asset *filenames*, not copies of the assets, so a harbor
 * island cannot drift out of step with the library: members are resolved against
 * whatever the client already loaded. An asset that has since been deleted simply
 * stops resolving and drops out of the collection.
 *
 * No local cache. The file is a few kilobytes against the library's ~1.8 MB, so
 * a freshness check would cost about as much as just downloading it again.
 */
import {
  storage,
  APPWRITE_SETTINGS_BUCKET_ID,
  HARBOR_FILE_ID,
} from './appwrite';
import { type Island } from '../components/islands/types';

/** Bumped only if the payload shape changes incompatibly. */
const HARBOR_FORMAT = 1;

/**
 * Structurally an Island, so every island component renders one unchanged.
 *
 * It is a distinct name rather than an alias because the two are not
 * interchangeable in the UI: these are read-only everywhere except the admin
 * screen, and nothing outside that screen may write one.
 */
export type HarborIsland = Island;

export interface HarborSnapshot {
  v: number;
  publishedAt: string;
  islands: HarborIsland[];
}

function isMissing(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (error as any)?.code === 404 || msg.includes('not found') || msg.includes('could not be found');
}

/**
 * Every published harbor island, or an empty list.
 *
 * Nothing published yet is a perfectly normal state — the harbor is empty until
 * the superuser fills it — so a missing file returns [] rather than throwing.
 */
export async function fetchHarborIslands(): Promise<HarborIsland[]> {
  try {
    const url = storage
      .getFileView(APPWRITE_SETTINGS_BUCKET_ID, HARBOR_FILE_ID)
      .toString();
    // no-store, for the same reason as the library snapshot: the URL survives a
    // republish, so a cached response would pin everyone to the previous set.
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = await res.json();
    if (!body || !Array.isArray(body.islands)) return [];
    return body.islands as HarborIsland[];
  } catch {
    return [];
  }
}

/** Replace the published set with `islands`. Superuser screens only. */
export async function publishHarborIslands(
  islands: HarborIsland[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: HarborSnapshot = {
      v: HARBOR_FORMAT,
      publishedAt: new Date().toISOString(),
      islands,
    };
    const file = new File([JSON.stringify(payload)], 'harbor.json', {
      type: 'application/json',
    });

    // Appwrite file IDs are immutable, so replacing means delete-then-create.
    try {
      await storage.deleteFile(APPWRITE_SETTINGS_BUCKET_ID, HARBOR_FILE_ID);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await storage.createFile(APPWRITE_SETTINGS_BUCKET_ID, HARBOR_FILE_ID, file);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: isMissing(error)
        ? `Storage bucket "${APPWRITE_SETTINGS_BUCKET_ID}" is unreachable, so nothing was published.`
        : error instanceof Error
          ? error.message
          : 'Could not publish the harbor.',
    };
  }
}
