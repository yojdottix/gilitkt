/* Data access layer for the "assets" table in Appwrite.
   See ./appwrite.ts for the client/config setup. */
import {
  databases,
  storage,
  ID,
  Query,
  APPWRITE_DATABASE_ID,
  APPWRITE_ASSETS_COLLECTION_ID,
  APPWRITE_SETTINGS_BUCKET_ID,
  ABOUT_IMAGE_FILE_ID,
  SUPERUSER_CREDENTIAL_FILE_ID,
  APPWRITE_CONFIG_ERROR,
} from './appwrite';

export interface Asset {
  id: string; // Appwrite's own document $id — always unique, use this for React keys etc.
  nama_file: string; // Business key (filename) — NOT guaranteed unique if a file got imported more than once
  asset_name: string;
  url_lightroom: string;
  type: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * An asset that does not exist in the database yet.
 *
 * `id` is Appwrite's document $id, minted by `ID.unique()` at insert time, and
 * `created_at`/`updated_at` come from $createdAt/$updatedAt — so none of the
 * three can be known by a caller building rows from a CSV. The create paths
 * previously asked for `Omit<Asset, 'created_at' | 'updated_at'>`, which still
 * demanded an `id` that is ignored on the way in.
 */
export type AssetDraft = Omit<Asset, 'id' | 'created_at' | 'updated_at'>;

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  count?: number;
  updatedCount?: number;
  /** Rows whose url_lightroom was overwritten because the asset was re-uploaded. */
  replacedCount?: number;
  /** Rows that matched an existing asset and needed no write. */
  unchangedCount?: number;
  source?: string;
  errors?: string[];
}

// Appwrite stores its own document id ($id) and timestamps ($createdAt/$updatedAt)
// alongside our fields. We read the timestamps from those built-in fields (instead
// of maintaining our own created_at/updated_at columns) and expose them under the
// same created_at/updated_at names components already expect.
function toAsset(doc: any): Asset {
  return {
    id: doc.$id,
    nama_file: doc.nama_file,
    asset_name: doc.asset_name,
    url_lightroom: doc.url_lightroom,
    type: doc.type,
    created_at: doc.$createdAt,
    updated_at: doc.$updatedAt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error occurred';
}

/**
 * Is this the "you've used your monthly database reads" wall?
 *
 * Worth detecting specifically, because it presents identically to being offline
 * — a failed request and an empty library — while the cause and the fix are
 * completely different. "Connection Error" sent someone hunting for a network
 * problem that didn't exist.
 */
export function isReadQuotaError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('reads limit') ||
    msg.includes('read limit') ||
    (msg.includes('billing cycle') && msg.includes('exceeded')) ||
    msg.includes('budget cap')
  );
}

/** What to tell the user when the read quota is the problem. */
export const READ_QUOTA_MESSAGE =
  "Appwrite's monthly database-read allowance is used up, so the library can't be fetched. " +
  'Anyone who has opened GILI before still sees their cached copy. ' +
  'To fix it for everyone without waiting for the quota to reset, open Superuser → Backup & Restore ' +
  "on a browser that has the library loaded and press “Publish from this browser's cache”.";

// Look up the underlying Appwrite document by our logical key (nama_file),
// since Appwrite's own document id is a separate, auto-generated value.
async function findDocumentByFilename(nama_file: string): Promise<any | null> {
  const res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, [
    Query.equal('nama_file', nama_file),
    Query.limit(1),
  ]);
  return res.documents[0] || null;
}

