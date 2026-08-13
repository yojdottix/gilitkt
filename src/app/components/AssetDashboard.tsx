import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { AlertCircle, RefreshCw, X } from "./icons";
import { ArrowNarrowLeft } from "./icons/ArrowNarrowLeft";
import { SearchLg } from "./icons/figma";
import { AboutModal } from "./AboutModal";
import { SharedSidebar } from "./SharedSidebar";
import { AssetGrid, type PageInfo, type SortOption } from "./AssetGrid";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetTypeControl, PaginationControl, SortControl, ViewControl } from "./HeaderControls";
import { SuperuserLoginModal } from "./SuperuserLoginModal";
import { IslandManager } from "./islands/IslandManager";
import { HarborBrowser } from "./islands/HarborBrowser";
import { HARBOR_KEY, ISLANDS_KEY, ISLAND_STORAGE_KEY, type Island } from "./islands/types";
import { fetchHarborIslands, type HarborIsland } from "../utils/harbor";
import { getAllAssets, getAssetCounts, Asset } from "../utils/appwriteApi";
import { activeTags, toggleTagInQuery } from "../utils/search";
import { useSuperuser } from "../context/SuperuserContext";
interface AssetDashboardProps {
  onNavigateToAssetManagement: () => void;
}

/**
 * Header titles for each sidebar key.
 *
 * Deliberately not the sidebar's own labels: the design writes "All" in the
 * nav, where the column is 240px wide and the context is obvious, but "All
 * Assets" as the page heading.
 */
const CATEGORY_TITLES: Record<string, string> = {
  "All Assets": "All Assets",
  "Spot Illus": "Spot Illustration",
  "Micro Illustration": "Micro Illustration",
  Icons: "Icons",
  Supergraphic: "Supergraphic",
  Other: "Other",
  [ISLANDS_KEY]: "Island",
  [HARBOR_KEY]: "Harbor",
};

