import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Asset, getAllAssets, getAssetCounts } from '../utils/appwriteApi';
import { assetKey } from '../utils/assetNaming';
import { AlertTriangle, Layers, Package, Palette, RefreshCw, Image as ImageIcon, Sparkles } from "./icons";

/**
 * The five categories, matching the dashboard sidebar exactly.
 *
 * The `type` value here is the raw string stored in Appwrite. This screen used to
 * read `asset.category` — a field that does not exist on Asset — so every asset
 * fell through to the `default` branch and the library reported 100% "Other"
 * regardless of what was actually in the database.
 *
 * The fix isn't just renaming the field: counting now goes through
 * getAssetCounts(), the same function that feeds the sidebar. Two independent
 * implementations of "how many Icons are there" is what allowed them to disagree
 * in the first place.
 */
const CATEGORIES = [
  { key: 'Spot Illus', type: 'Spot', icon: Palette, color: '#f59e0b' },
  { key: 'Micro Illustration', type: 'Micro', icon: Sparkles, color: 'var(--pp-brand-blue)' },
  { key: 'Icons', type: 'Icon', icon: Layers, color: '#8b5cf6' },
  { key: 'Supergraphic', type: 'Supergraphic', icon: ImageIcon, color: '#06b6d4' },
  { key: 'Other', type: 'Other', icon: Package, color: '#6b7280' },
] as const;

/** Every type the app knows how to categorise. */
const KNOWN_TYPES = new Set<string>([...CATEGORIES.map((c) => c.type), 'General']);

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

/**
 * All of the arithmetic, as a pure function.
 *
 * Kept out of the component so it can be tested against a known fixture without
 * a DOM or a network round-trip. The previous version buried the counting inside
 * a `useEffect`, which is part of why a bug that put 100% of the library in one
 * category went unnoticed — there was nothing to assert against.
 */
export function computeAnalytics(assets: Asset[]) {
  const counts = getAssetCounts(assets);
  const total = assets.length;

  const rows = CATEGORIES.map((c) => ({
    ...c,
    count: counts[c.key] ?? 0,
    share: total > 0 ? ((counts[c.key] ?? 0) / total) * 100 : 0,
  }));

  // Anything whose `type` isn't one of the five. These are invisible in the
  // dashboard — they belong to no category, so no sidebar entry lists them —
  // which makes them worth surfacing loudly here.
  const unrecognised = new Map<string, number>();
  let missingType = 0;
  assets.forEach((a) => {
    const type = a.type?.trim();
    if (!type) {
      missingType++;
      return;
    }
    if (!KNOWN_TYPES.has(type)) {
      unrecognised.set(type, (unrecognised.get(type) ?? 0) + 1);
    }
  });

  // Data-hygiene checks that matter for a library fed by CSV imports.
  const missingLink = assets.filter((a) => !a.url_lightroom?.trim()).length;
  // Duplicates are counted on assetKey(), so casing and the extension are
  // ignored.
  //
  // Comparing exactly meant `Halim.png` and `halim.png` — or `Halim.png` and
  // `Halim` — were reported as two healthy assets, which is precisely the pair
  // this panel exists to surface, since the import that created them thought
  // they were unrelated too.
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  assets.forEach((a) => {
    const key = assetKey(a.nama_file);
    if (!key) return;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  });

  const timestamps = assets
    .map((a) => (a.updated_at ? Date.parse(a.updated_at) : NaN))
    .filter((t) => !Number.isNaN(t));
  const lastChange = timestamps.length > 0 ? Math.max(...timestamps) : null;

  const createdTimes = assets
    .map((a) => (a.created_at ? Date.parse(a.created_at) : NaN))
    .filter((t) => !Number.isNaN(t));
  const added7 = createdTimes.filter((t) => t >= daysAgo(7)).length;
  const added30 = createdTimes.filter((t) => t >= daysAgo(30)).length;

  const populated = rows.filter((r) => r.count > 0);
  const largest = [...rows].sort((a, b) => b.count - a.count)[0];

  // Assets counted by no category at all. When this equals `total` you are
  // looking at the failure mode this screen used to have.
  const categorisedTotal = rows.reduce((sum, r) => sum + r.count, 0);
  const uncategorised = total - categorisedTotal;

  return {
    total, rows, unrecognised, missingType, missingLink,
    duplicateCount: duplicates.size, lastChange, added7, added30,
    populatedCount: populated.length, largest, uncategorised,
  };
}

