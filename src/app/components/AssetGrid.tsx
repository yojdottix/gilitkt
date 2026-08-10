import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { AssetCard } from "./AssetCard";
import { filterAssetsByCategory, searchAssets, Asset } from "../utils/appwriteApi";
import { lastTouchedAt } from "../utils/assetNaming";
import { Button } from "./ui/button";
import { type Island } from "./islands/types";
import { Loader2, CheckCircle2, ChevronLeft, ChevronRight } from "./icons";
import { getAssetTypeLabel } from "./constants/projectConstants";

export type SortOption = "recent" | "alphabetical" | "type";

// 50, not 100. At 100 the grid ran ~6300px tall at default density — seven
// screens of scrolling before the pager. 50 halves that, and with the header
// pager the extra page count costs nothing.
export const PAGE_SIZE = 50;

export interface PageInfo {
  page: number;
  totalPages: number;
  total: number;
}

interface AssetGridProps {
  category: string;
  searchQuery: string;
  viewMode: "grid" | "list";
  assets: Asset[];
  selectedAsset?: Asset | null;
  onSelectAsset?: (asset: Asset) => void;
  onTagClick?: (tag: string) => void;
  /** Lowercased tags currently switched on, forwarded to every card. */
  activeTags?: string[];
  islands?: Island[];
  onUpdateIslands?: (islands: Island[]) => void;
  onNavigateToAllAssets?: () => void;
  gridColumns?: number;
  sortBy?: SortOption;
  /** Still fetching — show a loading state rather than "No assets". */
  loading?: boolean;
  /** Brief "done!" checkmark right after loading completes. */
  justFinishedLoading?: boolean;
  /*
   * Pagination is controlled by the dashboard because the design puts the pager
   * in the sticky header, above this component. The grid still owns the slicing
   * — it is the only thing that knows how many rows survived filtering — and
   * reports the result back through onPageInfoChange.
   */
  page: number;
  onPageChange: (page: number) => void;
  onPageInfoChange?: (info: PageInfo) => void;
}