export function AssetDashboard({ onNavigateToAssetManagement }: AssetDashboardProps) {
  const { unlocked } = useSuperuser();

  // Navigation
  const [selectedCategory, setSelectedCategory] = useState("All Assets");
  const [selectedIsland, setSelectedIsland] = useState<Island | null>(null);

  // Search. The input stays bound to searchQuery for instant typing feedback;
  // filtering (over a potentially thousands-strong list) only reacts to the
  // debounced value, so typing doesn't re-filter on every keystroke.
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  // View controls
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [gridColumns, setGridColumns] = useState(5);
  /*
   * Asset types switched on in the header chip.
   *
   * Offered on All Assets and inside an island — the two views that hold a mix
   * of types. The per-type categories in the sidebar are already a single type,
   * so a second type filter there could only ever empty the page.
   */
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ page: 1, totalPages: 1, total: 0 });

  // Data
  const [assets, setAssets] = useState<Asset[]>([]);
  const [islands, setIslands] = useState<Island[]>([]);
  const [harbor, setHarbor] = useState<HarborIsland[]>([]);
  const [harborLoading, setHarborLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState("loading");

  // Overlays
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  // Brief "done!" confirmation after the initial load, before the grid appears.
  const [justFinishedLoading, setJustFinishedLoading] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const isIslandList = selectedCategory === ISLANDS_KEY && !selectedIsland;
  const isHarborList = selectedCategory === HARBOR_KEY && !selectedIsland;
  /*
   * Opening a harbor island reuses selectedIsland: a harbor island is the same
   * shape as a personal one, so the detail view — heading, back arrow, grid,
   * search, type filter — is the same view over a different member list. What
   * differs is only who may edit the collection, and nothing in the detail view
   * edits it.
   */
  const isIslandDetail = Boolean(selectedIsland);
  const isHarborDetail = selectedCategory === HARBOR_KEY && isIslandDetail;
  const isCollectionList = isIslandList || isHarborList;
  const showTypeFilter = selectedCategory === "All Assets" || isIslandDetail;

  const loadAssets = useCallback(async (showLoading = true, forceRefresh = false) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      // Serves from a long-lived local cache by default so reopening the app is
      // instant; forceRefresh bypasses it when the user explicitly asks.
      const response = await getAllAssets({ forceRefresh });
      if (!response.success) throw new Error(response.error || "Failed to load assets");

      setAssets(response.data || []);
      setDataSource(response.source || "database");
    } catch (err) {
      console.error("🚨 Error loading assets:", err);
      setError(err instanceof Error ? err.message : "Failed to load assets");
      setAssets([]);
      setDataSource("offline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    const saved = localStorage.getItem(ISLAND_STORAGE_KEY);
    if (!saved) return;
    try {
      setIslands(JSON.parse(saved));
    } catch (err) {
      console.error("Error loading islands:", err);
    }
  }, []);

  // Published collections, read straight from Storage on load. A few kilobytes,
  // and zero database reads — see harbor.ts.
  useEffect(() => {
    let alive = true;
    fetchHarborIslands()
      .then((next) => {
        if (alive) setHarbor(next);
      })
      .finally(() => {
        if (alive) setHarborLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (loading || hasLoadedOnceRef.current) return;
    hasLoadedOnceRef.current = true;
    setJustFinishedLoading(true);
    const timer = setTimeout(() => setJustFinishedLoading(false), 700);
    return () => clearTimeout(timer);
  }, [loading]);

  // Refresh when the tab becomes visible again.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) loadAssets(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadAssets]);

  // Back to page 1 whenever the basis of the list changes — otherwise you can
  // land on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [selectedCategory, debouncedSearchQuery, sortBy, selectedIsland, selectedTypes]);

  const assetCounts = useMemo(() => {
    const counts = getAssetCounts(assets);
    counts[ISLANDS_KEY] = islands.length;
    counts[HARBOR_KEY] = harbor.length;
    return counts;
  }, [assets, islands, harbor]);

  const handleUpdateIslands = useCallback(
    (next: Island[]) => {
      setIslands(next);
      localStorage.setItem(ISLAND_STORAGE_KEY, JSON.stringify(next));
      // Keep the open island in step with the edit, and drop it if deleted.
      setSelectedIsland((current) => {
        if (!current) return null;
        // Unless what's open is a harbor island, which isn't in this list at
        // all: looking it up here would close the collection every time someone
        // used a card's + button while browsing one.
        if (isHarborDetail) return current;
        return next.find((i) => i.id === current.id) ?? null;
      });
    },
    [isHarborDetail]
  );

  const handleTagClick = useCallback((tag: string) => {
    /*
     * Toggle a tag chip.
     *
     * This adds or removes a `#tag` token rather than replacing the whole query,
     * so chips accumulate, anything typed is left alone, and the search box stays
     * the single source of truth for what's being filtered.
     *
     * Applied immediately rather than through the debounce: a click is a discrete
     * action, and waiting 250ms to light the chip up feels broken.
     */
    setSearchQuery((current) => {
      const next = toggleTagInQuery(current, tag);
      setDebouncedSearchQuery(next);
      return next;
    });
  }, []);

  // Derived from the query, never stored separately — so the chips and the
  // search box cannot disagree, including when the query is edited by hand.
  const currentActiveTags = activeTags(debouncedSearchQuery);

  const handleCategoryClick = (categoryKey: string) => {
    setSelectedCategory(categoryKey);
    setSelectedIsland(null);
    setSelectedAsset(null);
    // The chip is hidden on the per-type categories, so a selection carried over
    // from All Assets would keep filtering from somewhere the user can't see it.
    setSelectedTypes([]);
  };

  const handleSelectIsland = (island: Island | null) => {
    setSelectedIsland(island);
  };

  const islandAssets = useMemo(() => {
    if (!selectedIsland) return assets;
    const wanted = new Set(selectedIsland.asset_ids);
    return assets.filter((a) => wanted.has(a.nama_file));
  }, [assets, selectedIsland]);

  const title = selectedIsland ? selectedIsland.name : CATEGORY_TITLES[selectedCategory] ?? selectedCategory;

  // The design sets the count as a small superscript beside the heading rather
  // than a subtitle line, so this is a bare number, not a sentence.
  const countLabel = (() => {
    if (selectedIsland) {
      // The island detail spells the unit out — "544 assets" — where the
      // library headers show a bare figure.
      const n = selectedIsland.asset_ids.length;
      return `${n.toLocaleString()} ${n === 1 ? "asset" : "assets"}`;
    }
    if (isIslandList) return islands.length.toLocaleString();
    if (isHarborList) return harbor.length.toLocaleString();
    return pageInfo.total.toLocaleString();
  })();

  return (
    <SidebarProvider defaultOpen>
      {/*
        The page itself is the sunken surface; the content sits on it as a
        floating white panel with the sidebar alongside on the bare background.
        Note the panel is padded on three sides only — the design butts it
        straight up against the sidebar, with no gap on the left.
      */}
      <div className="flex h-screen w-full bg-[var(--pp-bg-sunken)]">
        <SharedSidebar
          onNavigateToAssetManagement={onNavigateToAssetManagement}
          onCategoryClick={handleCategoryClick}
          selectedCategory={selectedCategory}
          assetCounts={assetCounts}
          assets={assets}
          loading={loading}
          error={error}
          dataSource={dataSource}
          handleRefresh={() => loadAssets(true, true)}
          onRequestSuperuserLogin={() => setIsLoginOpen(true)}
          onOpenAbout={() => setIsAboutOpen(true)}
        />

        <div className="flex min-w-0 flex-1 flex-col py-3 pr-3 [filter:drop-shadow(var(--gili-panel-shadow))]">
          <div className="flex min-h-px flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
            <header className="flex w-full shrink-0 flex-col gap-4 px-6 pb-4 pt-6">
              <div className="flex items-start gap-1">
                {/* Only reachable control for the off-canvas sidebar on mobile. */}
                <SidebarTrigger className="mr-1 size-9 shrink-0 lg:hidden" />

                {/* 10px to the title, per the design. A bare button rather than
                    a ghost Button: the design draws the glyph alone on the
                    header, with no padding box or hover plate around it. */}
                {selectedIsland && (
                  <button
                    type="button"
                    onClick={() => setSelectedIsland(null)}
                    className="mr-[10px] mt-0.5 shrink-0 text-[var(--pp-text-high)] transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ArrowNarrowLeft className="size-5" />
                    <span className="sr-only">
                      {isHarborDetail ? "Back to Harbor" : "Back to islands"}
                    </span>
                  </button>
                )}

                {/* pp-h3 rather than literal sizes: it is the foundation's
                    Heading 3 (24/26 bold), and it steps down to 18/24 on
                    mobile the way the ramp specifies. */}
                <h1 className="pp-h3 min-w-0 truncate text-foreground">{title}</h1>
                {/* Sits on the heading's baseline-top as a superscript count. */}
                <span className="shrink-0 whitespace-nowrap text-sm leading-[1.43] text-foreground">
                  {countLabel}
                </span>
              </div>

              <div className="flex h-[42px] w-full items-center gap-2 rounded-lg border border-border bg-[var(--gili-search-surface)] px-3">
                {/* N400, the same tone as the placeholder — the design reads the
                    magnifier as part of the empty state, not as a control. */}
                <SearchLg className="size-5 shrink-0 text-[var(--pp-icon-low)]" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={'Search assets, try "tds_ic_flights" or "train blue"'}
                  aria-label="Search assets"
                  className="min-w-0 flex-1 bg-transparent text-base leading-[1.38] text-foreground outline-none placeholder:text-[var(--pp-text-disabled)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setDebouncedSearchQuery("");
                    }}
                    title="Clear search"
                    aria-label="Clear search"
                    className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* A list of collections has nothing to sort, page, or set density on. */}
              {!isCollectionList && (
                <div className="flex w-full items-center justify-between gap-4">
                  {/* Scrolls rather than wraps or squashes. Three chips plus the
                      page range do not fit a phone, and the row is a single line
                      in the design — so on a narrow screen the chips slide under
                      the pager instead of colliding with it. */}
                  <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                    <ViewControl
                      viewMode={viewMode}
                      onViewModeChange={setViewMode}
                      gridColumns={gridColumns}
                      onGridColumnsChange={setGridColumns}
                    />
                    <SortControl sortBy={sortBy} onSortChange={setSortBy} />
                    {showTypeFilter && (
                      <AssetTypeControl selected={selectedTypes} onChange={setSelectedTypes} />
                    )}
                  </div>
                  {/* Desktop only, and always was: below lg the grid portals its
                      own pager to the bottom of the viewport, so this one was a
                      second copy of the same control. Dropping it here is what
                      leaves room for a third chip on a phone. */}
                  <div className="hidden shrink-0 lg:block">
                    <PaginationControl
                      page={pageInfo.page}
                      totalPages={pageInfo.totalPages}
                      total={pageInfo.total}
                      onPageChange={setPage}
                    />
                  </div>
                </div>
              )}
            </header>

            <div className="h-px w-full shrink-0 bg-[var(--pp-stroke-disabled)]" />

            <main className="min-h-px flex-1 overflow-auto p-6">
              {error && (
                <Alert className="mb-6 border-[var(--pp-stroke-alert)] bg-[var(--pp-bg-red-low)]">
                  <AlertCircle className="size-4 text-[var(--pp-icon-alert)]" />
                  <AlertDescription className="text-[var(--pp-text-alert)]">
                    <div className="mb-1 font-bold">Connection Error</div>
                    <div>{error}</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => loadAssets(true, true)}
                      className="mt-2 h-8"
                    >
                      <RefreshCw className="mr-1 size-4" />
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {isHarborList ? (
                <HarborBrowser
                  assets={assets}
                  islands={harbor}
                  loading={harborLoading || (loading && assets.length === 0)}
                  onSelectIsland={handleSelectIsland}
                />
              ) : isIslandList ? (
                <IslandManager
                  assets={assets}
                  islands={islands}
                  onUpdateIslands={handleUpdateIslands}
                  onSelectIsland={handleSelectIsland}
                  selectedIsland={selectedIsland}
                />
              ) : (
                <AssetGrid
                  category={isIslandDetail ? "Island" : selectedCategory}
                  searchQuery={debouncedSearchQuery}
                  viewMode={viewMode}
                  sortBy={sortBy}
                  loading={loading}
                  justFinishedLoading={justFinishedLoading}
                  assets={isIslandDetail ? islandAssets : assets}
                  selectedAsset={selectedAsset}
                  onSelectAsset={setSelectedAsset}
                  onTagClick={handleTagClick}
                  activeTags={currentActiveTags}
                  types={showTypeFilter ? selectedTypes : []}
                  islands={islands}
                  onUpdateIslands={handleUpdateIslands}
                  onNavigateToAllAssets={() => handleCategoryClick("All Assets")}
                  gridColumns={gridColumns}
                  page={page}
                  onPageChange={setPage}
                  onPageInfoChange={setPageInfo}
                />
              )}
            </main>
          </div>
        </div>

        <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />

        <SuperuserLoginModal
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          onUnlocked={onNavigateToAssetManagement}
        />

        {selectedAsset && (
          <AssetDetailPanel
            asset={selectedAsset}
            isOpen
            onClose={() => setSelectedAsset(null)}
            onTagClick={handleTagClick}
            activeTags={currentActiveTags}
            islands={islands}
            onUpdateIslands={handleUpdateIslands}
            onManageAsset={unlocked ? onNavigateToAssetManagement : undefined}
          />
        )}
      </div>
    </SidebarProvider>
  );
}