// Connectivity check. NOT called on load any more, and it must not be: it runs
// listDocuments, which Appwrite bills as a read, so calling it before every load
// charged one read per visitor per page view — invisible, pointless, and it
// contradicted the whole zero-read design. Kept only for explicit diagnostics.
export async function initializeAssetSystem(): Promise<ApiResponse<any>> {
  console.log('🚀 Checking asset management system...');
  try {
    await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, [Query.limit(1)]);
    return { success: true, message: 'System ready' };
  } catch (error) {
    console.error('🚨 Failed to reach Appwrite:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// --- Persistent asset cache (IndexedDB) + one-request freshness check ---
//
// The old design cached in localStorage with a 5-minute TTL. Two problems:
//   1. Almost every visit landed outside the 5-minute window, so opening GILI
//      meant ~45 paginated requests and a 1.84 MB download, every time.
//   2. At 4,486 assets the payload is ~3.67 MB in localStorage's UTF-16 storage
//      against a ~5 MB quota — and it fails silently on overflow.
//
// Now: the cache never expires on a timer. Instead each load asks Appwrite ONE
// cheap question — "how many documents, and when was the newest one touched?" —
// and only re-downloads when the answer differs from what the cache recorded.
// Unchanged libraries cost a single small request instead of forty-five.
import { countReads } from './readBudget';
import { getSnapshotInfo, downloadSnapshot, publishSnapshot } from './librarySnapshot';
import { assetKey } from './assetNaming';
import { searchAssetList } from './search';
import {
  readCachedAssets,
  writeCachedAssets,
  clearCachedAssets,
  isPersistentCacheAvailable,
  localSettingGet,
  localSettingSet,
  localSettingDelete,
  type CacheMeta,
} from './assetStore';

export type { CacheMeta };

/** Emitted whenever the cache state changes, so the UI can show "last synced". */
export type SyncStatus = 'cache-hit' | 'synced' | 'offline-cache' | 'no-cache';

let lastSync: { status: SyncStatus; meta: CacheMeta | null } = { status: 'no-cache', meta: null };
const syncListeners = new Set<(s: typeof lastSync) => void>();

export function getSyncState() {
  return lastSync;
}

export function onSyncStateChange(fn: (s: typeof lastSync) => void) {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}

function setSyncState(status: SyncStatus, meta: CacheMeta | null) {
  lastSync = { status, meta };
  syncListeners.forEach((fn) => fn(lastSync));
}

/**
 * The whole point of this module: one request that answers "did anything change?"
 *
 * `total` comes back on every listDocuments response, so asking for a single
 * document ordered by $updatedAt descending gets us both numbers at once.
 * total    -> catches creates and deletes
 * updatedAt-> catches edits, and disambiguates "one deleted + one added"
 */
export async function fetchServerFingerprint(): Promise<{ total: number; latestUpdatedAt: string } | null> {
  try {
    const res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, [
      Query.orderDesc('$updatedAt'),
      Query.limit(1),
    ]);
    void countReads(res.documents.length);
    return {
      total: res.total,
      latestUpdatedAt: (res.documents[0] as any)?.$updatedAt || '',
    };
  } catch (error) {
    console.warn('Freshness check failed:', errorMessage(error));
    return null;
  }
}

// Call after any write so stale cached data never lingers.
export function invalidateAssetsCache() {
  void clearCachedAssets();
  setSyncState('no-cache', null);
}

/**
 * Republish the library after a write, applying the change locally.
 *
 * Invalidating the cache instead — which is what every write path used to do —
 * forces the next load to scan the whole collection: 4,486 reads for a one-field
 * edit, multiplied by every device that opens the app afterwards. Since we know
 * exactly what changed, we can transform the published list and re-publish it for
 * zero database reads.
 *
 * `mutate` receives the current library and returns the new one. Returning the
 * same array unchanged is fine.
 */
async function republishLibrary(mutate: (assets: Asset[]) => Asset[]): Promise<void> {
  try {
    const current = await getAllAssets();
    if (!current.success || !current.data) {
      invalidateAssetsCache();
      return;
    }
    const next = mutate(current.data);
    const published = await publishSnapshot(next);
    if (!published.success) {
      // Correctness beats cost: if we can't publish, make sure nobody serves a
      // stale copy, even though the next load will be expensive.
      invalidateAssetsCache();
      return;
    }
    const info = await getSnapshotInfo();
    await writeCachedAssets(next, {
      total: next.length,
      latestUpdatedAt: new Date().toISOString(),
      syncedAt: Date.now(),
      snapshotVersion: info?.version,
    });
    setSyncState('synced', {
      total: next.length,
      latestUpdatedAt: new Date().toISOString(),
      syncedAt: Date.now(),
      snapshotVersion: info?.version,
    });
  } catch {
    invalidateAssetsCache();
  }
}

/**
 * Publish the snapshot from THIS browser's cache, without reading the database.
 *
 * This exists because of a genuine chicken-and-egg: the snapshot is what stops
 * viewers reading the database, but publishing it from the database costs one read
 * per row — so the moment you actually need it (reads exhausted, everyone locked
 * out) is the moment you can't create it.
 *
 * A browser that already loaded the library has all of it in IndexedDB. Publishing
 * from there costs zero database reads and immediately unblocks every other
 * browser, including incognito and other people's machines, because they'll read
 * the Storage file instead.
 *
 * The caveat, stated plainly: this publishes what THIS browser last saw. If the
 * database changed since, the snapshot will be that stale. Use
 * rebuildSnapshotFromDatabase() once reads are available again if you want
 * certainty.
 */
export async function publishSnapshotFromCache(): Promise<
  ApiResponse<null> & { assetCount?: number; syncedAt?: number }
> {
  const cached = await readCachedAssets<Asset>();
  if (!cached || cached.data.length === 0) {
    return {
      success: false,
      error:
        "This browser has no cached copy of the library, so there's nothing to publish. Open GILI in a browser that has loaded the assets before, and publish from there.",
    };
  }

  const published = await publishSnapshot(cached.data);
  if (!published.success) {
    return { success: false, error: published.error };
  }

  const info = await getSnapshotInfo();
  await writeCachedAssets(cached.data, { ...cached.meta, snapshotVersion: info?.version, syncedAt: Date.now() });

  return {
    success: true,
    assetCount: cached.data.length,
    syncedAt: cached.meta.syncedAt,
    message: `Published ${cached.data.length.toLocaleString('en-US')} assets from this browser's cache, using zero database reads. Everyone else can now load GILI.`,
  };
}

/**
 * Rebuild the published snapshot from the database, authoritatively.
 *
 * Costs one read per row — the expensive path, on purpose. Everything else keeps
 * the snapshot up to date by applying known changes locally, which is exact but
 * assumes nothing wrote behind our back. This is the button you press when you
 * want to stop assuming: after editing rows directly in the Appwrite console, or
 * if the counts ever look wrong.
 */
export async function rebuildSnapshotFromDatabase(
  onProgress?: (fetched: number) => void
): Promise<ApiResponse<null> & { rowsRead?: number }> {
  try {
    const assets = await fetchAllFromAppwrite(onProgress);
    const published = await publishSnapshot(assets);
    if (!published.success) return { success: false, error: published.error };

    const info = await getSnapshotInfo();
    await writeCachedAssets(assets, {
      total: assets.length,
      latestUpdatedAt: new Date().toISOString(),
      syncedAt: Date.now(),
      snapshotVersion: info?.version,
    });
    return {
      success: true,
      rowsRead: assets.length,
      message: `Published ${assets.length} assets. That cost ${assets.length.toLocaleString('en-US')} database reads.`,
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export { isPersistentCacheAvailable };

/**
 * Scan every row in the collection. THE expensive operation in this app.
 *
 * At 4,486 assets this costs 4,486 database reads — about 0.9% of the free tier's
 * monthly allowance — because Appwrite bills per row, not per request. Anything
 * calling this should be able to justify why the published snapshot or the local
 * cache wouldn't do.
 */
async function fetchAllFromAppwrite(onProgress?: (fetched: number) => void): Promise<Asset[]> {
  const assets: Asset[] = [];
  let cursor: string | undefined;
  while (true) {
    const queries = [Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, queries);
    res.documents.forEach((doc: any) => assets.push(toAsset(doc)));
    void countReads(res.documents.length);
    onProgress?.(assets.length);
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return assets;
}

/**
 * Get all assets.
 *
 * Resolution order, cheapest first:
 *
 *   1. Local cache validated against the published snapshot's version.
 *      Cost: ZERO database reads (a Storage metadata call).
 *   2. Download the published snapshot.
 *      Cost: ZERO database reads (Storage bandwidth).
 *   3. Local cache validated against the database fingerprint.
 *      Cost: 1 read. Only used when no snapshot has been published.
 *   4. Full scan of the collection.
 *      Cost: one read per row. The last resort.
 *
 * Steps 1 and 2 are why this app can be opened to a team without the read budget
 * scaling with the number of viewers. Before the snapshot existed, every import
 * invalidated every cached copy and each viewer paid for a full re-scan.
 *
 * `forceRefresh` skips the caches but still prefers the snapshot, since a stale
 * snapshot is the publisher's problem to fix, not something to burn 4,486 reads
 * working around.
 */
export async function getAllAssets(options?: {
  forceRefresh?: boolean;
  onProgress?: (fetched: number) => void;
  /** Bypass the snapshot and read the database. For the superuser before a write. */
  fromDatabase?: boolean;
}): Promise<ApiResponse<Asset[]>> {
  // Without credentials every request below fails, but each one fails as a
  // connection error. Stop here so the real cause is what reaches the user.
  if (APPWRITE_CONFIG_ERROR) {
    return { success: false, error: APPWRITE_CONFIG_ERROR };
  }

  const cached = options?.forceRefresh ? null : await readCachedAssets<Asset>();

  // --- Snapshot path: no database involvement whatsoever ---
  if (!options?.fromDatabase) {
    const info = await getSnapshotInfo();
    if (info) {
      if (cached?.meta.snapshotVersion && cached.meta.snapshotVersion === info.version) {
        console.log(`📦 Snapshot unchanged — serving ${cached.data.length} cached assets (0 database reads).`);
        setSyncState('cache-hit', cached.meta);
        return { success: true, data: cached.data, count: cached.data.length, source: 'cache' };
      }

      const snapshot = await downloadSnapshot<Asset>();
      if (snapshot) {
        const meta: CacheMeta = {
          total: snapshot.total,
          latestUpdatedAt: snapshot.publishedAt,
          syncedAt: Date.now(),
          snapshotVersion: info.version,
        };
        await writeCachedAssets(snapshot.assets, meta);
        setSyncState('synced', meta);
        console.log(`📥 Downloaded snapshot: ${snapshot.assets.length} assets (0 database reads).`);
        return { success: true, data: snapshot.assets, count: snapshot.assets.length, source: 'appwrite' };
      }
      // Snapshot metadata existed but the body didn't parse — fall through.
    }
  }

  // --- Database path: only when there's no usable snapshot ---
  if (cached) {
    const fingerprint = await fetchServerFingerprint();

    if (!fingerprint) {
      // Offline or Appwrite unreachable — the cache is the best answer we have.
      console.log(`📦 Offline: serving ${cached.data.length} cached assets.`);
      setSyncState('offline-cache', cached.meta);
      return { success: true, data: cached.data, count: cached.data.length, source: 'cache-offline' };
    }

    const unchanged =
      fingerprint.total === cached.meta.total &&
      fingerprint.latestUpdatedAt === cached.meta.latestUpdatedAt;

    if (unchanged) {
      console.log(`📦 Nothing changed — serving ${cached.data.length} cached assets (1 read).`);
      setSyncState('cache-hit', cached.meta);
      return { success: true, data: cached.data, count: cached.data.length, source: 'cache' };
    }

    console.log(
      `🔄 Server changed (${cached.meta.total} -> ${fingerprint.total} assets). Re-syncing…`
    );
  }

  try {
    const assets = await fetchAllFromAppwrite(options?.onProgress);

    // Re-read the fingerprint AFTER the download rather than reusing the one
    // from before it. If a write landed mid-sync, storing the older fingerprint
    // would mark the cache fresh while it's actually missing that row.
    const after = await fetchServerFingerprint();
    const meta: CacheMeta = {
      total: after?.total ?? assets.length,
      latestUpdatedAt: after?.latestUpdatedAt ?? '',
      syncedAt: Date.now(),
    };

    await writeCachedAssets(assets, meta);
    setSyncState('synced', meta);
    return { success: true, data: assets, count: assets.length, source: 'appwrite' };
  } catch (error) {
    console.error('🚨 Failed to fetch assets:', error);
    // Last resort: if the network fetch blew up but we have a cache, use it.
    if (cached) {
      setSyncState('offline-cache', cached.meta);
      return { success: true, data: cached.data, count: cached.data.length, source: 'cache-fallback' };
    }
    // No cache and no snapshot. If the cause is the read quota, say so — this
    // otherwise renders as a generic connection error, which points at the
    // network instead of at the actual problem and its actual fix.
    if (isReadQuotaError(error)) {
      return { success: false, error: READ_QUOTA_MESSAGE };
    }
    return { success: false, error: errorMessage(error) };
  }
}

// Get single asset by filename (CRUD - READ)
export async function getAssetByFilename(nama_file: string): Promise<ApiResponse<Asset>> {
  console.log('🔍 Fetching asset by filename:', nama_file);
  try {
    const doc = await findDocumentByFilename(nama_file);
    if (!doc) {
      return { success: false, error: 'Asset not found', message: `No asset found with filename: ${nama_file}` };
    }
    return { success: true, data: toAsset(doc) };
  } catch (error) {
    console.error('🚨 Failed to fetch asset:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// Create a single asset (CRUD - CREATE)
export async function createAsset(asset: AssetDraft): Promise<ApiResponse<Asset>> {
  console.log('➕ Creating asset with filename key:', asset.nama_file);
  try {
    const existing = await findDocumentByFilename(asset.nama_file);
    if (existing) {
      return { success: false, error: `Asset already exists: ${asset.nama_file}` };
    }

    // Not passing created_at/updated_at — Appwrite sets $createdAt/$updatedAt automatically.
    const doc = await databases.createDocument(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, ID.unique(), {
      nama_file: asset.nama_file,
      asset_name: asset.asset_name,
      url_lightroom: asset.url_lightroom,
      type: asset.type,
    });

    const createdAsset = toAsset(doc);
    await republishLibrary((assets) => [...assets, createdAsset]);
    return { success: true, data: createdAsset, message: 'Asset created successfully' };
  } catch (error) {
    console.error('🚨 Failed to create asset:', error);
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Update an asset by its document id. Costs ZERO database reads.
 *
 * `updateAsset` below takes a filename and has to look the document up first,
 * which is a read — so a one-word rename fails outright while the monthly read
 * quota is exhausted, and costs a read the rest of the time.
 *
 * Every asset in the published snapshot already carries its `id`, so any screen
 * showing an asset can update it without asking Appwrite who it is. Prefer this.
 *
 * Only the fields you pass are touched; omitted ones are left alone, so renaming
 * can't accidentally blank a link.
 */
export async function updateAssetById(
  id: string,
  patch: Partial<Pick<Asset, 'asset_name' | 'url_lightroom' | 'type'>>
): Promise<ApiResponse<Asset>> {
  if (!id) return { success: false, error: 'No asset id supplied.' };

  const fields: Record<string, string> = {};
  if (patch.asset_name !== undefined) fields.asset_name = patch.asset_name;
  if (patch.url_lightroom !== undefined) fields.url_lightroom = patch.url_lightroom;
  if (patch.type !== undefined) fields.type = patch.type;
  if (Object.keys(fields).length === 0) {
    return { success: false, error: 'Nothing to update.' };
  }

  try {
    const doc = await databases.updateDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_ASSETS_COLLECTION_ID,
      id,
      fields
    );
    const updated = toAsset(doc);
    // Republish so every other device sees the new name without reading the
    // database. Also what makes a rename show up under "Most Recent".
    await republishLibrary((assets) => assets.map((a) => (a.id === updated.id ? updated : a)));
    return { success: true, data: updated, message: 'Asset updated' };
  } catch (error) {
    console.error('🚨 Failed to update asset by id:', error);
    return {
      success: false,
      error: isReadQuotaError(error) ? READ_QUOTA_MESSAGE : errorMessage(error),
    };
  }
}

// Update asset by filename (CRUD - UPDATE)
export async function updateAsset(nama_file: string, asset: Omit<Asset, 'nama_file' | 'created_at' | 'updated_at'>): Promise<ApiResponse<Asset>> {
  console.log('📝 Updating asset by filename:', nama_file);
  try {
    const existing = await findDocumentByFilename(nama_file);
    if (!existing) {
      return { success: false, error: 'Asset not found', message: `No asset found with filename: ${nama_file}` };
    }

    // Not passing updated_at — Appwrite bumps $updatedAt automatically on every update.
    const doc = await databases.updateDocument(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, existing.$id, {
      asset_name: asset.asset_name,
      url_lightroom: asset.url_lightroom,
      type: asset.type,
    });

    const updatedAsset = toAsset(doc);
    await republishLibrary((assets) =>
      assets.map((a) => (a.id === updatedAsset.id ? updatedAsset : a))
    );
    return { success: true, data: updatedAsset, message: 'Asset updated successfully' };
  } catch (error) {
    console.error('🚨 Failed to update asset:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// Delete asset by filename (CRUD - DELETE)
export async function deleteAsset(nama_file: string): Promise<ApiResponse<Asset>> {
  console.log('🗑️ Deleting asset by filename:', nama_file);
  try {
    const existing = await findDocumentByFilename(nama_file);
    if (!existing) {
      return { success: false, error: 'Asset not found', message: `No asset found with filename: ${nama_file}` };
    }

    await databases.deleteDocument(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, existing.$id);
    const removedId = existing.$id;
    await republishLibrary((assets) => assets.filter((a) => a.id !== removedId));
    return { success: true, data: toAsset(existing), message: 'Asset deleted successfully' };
  } catch (error) {
    console.error('🚨 Failed to delete asset:', error);
    return { success: false, error: errorMessage(error) };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Bulk create assets (filename-based keys)
//
// Rewritten to avoid hammering Appwrite Cloud's rate limit: the old version made
// TWO API calls per row (a listDocuments duplicate-check + a createDocument), all
// fired back-to-back with no pacing — for a few thousand rows that's thousands of
// rapid sequential requests, which is what was causing imports to stall partway
// and throw "Failed to fetch" elsewhere in the app.
//
// This version fetches existing filenames ONCE up front (so re-running an import
// that partially succeeded skips already-created rows with zero extra API calls),
// then creates only the missing ones directly (skipping the redundant per-row
// duplicate check), with a small delay between requests to stay well under
// Appwrite's rate limit.
/**
 * Every `nama_file` currently in the database, as a Set for O(1) lookups.
 *
 * Used by the CSV Viewer to tell you which rows are genuinely new before you
 * import anything. Same pagination as getAllAssets(), but only keeps filenames
 * so a 5k-row library stays cheap to hold in memory.
 */
/**
 * filename → stored url_lightroom, for the CSV checker.
 *
 * Returns the link as well as the name so the pre-import review can distinguish
 * three cases rather than two: brand new, an unchanged duplicate, and a genuine
 * re-upload where the filename matches but Lightroom issued a new URL. Without
 * the link you can only tell "new" from "exists", which hides replacements.
 */
export async function getExistingAssetIndex(
  onProgress?: (fetched: number) => void
): Promise<ApiResponse<Map<string, string>>> {
  // Goes through getAllAssets rather than scanning the collection directly.
  //
  // This used to paginate all 4,486 rows every time you pressed "check", costing
  // 4,486 database reads — and then the import immediately did the same scan
  // again. Both now resolve from the published snapshot for zero reads.
  const res = await getAllAssets();
  if (!res.success || !res.data) {
    return { success: false, error: res.error || 'Failed to read existing assets' };
  }
  // Keyed by assetKey(), not by the raw filename, so `Halim.png` in the library
  // matches `halim.png` — or a bare `Halim` — in a CSV. See assetKey() for why
  // neither casing nor the extension carries meaning here, and why the STORED
  // filename is left alone.
  const index = new Map<string, string>();
  const variantDupes: string[] = [];
  res.data.forEach((a) => {
    if (!a.nama_file) return;
    const key = assetKey(a.nama_file);
    // Two rows differing only by case or extension means the library already
    // holds a variant duplicate, created back when comparisons were exact.
    // First wins deterministically rather than whichever happened to come last.
    if (index.has(key)) {
      variantDupes.push(a.nama_file);
      return;
    }
    index.set(key, a.url_lightroom ?? '');
  });
  if (variantDupes.length > 0) {
    console.warn(
      `\u26a0\ufe0f ${variantDupes.length} asset(s) differ from another only by capitalisation or file extension, so the library holds two rows for one artwork: ${variantDupes.slice(0, 10).join(', ')}${variantDupes.length > 10 ? '\u2026' : ''}`
    );
  }
  onProgress?.(index.size);
  return { success: true, data: index, count: index.size };
}

export async function bulkCreateAssets(
  assets: AssetDraft[],
  onProgress?: (done: number, total: number) => void,
  options?: {
    // When true, rows whose filename already exists in the database get their
    // `type` field updated to match the CSV instead of being skipped untouched.
    // Only `type` is touched — asset_name/url_lightroom on existing rows are
    // left alone. Off by default so re-running an import is always a no-op
    // for rows that already exist, unless you explicitly opt in.
    updateExistingType?: boolean;
    /**
     * When a row's filename already exists but the CSV carries a DIFFERENT
     * url_lightroom, overwrite the stored link.
     *
     * Lightroom mints a fresh URL on every upload, including re-uploads of the
     * same asset after a redesign. Matching on `nama_file` is what makes that
     * detectable — but before this existed, the link on an existing row was never
     * touched, so a redesigned asset kept pointing at the retired file forever.
     *
     * Defaults to TRUE, unlike updateExistingType: a changed link means the
     * underlying file changed, not just metadata, and silently keeping a dead
     * link is worse than a surprise update. Set false to review before applying.
     */
    updateExistingLink?: boolean;
    /**
     * Lets the caller pause / resume / cancel a long import without losing the
     * rows already written. Checked once per row, so a paused import stops at a
     * clean boundary rather than mid-write.
     */
    control?: {
      isPaused: () => boolean;
      isCancelled: () => boolean;
    };
    /** Fires whenever the loop parks on a pause, so the UI can say so. */
    onPausedChange?: (paused: boolean) => void;
  }
): Promise<ApiResponse<Asset[]>> {
  console.log(`📦 Bulk creating ${assets.length} assets with filename keys...`);
  const created: Asset[] = [];
  const errors: string[] = [];
  const seenFilenames = new Set<string>();
  const total = assets.length;

  // Fetch every existing nama_file → { id, url_lightroom } once, paginating like
  // getAllAssets() does. The $id lets us update in place without a per-row
  // lookup; the stored url_lightroom is what makes it possible to tell a genuine
  // re-upload (link changed) from an unchanged duplicate row.
  // This used to paginate the whole collection here, independently of the CSV
  // checker which had just done exactly the same scan seconds earlier. At 4,486
  // rows that was ~9,000 database reads per import — 1.8% of the monthly free
  // allowance spent before writing a single row, twice over, for no reason.
  //
  // Now it goes through getAllAssets(), which resolves from the published
  // snapshot or the local cache for zero database reads.
  const existingByFilename = new Map<string, { id: string; url_lightroom: string }>();
  const before = await getAllAssets();
  if (!before.success || !before.data) {
    return { success: false, error: `Failed to check existing assets before import: ${before.error ?? 'unknown error'}` };
  }
  const existingAssets = before.data;
  // Keyed by assetKey() so a re-upload spelled with different capitalisation, or
  // with the extension left off, updates the existing row instead of creating a
  // second one.
  existingAssets.forEach((a) => {
    const key = assetKey(a.nama_file);
    if (!existingByFilename.has(key)) {
      existingByFilename.set(key, { id: a.id, url_lightroom: a.url_lightroom });
    }
  });
  console.log(`📋 Found ${existingByFilename.size} assets already in the library (source: ${before.source}).`);

  const DELAY_MS = 80; // pace requests to stay under Appwrite Cloud's rate limit
  const updateLinks = options?.updateExistingLink !== false; // default on
  /**
   * Patches applied to existing rows, so the new snapshot can be assembled
   * locally instead of re-scanning the database afterwards. Every write here is
   * one we performed and know the outcome of, so replaying them over the
   * pre-import list reproduces the post-import state exactly.
   */
  const patches = new Map<string, Partial<Asset>>();
  let processed = 0;
  let updatedCount = 0;   // type-only updates
  let replacedCount = 0;  // url_lightroom overwritten (asset re-uploaded)
  let unchangedCount = 0; // matched an existing row and nothing needed doing
  onProgress?.(0, total);

  let cancelled = false;
  let announcedPause = false;

  for (const asset of assets) {
    // --- pause / cancel gate, evaluated once per row ---
    while (options?.control?.isPaused() && !options?.control?.isCancelled()) {
      if (!announcedPause) {
        announcedPause = true;
        options?.onPausedChange?.(true);
      }
      await sleep(250);
    }
    if (announcedPause) {
      announcedPause = false;
      options?.onPausedChange?.(false);
    }
    if (options?.control?.isCancelled()) {
      cancelled = true;
      break;
    }

    const filename = asset.nama_file?.trim();
    if (!filename || !asset.asset_name || !asset.url_lightroom || !asset.type) {
      errors.push(`Invalid asset data: ${filename || 'unknown'}`);
      processed++;
      onProgress?.(processed, total);
      continue;
    }
    // Blind to casing and the extension, so a CSV holding both `Halim.png` and
    // `halim.png` — or both `Halim.png` and `Halim` — is caught as the duplicate
    // it is instead of importing the artwork twice.
    const key = assetKey(filename);
    if (seenFilenames.has(key)) {
      errors.push(`Duplicate filename in batch: ${filename}`);
      processed++;
      onProgress?.(processed, total);
      continue;
    }
    seenFilenames.add(key);

    const existing = existingByFilename.get(key);
    if (existing) {
      // A different link for the same filename means the asset was re-uploaded
      // to Lightroom (redesigned, re-exported), because Lightroom issues a new
      // URL every time. Same link means this row is just a duplicate.
      const linkChanged =
        !!asset.url_lightroom && asset.url_lightroom !== existing.url_lightroom;
      const shouldReplaceLink = updateLinks && linkChanged;
      const shouldUpdateType = !!options?.updateExistingType;

      if (shouldReplaceLink || shouldUpdateType) {
        // One request carrying whichever fields apply, rather than two.
        const patch: Record<string, string> = {};
        if (shouldReplaceLink) patch.url_lightroom = asset.url_lightroom;
        if (shouldUpdateType) patch.type = asset.type;

        try {
          const doc: any = await databases.updateDocument(
            APPWRITE_DATABASE_ID,
            APPWRITE_ASSETS_COLLECTION_ID,
            existing.id,
            patch
          );
          // Counted separately: a replaced link is a different event from a
          // metadata tweak, and conflating them would hide re-uploads in the
          // summary. A row that got both is counted as a replacement, since
          // that's the more significant change.
          //
          // updated_at is carried through from the RESPONSE, not omitted and not
          // guessed from the local clock. Appwrite bumps $updatedAt server-side,
          // but the snapshot is rebuilt from the pre-import list plus these
          // patches — so leaving it out meant a relinked asset kept its old
          // timestamp in the published copy. "Most Recent" could then never
          // surface a re-upload, however the sort was written, until someone ran
          // an authoritative rebuild.
          patches.set(existing.id, {
            ...(patches.get(existing.id) ?? {}),
            ...patch,
            updated_at: doc?.$updatedAt || new Date().toISOString(),
          });
          if (shouldReplaceLink) {
            replacedCount++;
            // Keep the map current so a later duplicate row in the same CSV
            // isn't counted as a second replacement.
            existingByFilename.set(key, { id: existing.id, url_lightroom: asset.url_lightroom });
          } else {
            updatedCount++;
          }
        } catch (error) {
          errors.push(
            `Failed to update ${shouldReplaceLink ? 'link' : 'type'} for: ${filename} — ${errorMessage(error)}`
          );
        }
        await sleep(DELAY_MS);
      } else {
        unchangedCount++;
      }

      // Already exists — updated above or deliberately left alone. No create.
      processed++;
      onProgress?.(processed, total);
      continue;
    }

    try {
      // Not passing created_at/updated_at — Appwrite sets $createdAt/$updatedAt automatically.
      const doc = await databases.createDocument(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, ID.unique(), {
        nama_file: filename,
        asset_name: asset.asset_name,
        url_lightroom: asset.url_lightroom,
        type: asset.type,
      });
      created.push(toAsset(doc));
    } catch (error) {
      errors.push(`Failed to create: ${filename} — ${errorMessage(error)}`);
    }

    processed++;
    onProgress?.(processed, total);

    await sleep(DELAY_MS);
  }

  // A cancelled run is still a success for everything it managed to write —
  // reporting it as a failure would imply nothing landed, which is wrong.
  if (
    !cancelled &&
    created.length === 0 &&
    updatedCount === 0 &&
    replacedCount === 0 &&
    unchangedCount === 0
  ) {
    return { success: false, error: 'No valid assets found in the provided data', errors };
  }

  if (created.length > 0 || updatedCount > 0 || replacedCount > 0) {
    // Republish the library so every other device picks up the change without any
    // of them scanning the database.
    //
    // The new list is assembled from what we started with plus the writes we just
    // made, rather than re-reading the collection — that would cost another 4,486
    // reads and undo the point of the exercise. It's exact as long as nobody else
    // wrote concurrently, which for a single-superuser tool is the normal case.
    // "Rebuild from database" in Settings exists for when you want certainty.
    const nextLibrary = existingAssets
      .map((a) => (patches.has(a.id) ? { ...a, ...patches.get(a.id) } : a))
      .concat(created);

    const published = await publishSnapshot(nextLibrary);
    if (published.success) {
      console.log(`📤 Published snapshot: ${nextLibrary.length} assets, ${Math.round((published.sizeBytes ?? 0) / 1024)} KB.`);
      // Seed this device's cache from the same list, so the publisher doesn't
      // immediately re-download what it just uploaded.
      const info = await getSnapshotInfo();
      await writeCachedAssets(nextLibrary, {
        total: nextLibrary.length,
        latestUpdatedAt: new Date().toISOString(),
        syncedAt: Date.now(),
        snapshotVersion: info?.version,
      });
    } else {
      // Couldn't publish: fall back to invalidating, so the next load re-reads
      // from the database and is at least correct, if expensive.
      console.warn('Snapshot publish failed, falling back to cache invalidation:', published.error);
      invalidateAssetsCache();
    }
  }

  const plural = (n: number) => (n === 1 ? '' : 's');
  const messageParts = [`${created.length} new asset${plural(created.length)} created`];
  if (updatedCount > 0) {
    messageParts.push(`${updatedCount} existing asset${plural(updatedCount)} had their type updated`);
  }
  if (replacedCount > 0) {
    messageParts.push(
      `${replacedCount} asset${plural(replacedCount)} had their link replaced (re-uploaded in Lightroom)`
    );
  }
  if (unchangedCount > 0) {
    // Counted from rows actually present in this CSV.
    //
    // This used to be `existingByFilename.size - updatedCount`, i.e. the size of
    // the WHOLE database minus updates — so importing 10 new rows into a library
    // of 4,486 reported "4,486 already existed and were left unchanged". Wrong
    // by three orders of magnitude, and it made the summary untrustworthy.
    messageParts.push(`${unchangedCount} already existed and ${unchangedCount === 1 ? 'was' : 'were'} left unchanged`);
  }

  return {
    success: true,
    data: created,
    count: created.length,
    updatedCount,
    replacedCount,
    unchangedCount,
    errors: errors.length > 0 ? errors : undefined,
    message: messageParts.join(', '),
  };
}

// Hard reset: permanently delete every asset document in the table.
// Used by the Admin "Hard Reset Database" screen, which itself requires the
// admin password plus a typed confirmation phrase before calling this — this
// function does no confirmation of its own, it just does the deletion.
export async function deleteAllAssets(
  onProgress?: (done: number, total: number) => void
): Promise<ApiResponse<null>> {
  console.log('🧨 Hard reset requested — deleting ALL assets from Appwrite...');
  try {
    // Collect every document id first (paginated, same pattern as getAllAssets).
    const ids: string[] = [];
    let cursor: string | undefined;
    while (true) {
      const queries = [Query.limit(100)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, queries);
      res.documents.forEach((doc: any) => ids.push(doc.$id));
      if (res.documents.length < 100) break;
      cursor = res.documents[res.documents.length - 1].$id;
      await sleep(50);
    }

    const total = ids.length;
    let done = 0;
    const errors: string[] = [];
    onProgress?.(0, total);

    for (const id of ids) {
      try {
        await databases.deleteDocument(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, id);
      } catch (error) {
        errors.push(`Failed to delete ${id}: ${errorMessage(error)}`);
      }
      done++;
      onProgress?.(done, total);
      await sleep(80); // pace requests to stay under Appwrite Cloud's rate limit
    }

    // Everything's gone, so publish an empty library rather than invalidating and
    // making the next load scan a collection we just emptied.
    await publishSnapshot<Asset>([]);
    await writeCachedAssets<Asset>([], {
      total: 0,
      latestUpdatedAt: new Date().toISOString(),
      syncedAt: Date.now(),
      snapshotVersion: (await getSnapshotInfo())?.version,
    });
    setSyncState('synced', { total: 0, latestUpdatedAt: '', syncedAt: Date.now() });

    if (errors.length > 0 && done - errors.length === 0 && total > 0) {
      return { success: false, error: `Failed to delete any assets. ${errors[0]}`, errors };
    }

    return {
      success: true,
      message: `Deleted ${done - errors.length} of ${total} assets${errors.length > 0 ? ` (${errors.length} failed)` : ''}`,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error('🚨 Hard reset failed:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// Export assets to CSV
// Generated entirely client-side now, since there's no server-side function to build the file.
export async function exportAssetsToCSV(): Promise<{ success: boolean; error?: string; filename?: string }> {
  try {
    console.log('📤 Exporting assets to CSV...');

    const result = await getAllAssets();
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to load assets for export' };
    }

    const headers = ['nama_file', 'asset_name', 'url_lightroom', 'type', 'created_at', 'updated_at'];
    const escape = (value: string) => `"${(value || '').replace(/"/g, '""')}"`;
    const rows = result.data.map((asset) =>
      headers.map((h) => escape(String((asset as any)[h] ?? ''))).join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');

    const filename = `assets-export-${new Date().toISOString().slice(0, 10)}.csv`;
    const blob = new Blob([csvContent], { type: 'text/csv; charset=utf-8' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    console.log(`✅ CSV exported successfully: ${filename}`);
    return { success: true, filename };
  } catch (error) {
    console.error('🚨 Export CSV Failed:', error);
    return { success: false, error: errorMessage(error) };
  }
}

// Health check
export async function healthCheck(): Promise<ApiResponse<any>> {
  try {
    await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_ASSETS_COLLECTION_ID, [Query.limit(1)]);
    return { success: true, message: 'Asset management API is healthy', data: { timestamp: new Date().toISOString() } };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

// Search assets (client-side filtering for now)
/**
 * Search the library. See utils/search.ts for the semantics.
 *
 * This used to substring-match the whole query against each field, which meant
 * "train blue" never found `tds_ic_train_blue` — the underscore broke it. Every
 * multi-word search failed against this library's own naming convention.
 */
export function searchAssets(assets: Asset[], query: string): Asset[] {
  return searchAssetList(assets, query);
}

// Filter assets by category (client-side filtering)
export function filterAssetsByCategory(assets: Asset[], category: string): Asset[] {
  if (category === "All Assets") {
    return assets;
  }
  
  const categoryMap: Record<string, string[]> = {
    "Spot Illus": ["Spot"],
    "Micro Illustration": ["Micro"],
    "Icons": ["Icon"],
    "Supergraphic": ["Supergraphic"],
    "Other": ["Other"]
  };
  
  const allowedTypes = categoryMap[category];
  
  if (!allowedTypes) {
    return assets;
  }
  
  return assets.filter(asset => allowedTypes.includes(asset.type));
}

// Get asset counts for sidebar
export function getAssetCounts(assets: Asset[]): Record<string, number> {
  const counts = {
    "All Assets": assets.length,
    "Spot Illus": assets.filter(a => a.type === "Spot").length,
    "Micro Illustration": assets.filter(a => a.type === "Micro").length,
    "Icons": assets.filter(a => a.type === "Icon").length,
    "Supergraphic": assets.filter(a => a.type === "Supergraphic").length,
    "Other": assets.filter(a => a.type === "Other").length
  };
  
  return counts;
}

// Validate filename format
export function validateFilename(nama_file: string): { isValid: boolean; error?: string } {
  if (!nama_file || typeof nama_file !== 'string' || nama_file.trim() === '') {
    return { isValid: false, error: 'Filename is required' };
  }
  
  const trimmed = nama_file.trim();
  
  // Check for valid file extension
  if (!/\.(png|jpg|jpeg|svg)$/i.test(trimmed)) {
    return { isValid: false, error: 'Filename must have a valid image extension (.png, .jpg, .jpeg, .svg)' };
  }
  
  // Check for invalid characters (basic validation)
  if (/[\\/<>:"|?*]/.test(trimmed)) {
    return { isValid: false, error: 'Filename contains invalid characters' };
  }
  
  return { isValid: true };
}

// Extract asset type from filename prefix
export function extractTypeFromFilename(nama_file: string): string {
  if (nama_file.startsWith("tds_si_")) return "Spot";
  if (nama_file.startsWith("tds_mi_")) return "Micro";
  if (nama_file.startsWith("tds_ic_")) return "Icon";
  // Real exports use both bare ("sg_"/"ot_") and tds_-prefixed ("tds_sg_"/"tds_ot_")
  // forms for these two, so match either — mirrors csvParser.ts's generateTypeFromFilename.
  if (nama_file.startsWith("sg_") || nama_file.startsWith("tds_sg_")) return "Supergraphic";
  if (nama_file.startsWith("ot_") || nama_file.startsWith("tds_ot_")) return "Other";
  return "General";
}

// Generate asset name from filename
export function generateAssetNameFromFilename(nama_file: string): string {
  return nama_file
    .replace(/\.(png|jpg|jpeg|svg)$/i, '') // Remove file extension
    .replace(/^(tds_si_|tds_mi_|tds_ic_)/, '') // Remove prefixes
    .replace(/_/g, ' ') // Replace underscores with spaces
    .trim();
}

// --- Superuser password ---
//
// One superuser, one password, no accounts.
//
// The password itself is never stored. What's stored — in Appwrite Storage, as a
// tiny JSON file — is a salted PBKDF2-SHA256 credential. Changing the password
// rewrites that file, which is why a change applies immediately on every device
// with no rebuild.
//
// Resolution order:
//   1. Appwrite Storage        the real answer, shared by everyone
//   2. IndexedDB mirror        so an offline reload still unlocks
//   3. Compiled-in default     first-run fallback before any password is set
//
// This remains a soft gate. Hashing means nobody can read the password out of the
// app or Appwrite; it does not stop someone with devtools from setting the
// sessionStorage unlock flag by hand. See utils/authHash.ts.
import { DEFAULT_SUPERUSER_CREDENTIAL } from '../authConfig';
import { createCredential, verifyCredential } from './authHash';

const CREDENTIAL_LOCAL_KEY = 'superuser_credential';

/** Memoised per page load. Unlocking shouldn't re-fetch on every keystroke. */
let cachedCredential: string | null = null;

export type CredentialSource = 'appwrite' | 'local' | 'default';
let credentialSource: CredentialSource = 'default';

/** Where the credential currently in use came from. For the Settings screen. */
export function getCredentialSource(): CredentialSource {
  return credentialSource;
}

async function fetchStoredCredential(): Promise<string | null> {
  try {
    // no-store, because the URL is stable across updates and a cached copy would
    // keep accepting the previous password after a change.
    const url = storage.getFileView(APPWRITE_SETTINGS_BUCKET_ID, SUPERUSER_CREDENTIAL_FILE_ID).toString();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null; // 404 = nobody has set a password yet
    const body = await res.json();
    const encoded = typeof body?.credential === 'string' ? body.credential : null;
    if (!encoded) return null;
    // Mirror locally so an offline reload can still unlock.
    await localSettingSet(CREDENTIAL_LOCAL_KEY, encoded);
    return encoded;
  } catch {
    return null;
  }
}

async function resolveCredential(): Promise<string> {
  if (cachedCredential) return cachedCredential;

  const remote = await fetchStoredCredential();
  if (remote) {
    credentialSource = 'appwrite';
    cachedCredential = remote;
    return remote;
  }

  const local = await localSettingGet<string>(CREDENTIAL_LOCAL_KEY);
  if (local) {
    credentialSource = 'local';
    cachedCredential = local;
    return local;
  }

  credentialSource = 'default';
  cachedCredential = DEFAULT_SUPERUSER_CREDENTIAL;
  return DEFAULT_SUPERUSER_CREDENTIAL;
}

/** True when the typed password matches the credential in force. */
export async function verifyAdminPassword(input: string): Promise<boolean> {
  if (!input) return false; // an empty field must never unlock anything
  return verifyCredential(input, await resolveCredential());
}

/** Drop the memoised credential so the next check re-reads from Appwrite. */
export function invalidateCredentialCache() {
  cachedCredential = null;
}

/**
 * Change the password.
 *
 * Requires the current password — being unlocked isn't enough. Otherwise anyone
 * who wandered in behind an already-unlocked session could lock the owner out.
 *
 * Writes to Appwrite so the change is global. A local-only fallback is
 * deliberately NOT offered here: a password that changed on one laptop while
 * every other device kept accepting the old one is worse than a clear failure.
 */
export async function changeSuperuserPassword(
  currentPassword: string,
  newPassword: string
): Promise<ApiResponse<null>> {
  const current = await resolveCredential();
  if (!(await verifyCredential(currentPassword, current))) {
    return { success: false, error: 'That is not the current password.' };
  }
  if (await verifyCredential(newPassword, current)) {
    return { success: false, error: 'The new password is the same as the current one.' };
  }

  let encoded: string;
  try {
    encoded = await createCredential(newPassword);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }

  const payload = JSON.stringify({ v: 1, credential: encoded, updatedAt: new Date().toISOString() });
  const file = new File([payload], 'superuser_auth.json', { type: 'application/json' });

  try {
    try {
      await storage.deleteFile(APPWRITE_SETTINGS_BUCKET_ID, SUPERUSER_CREDENTIAL_FILE_ID);
    } catch (error) {
      if (!isMissingResource(error)) throw error;
    }
    await storage.createFile(APPWRITE_SETTINGS_BUCKET_ID, SUPERUSER_CREDENTIAL_FILE_ID, file);
  } catch (error) {
    return {
      success: false,
      error: isMissingResource(error)
        ? `Couldn't reach the Appwrite Storage bucket "${APPWRITE_SETTINGS_BUCKET_ID}". The password was NOT changed.`
        : `Appwrite rejected the change, so the password was NOT changed: ${errorMessage(error)}`,
    };
  }

  await localSettingSet(CREDENTIAL_LOCAL_KEY, encoded);
  cachedCredential = encoded;
  credentialSource = 'appwrite';
  return { success: true, message: 'Password changed. It applies on every device from now on.' };
}

// --- About-dialog image ---
//
// Stored as a FILE in an Appwrite Storage bucket, not as a database value.
//
// History worth keeping, because it caused a real bug: this used to write a
// base64 data URL into a document in the "settings" collection. When that
// collection's columns didn't match what the code wrote, every save was rejected
// and quietly fell back to IndexedDB — which is per-browser. The result was an
// image that looked saved but showed the placeholder in incognito and on every
// other device, with the UI still claiming saves were shared.
//
// A bucket avoids the whole class of problem: no attribute size ceiling, no
// schema to match, the file is served from Appwrite's CDN, and it's ~35% smaller
// than the base64 form. IndexedDB is still written, but only as a same-device
// render cache, never as the source of truth.
const ABOUT_IMAGE_LOCAL_KEY = 'about_image';

/** Where the saved image actually ended up, so the UI can tell the truth. */
export type SettingScope = 'appwrite' | 'local';

function isMissingResource(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = (error as any)?.code;
  return code === 404 || msg.includes('could not be found') || msg.includes('not found');
}

/**
 * Public URL for the stored file, cache-busted by the file's own updatedAt.
 *
 * Without the version parameter the browser and the CDN would keep serving the
 * previous image after a re-upload, since the URL is otherwise identical.
 */
function aboutImageUrl(updatedAt?: string): string {
  const base = storage.getFileView(APPWRITE_SETTINGS_BUCKET_ID, ABOUT_IMAGE_FILE_ID).toString();
  if (!updatedAt) return base;
  return `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(updatedAt)}`;
}

/**
 * Returns a URL when the shared image exists, otherwise the local data URL,
 * otherwise null so the caller shows the placeholder.
 */
export async function getAboutImage(): Promise<string | null> {
  try {
    const file = await storage.getFile(APPWRITE_SETTINGS_BUCKET_ID, ABOUT_IMAGE_FILE_ID);
    return aboutImageUrl((file as any).$updatedAt);
  } catch {
    // No bucket, or no file in it yet — fall through to whatever this device has.
  }
  return localSettingGet<string>(ABOUT_IMAGE_LOCAL_KEY);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(header)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function setAboutImage(dataUrl: string): Promise<ApiResponse<null> & { scope?: SettingScope }> {
  // Always keep a local copy for instant rendering, whatever happens next.
  await localSettingSet(ABOUT_IMAGE_LOCAL_KEY, dataUrl);

  try {
    const blob = dataUrlToBlob(dataUrl);
    const file = new File([blob], 'about_image.jpg', { type: blob.type });

    // Appwrite file IDs are immutable, so "replace" means delete-then-create.
    // A missing file on delete is the normal first-run case, not an error.
    try {
      await storage.deleteFile(APPWRITE_SETTINGS_BUCKET_ID, ABOUT_IMAGE_FILE_ID);
    } catch (error) {
      if (!isMissingResource(error)) throw error;
    }

    await storage.createFile(APPWRITE_SETTINGS_BUCKET_ID, ABOUT_IMAGE_FILE_ID, file);
    return {
      success: true,
      scope: 'appwrite',
      message: 'Saved to Appwrite Storage — everyone sees this image, on every device.',
    };
  } catch (error) {
    return {
      success: true,
      scope: 'local',
      message: isMissingResource(error)
        ? `Saved on this device only — the Appwrite Storage bucket "${APPWRITE_SETTINGS_BUCKET_ID}" doesn't exist yet, so it can't be shared.`
        : `Saved on this device only — Appwrite Storage rejected the upload: ${errorMessage(error)}`,
    };
  }
}

export async function clearAboutImage(): Promise<ApiResponse<null>> {
  let sharedRemoved = false;
  try {
    await storage.deleteFile(APPWRITE_SETTINGS_BUCKET_ID, ABOUT_IMAGE_FILE_ID);
    sharedRemoved = true;
  } catch {
    // Nothing shared to remove, or no bucket. Either way the local reset below
    // is what the person in front of the screen actually asked for.
  }
  await localSettingDelete(ABOUT_IMAGE_LOCAL_KEY);
  return {
    success: true,
    message: sharedRemoved
      ? 'Reverted to the placeholder everywhere.'
      : 'Reverted to the placeholder on this device.',
  };
}

/**
 * Can we actually write a shared image?
 *
 * The previous version of this check called listDocuments and returned true if
 * the collection merely existed — which is why the UI cheerfully reported
 * "shared across devices" while every single write was being rejected. Listing
 * files exercises the same bucket and the same read permission the app depends
 * on, so a true here means considerably more than it used to.
 */
export async function checkSharedImageStorage(): Promise<boolean> {
  try {
    await storage.listFiles(APPWRITE_SETTINGS_BUCKET_ID, [Query.limit(1)]);
    return true;
  } catch {
    return false;
  }
}

// setAdminPassword() used to write the new password into Appwrite. It's gone on
// purpose: the digest is compiled into the bundle, so nothing written at runtime
// could change it. Keeping a function that reported "Password updated" while the
// old password still worked would be worse than not having one. The Settings
// screen now generates a digest for you to paste in and rebuild instead.