export function AssetGrid({
  category,
  searchQuery,
  viewMode,
  assets,
  selectedAsset,
  onSelectAsset,
  onTagClick,
  activeTags = [],
  islands = [],
  onUpdateIslands,
  onNavigateToAllAssets,
  gridColumns = 5,
  sortBy = "recent",
  loading = false,
  justFinishedLoading = false,
  page,
  onPageChange,
  onPageInfoChange,
}: AssetGridProps) {
  const gridTopRef = useRef<HTMLDivElement>(null);

  // Memoized so this (potentially thousands-of-rows) computation only reruns
  // when something it actually depends on changes — not on every render, e.g.
  // hovering a card or opening a popover elsewhere on the page.
  const filteredAssets = useMemo(() => {
    let filtered = assets;
    if (searchQuery) filtered = searchAssets(filtered, searchQuery);
    if (category !== "Island") filtered = filterAssetsByCategory(filtered, category);

    return [...filtered].sort((a, b) => {
      if (sortBy === "alphabetical") {
        return (a.asset_name || a.nama_file).localeCompare(b.asset_name || b.nama_file);
      }
      if (sortBy === "type") {
        const byType = (a.type || "").localeCompare(b.type || "");
        return byType !== 0
          ? byType
          : (a.asset_name || a.nama_file).localeCompare(b.asset_name || b.nama_file);
      }
      // "recent" (default): most recently touched first.
      //
      // Deliberately last-TOUCHED, not last-created. An asset re-uploaded to
      // Lightroom and relinked has new artwork but an old created_at, so
      // sorting on creation alone hid exactly the changes people most want to
      // see. See lastTouchedAt().
      return lastTouchedAt(b) - lastTouchedAt(a);
    });
  }, [assets, searchQuery, category, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const pagedAssets = useMemo(
    () => filteredAssets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredAssets, safePage]
  );

  useEffect(() => {
    onPageInfoChange?.({ page: safePage, totalPages, total: filteredAssets.length });
  }, [safePage, totalPages, filteredAssets.length, onPageInfoChange]);

  // Filtering can shrink the set under the current page — snap back rather than
  // rendering an empty page.
  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages);
  }, [page, totalPages, onPageChange]);

  // Scroll the grid back into view on a page change. Without this, clicking
  // Next from halfway down leaves you parked mid-page on the new page's rows.
  const previousPage = useRef(safePage);
  useEffect(() => {
    if (previousPage.current !== safePage) {
      previousPage.current = safePage;
      gridTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [safePage]);

  // Grid columns per breakpoint.
  //
  // Ladder matches the tiket breakpoints in passport-type-grid.css. Counts are
  // tuned against the CONTENT width, not the viewport: at >=840px the sidebar
  // appears, so the first desktop step stays conservative.
  //
  // Density 4 reaches four columns at `xl` rather than `2xl` because the design
  // is drawn at 1440, which falls inside Tailwind's xl band (1280–1536). Gating
  // it on 2xl would render the reference layout three-up.
  const gridClasses = (() => {
    const columns: Record<number, string> = {
      4: "grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
      5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
      6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6",
      7: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-7",
      8: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 3xl:grid-cols-7 4xl:grid-cols-8",
    };
    // 16px between columns, 20px between rows, as drawn.
    return `grid gap-x-4 gap-y-5 ${columns[gridColumns] || columns[5]}`;
  })();

  if (loading && assets.length === 0) {
    return (
      <div className="flex animate-in flex-col items-center justify-center gap-4 py-20 text-center fade-in duration-300">
        <Loader2 className="size-10 animate-spin text-[var(--pp-brand-blue)]" />
        <div>
          <h3 className="mb-1">Getting your assets ready…</h3>
          <p className="text-sm text-muted-foreground">
            we're still preparing the assets for you, hang tight
          </p>
        </div>
      </div>
    );
  }

  if (justFinishedLoading) {
    return (
      <div className="flex animate-in flex-col items-center justify-center gap-3 py-20 text-center fade-in duration-300">
        <CheckCircle2 className="size-10 text-[var(--pp-icon-success)]" />
        <p className="text-sm text-muted-foreground">Done! Showing your assets…</p>
      </div>
    );
  }

  if (filteredAssets.length === 0) {
    const isIsland = category === "Island";
    // 360-wide column, centred, 12px between the illustration and the copy.
    // The text block carries its own 20px bottom inset from the design.
    return (
      <div className="flex w-full animate-in items-start justify-center fade-in duration-300">
        <div className="flex w-[360px] max-w-full flex-col items-center gap-3 pt-5">
          <img
            src="/assets/empty/tds_mi_search_no_result.png"
            alt=""
            aria-hidden="true"
            className="size-[60px] shrink-0 object-contain"
          />

          <div className="flex w-full flex-col items-center gap-4 px-5 py-2 pb-5 text-center text-[var(--pp-text-high)]">
            <div className="flex w-full flex-col items-center gap-2">
              <p className="w-full text-2xl font-bold leading-[1.07]">
                {assets.length === 0 ? "No assets available" : "No assets found"}
              </p>
              <p className="w-full text-lg leading-[1.33]">
                {searchQuery
                  ? `No assets match "${searchQuery}". Try different search terms.`
                  : isIsland
                    ? "This island is empty. Browse all assets to find things to add."
                    : assets.length === 0
                      ? "Start by uploading your first assets to the library."
                      : `No assets found in the ${getAssetTypeLabel(category)} category.`}
              </p>
            </div>

            {isIsland && onNavigateToAllAssets && (
              <Button onClick={onNavigateToAllAssets}>Browse All Assets</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      /* The mobile pager is fixed to the viewport, so it contributes no height
         to the flow. Without this reserved space the final row sits behind it. */
      className={totalPages > 1 ? "pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-0" : ""}
    >
      {/* Scroll target. scroll-mt clears the sticky header so the first row
          isn't hidden underneath it after a page change. */}
      <div ref={gridTopRef} className="scroll-mt-40" />

      <div
        className={`${viewMode === "grid" ? gridClasses : "space-y-2"} animate-in fade-in duration-300`}
      >
        {pagedAssets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            viewMode={viewMode}
            isSelected={selectedAsset?.nama_file === asset.nama_file}
            onSelect={onSelectAsset}
            onTagClick={onTagClick}
            activeTags={activeTags}
            islands={islands}
            onUpdateIslands={onUpdateIslands}
            gridColumns={gridColumns}
          />
        ))}
      </div>

      {/* Mobile-only pager. Desktop gets the header pager instead and pays no
          vertical space for it.

          FIXED, not sticky. `sticky bottom-0` on an element at the end of the
          flow only starts sticking once you've scrolled it into view, so on load
          — or on any viewport tall enough to show the whole grid — it simply
          wasn't there.

          Portalled to <body> because the sticky header uses backdrop-filter,
          which creates a containing block for fixed descendants; `bottom-0`
          would otherwise resolve against that box instead of the viewport. */}
      {totalPages > 1 &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t bg-background/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(safePage - 1)}
              disabled={safePage <= 1}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {safePage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(safePage + 1)}
              disabled={safePage >= totalPages}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>,
          document.body
        )}
    </div>
  );
}