export function Analytics() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getAllAssets();
      if (!response.success) {
        setError(response.error || 'Could not load assets.');
        setAssets([]);
        return;
      }
      setAssets(response.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load assets.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  const stats = useMemo(() => computeAnalytics(assets), [assets]);

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <RefreshCw className="mx-auto mb-4 h-8 w-8 animate-spin text-[var(--pp-brand-blue)]" />
            <p className="text-muted-foreground">Loading analytics…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={loadAnalytics}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Headline numbers */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <p className="mb-1 text-sm text-muted-foreground">Total assets</p>
              <p className="text-3xl font-bold text-foreground">{formatNumber(stats.total)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="mb-1 text-sm text-muted-foreground">Added in the last 30 days</p>
              <p className="text-3xl font-bold text-foreground">{formatNumber(stats.added30)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNumber(stats.added7)} in the last 7
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="mb-1 text-sm text-muted-foreground">Last change</p>
              <p className="text-3xl font-bold text-foreground">
                {stats.lastChange
                  ? new Date(stats.lastChange).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {stats.populatedCount} of {CATEGORIES.length} categories in use
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Anything uncategorised is a data problem, not a statistic — say so
            rather than burying it inside "Other". */}
        {(stats.unrecognised.size > 0 || stats.missingType > 0) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="space-y-2 text-sm">
              <p className="font-bold">
                {formatNumber(stats.uncategorised)} asset
                {stats.uncategorised === 1 ? '' : 's'} don't belong to any category
              </p>
              <p className="text-muted-foreground">
                These won't appear under any sidebar section, so nobody will find them by browsing.
                Fix the <code>type</code> value in a CSV and re-import to sort them.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {stats.missingType > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    (blank) × {formatNumber(stats.missingType)}
                  </Badge>
                )}
                {[...stats.unrecognised.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 12)
                  .map(([type, count]) => (
                    <Badge key={type} variant="secondary" className="text-xs">
                      <code>{type}</code> × {formatNumber(count)}
                    </Badge>
                  ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Categories */}
        <div>
          <h2 className="mb-4 text-xl font-bold text-foreground">Asset categories</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {stats.rows.map(({ key, count, share, icon: Icon, color }) => (
              <Card key={key}>
                <CardContent className="p-5 text-center">
                  <div
                    className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[8px]"
                    style={{ backgroundColor: `${String(color).startsWith('#') ? color + '20' : 'var(--pp-bg-blue-low)'}` }}
                  >
                    <Icon className="h-6 w-6" style={{ color }} />
                  </div>
                  <h3 className="mb-1 truncate text-sm font-medium text-foreground" title={key}>
                    {key}
                  </h3>
                  <p className="text-2xl font-bold" style={{ color }}>
                    {formatNumber(count)}
                  </p>
                  <p className="text-xs text-muted-foreground">{share.toFixed(1)}%</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Distribution — full-width bars, sorted, so the shape is readable at
              a glance. The old version used an 80px-wide track for every row,
              which made 0.1% and 40% look nearly identical. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">Distribution</CardTitle>
              <CardDescription>Share of the library by category, largest first.</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.total === 0 ? (
                <p className="text-sm text-muted-foreground">No assets yet.</p>
              ) : (
                <div className="space-y-3">
                  {[...stats.rows]
                    .sort((a, b) => b.count - a.count)
                    .map(({ key, count, share, color }) => (
                      <div key={key} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate font-medium text-foreground">{key}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatNumber(count)} · {share.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${share}%`,
                              backgroundColor: String(color),
                              // A category with assets should never render as an
                              // invisible sliver — 3 of 4,486 is 0.07%.
                              minWidth: count > 0 ? '2px' : '0',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data health. Replaces "Empty Categories: 3" / "Categories with
              Assets: 1", which were derivable from the cards above and told you
              nothing you could act on. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">Data health</CardTitle>
              <CardDescription>Things worth fixing before the next import.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">Largest category</span>
                  <span className="text-muted-foreground">
                    {stats.largest && stats.largest.count > 0
                      ? `${stats.largest.key} · ${stats.largest.share.toFixed(1)}%`
                      : '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">Uncategorised</span>
                  <span
                    className={
                      stats.uncategorised > 0
                        ? 'font-semibold text-[var(--pp-text-alert)]'
                        : 'text-muted-foreground'
                    }
                  >
                    {formatNumber(stats.uncategorised)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">Missing Lightroom link</span>
                  <span
                    className={
                      stats.missingLink > 0
                        ? 'font-semibold text-[var(--pp-text-alert)]'
                        : 'text-muted-foreground'
                    }
                  >
                    {formatNumber(stats.missingLink)}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">
                    Duplicate filenames
                    <span className="block text-xs font-normal text-muted-foreground">
                      Same nama_file stored more than once
                    </span>
                  </span>
                  <span
                    className={
                      stats.duplicateCount > 0
                        ? 'font-semibold text-[var(--pp-text-alert)]'
                        : 'text-muted-foreground'
                    }
                  >
                    {formatNumber(stats.duplicateCount)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <span className="font-medium text-foreground">Distinct types stored</span>
                  <span className="text-muted-foreground">
                    {stats.populatedCount + stats.unrecognised.size}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-4 pt-2">
          <p className="text-xs text-muted-foreground">
            Counted from the same data the dashboard uses, so these figures always match the
            sidebar.
          </p>
          <Button variant="outline" size="sm" onClick={loadAnalytics}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
