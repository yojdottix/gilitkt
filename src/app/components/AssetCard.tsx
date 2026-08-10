import { memo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { type Asset } from "../utils/appwriteApi";
import { toast } from "sonner";
import { copyWithFeedback } from "../utils/clipboard";
import { extractTags, tagChipClasses, tagChipTitle } from "./helpers/assetHelpers";
import { getAssetTypeLabel } from "./constants/projectConstants";
import { Copy03, Plus } from "./icons/figma";
import { CheckCircle } from "./icons/CheckCircle";
import { IslandPicker } from "./islands/IslandPicker";
import { type Island } from "./islands/types";
import { cn } from "./ui/utils";

interface AssetCardProps {
  asset: Asset;
  viewMode: "grid" | "list";
  isSelected?: boolean;
  onSelect?: (asset: Asset) => void;
  onTagClick?: (tag: string) => void;
  /**
   * Tags currently switched on, lowercased. Chips in this list render as active.
   * Passed down rather than derived here so every chip in the app agrees with the
   * search box, which is the single source of truth for what's being filtered.
   */
  activeTags?: string[];
  islands?: Island[];
  onUpdateIslands?: (islands: Island[]) => void;
  /** Density from the header's View popover — desktop only. */
  gridColumns?: number;
}

/*
 * Download was removed in 1.0.54 and stays removed.
 *
 * Two attempts, both dead ends. The original was an `<a download>` pointed at
 * `asset.url_lightroom`; the `download` attribute is IGNORED cross-origin, so
 * it degraded to navigation and opened Lightroom in a tab while reporting
 * "Download started!". The replacement fetched the bytes to hand them over as a
 * same-origin blob, which is correct in principle but requires
 * `Access-Control-Allow-Origin` from s-light.tiket.photos. That header does not
 * exist, so the fetch is blocked and the code fell back to opening a tab too.
 *
 * There is no third approach that lives in the client. Copy Link is the honest
 * affordance, which is why the design gives it the card's primary action slot —
 * as of 2.0 that slot is the copy glyph inside the link chip itself.
 */

function AssetCardImpl({
  asset,
  viewMode,
  isSelected = false,
  onSelect,
  onTagClick,
  activeTags = [],
  islands = [],
  onUpdateIslands,
  gridColumns = 5,
}: AssetCardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Density only compacts the card's chrome; the artwork keeps its aspect ratio
  // at every step so a dense grid still reads as a contact sheet.
  const isDense = gridColumns >= 7;

  const tags = extractTags(asset);
  const isTagOn = (tag: string) => activeTags.includes(tag.toLowerCase());
  const memberCount = islands.filter((i) => i.asset_ids.includes(asset.nama_file)).length;

  const handleCopy = async () => {
    await copyWithFeedback(
      asset.url_lightroom,
      () => {
        setIsCopied(true);
        toast.success("Link copied to clipboard!", {
          description: "The asset URL has been copied successfully.",
        });
        setTimeout(() => setIsCopied(false), 2000);
      },
      (message: string) => {
        if (message.includes("selected") || message.includes("dialog")) {
          toast.info("Copy manually", { description: message, duration: 5000 });
        } else {
          toast.error("Copy failed", { description: message, duration: 6000 });
        }
      }
    );
  };

  /** Bare glyph in the media corner — the design gives it no fill or border. */
  const renderIslandButton = (className?: string) => (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={memberCount > 0 ? `In ${memberCount} island(s)` : "Add to an island"}
          aria-label="Add to an island"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg p-1.5 transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Bare over the thumbnail at rest; once the scrim comes up it needs
            // its own light surface to stay legible, which is also how the
            // design draws the hover state.
            "group-hover:bg-[var(--pp-bg-base)] group-hover:text-[var(--pp-icon-active)]",
            "hover:bg-[var(--pp-bg-backdrop)]",
            memberCount > 0 ? "text-[var(--pp-text-active)]" : "text-[var(--pp-icon-high)]",
            className
          )}
        >
          <Plus className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-[360px] max-w-[calc(100vw-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <IslandPicker
          asset={asset}
          islands={islands}
          onUpdateIslands={onUpdateIslands ?? (() => {})}
          onDone={() => setPickerOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );

  /**
   * The link chip. The whole chip is the copy button — the design shows the URL
   * and a copy glyph on one N100 surface, with no separate action button.
   */
  const linkChip = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      title={`Copy ${asset.url_lightroom}`}
      aria-label="Copy link"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isCopied ? "bg-[var(--pp-bg-green-low)]" : "bg-[var(--pp-bg-backdrop)] hover:bg-[var(--pp-n200,#d8dce8)]"
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm leading-[1.43]",
          isCopied ? "text-[var(--pp-text-positive)]" : "text-muted-foreground"
        )}
      >
        {isCopied ? "Link copied to clipboard" : asset.url_lightroom}
      </span>
      {isCopied ? (
        <CheckCircle className="size-5 shrink-0 text-[var(--pp-text-positive)]" />
      ) : (
        <Copy03 className="size-5 shrink-0 text-[var(--pp-icon-active)]" />
      )}
    </button>
  );

  /*
   * How many chips a card can hold before the rest become a "+N".
   *
   * Capped by column count rather than measured at runtime. A ResizeObserver per
   * card would be more exact, but there are up to 100 cards on screen and the
   * observers would fire on every density change and every window resize — an
   * expensive way to answer a question the column count already answers.
   *
   * The row used to be `overflow-hidden` with every chip rendered, which clipped
   * the last one mid-word: a card showing "Update · Document · W" told you a
   * fourth tag existed but not that there were three more. A count is smaller
   * and says more.
   */
  const maxVisibleTags = gridColumns >= 7 ? 1 : gridColumns >= 5 ? 2 : 3;
  const visibleTags = tags.slice(0, maxVisibleTags);
  const hiddenTags = tags.slice(maxVisibleTags);

  const tagRow = tags.length > 0 && (
    <div className="flex w-full flex-nowrap items-center gap-1 overflow-hidden">
      {visibleTags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTagClick?.(tag);
          }}
          title={tagChipTitle(tag, isTagOn(tag))}
          className={cn("min-w-0 shrink truncate", tagChipClasses(isTagOn(tag)))}
        >
          {tag}
        </button>
      ))}
      {hiddenTags.length > 0 && (
        // Not a button: it filters nothing, and a chip that looks interactive but
        // does nothing is worse than one that plainly reports a number. The full
        // list is on the title so it stays reachable without opening the asset.
        <span
          title={hiddenTags.join(", ")}
          className={cn("shrink-0 tabular-nums", tagChipClasses(false))}
        >
          {hiddenTags.length}+
        </span>
      )}
    </div>
  );

  if (viewMode === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect?.(asset)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSelect?.(asset);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-4 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-accent/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSelected && "ring-2 ring-ring"
        )}
      >
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-[var(--pp-bg-sunken)]">
          <ImageWithFallback
            src={asset.url_lightroom}
            alt={asset.asset_name}
            className="size-full object-contain p-2"
          />
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="truncate text-base font-bold leading-[1.38] text-foreground">
            {asset.asset_name}
          </h4>
          <p
            className="mt-0.5 truncate text-sm leading-[1.43] text-muted-foreground"
            title={asset.nama_file}
          >
            {asset.nama_file}
          </p>
          <div className="mt-2">{tagRow}</div>
        </div>

        <span className="hidden shrink-0 rounded-full border border-border px-3 py-1 text-sm text-muted-foreground lg:inline">
          {getAssetTypeLabel(asset.type)}
        </span>

        <div className="hidden w-[280px] shrink-0 xl:block">{linkChip}</div>

        {renderIslandButton()}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(asset)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect?.(asset);
      }}
      className={cn(
        "group flex cursor-pointer flex-col items-center overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected && "ring-2 ring-ring"
      )}
    >
      <div className="relative w-full overflow-hidden">
        <div
          className={cn(
            "flex w-full flex-col items-center justify-center overflow-hidden bg-[var(--pp-bg-sunken)] px-5",
            isDense ? "py-2" : "py-3"
          )}
        >
          <ImageWithFallback
            src={asset.url_lightroom}
            alt={asset.asset_name}
            /* Fixed 160px tall, as drawn. Icons and micro illustrations are
               authored small, so filling the box blows them up past their
               intended size — they get extra inset instead. */
            className={cn(
              "w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]",
              isDense ? "h-[120px]" : "h-[160px]",
              asset.type === "Icon" ? "p-6" : asset.type === "Micro" ? "p-4" : ""
            )}
          />
        </div>

        {/* Hover scrim. It darkens the thumbnail only, never the text block
            below, so the type chip and the + button read against it while the
            name and tags stay on the card surface. */}
        <div
          className="pointer-events-none absolute inset-0 bg-[rgba(24,25,27,0.5)] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-hidden="true"
        />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2">
          {/* The asset's type, shown only on hover — it is already implied by
              the artwork at rest, and a permanent chip competes with the name.

              static-white rather than text-invert: the fill is always N900, so
              the label must not flip with the theme. */}
          <span className="pointer-events-none flex items-center gap-0.5 rounded-[54px] bg-[var(--pp-n900)] px-2 py-0.5 text-sm leading-[1.43] text-[var(--pp-text-static-white)] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            {getAssetTypeLabel(asset.type)}
          </span>
          {/* Revealed on hover like the type chip beside it, so the artwork sits
              on a clean tile at rest.

              Gated on `(hover: hover)` rather than a breakpoint: a touch device
              never produces the hover that would bring it back, so hiding it
              there would make islands unreachable on a tablet held in landscape.
              It also stays put while the picker is open — the pointer moves into
              the popover, which is outside the card — and comes back for
              keyboard users via focus-visible. */}
          {renderIslandButton(
            cn(
              "group-hover:opacity-100 focus-visible:opacity-100",
              !pickerOpen && "[@media(hover:hover)]:opacity-0"
            )
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex w-full flex-col justify-center bg-card px-4",
          isDense ? "gap-2 pb-3 pt-2" : "gap-4 pb-5 pt-3"
        )}
      >
        <div className="flex w-full flex-col justify-center gap-2 overflow-hidden">
          <div className="flex w-full flex-col gap-0.5">
            <h4
              className={cn(
                "w-full truncate font-bold text-foreground",
                isDense ? "text-base leading-[1.38]" : "text-lg leading-[1.33]"
              )}
              title={asset.asset_name}
            >
              {asset.asset_name}
            </h4>
            <p
              className="w-full truncate text-sm leading-[1.43] text-muted-foreground"
              title={asset.nama_file}
            >
              {asset.nama_file}
            </p>
          </div>

          {linkChip}
        </div>

        {/* Shown at every density now, including 7 and 8 columns where it used
            to be dropped entirely. The chip cap above is what makes that fit —
            one chip plus a count, rather than three chips clipped mid-word. */}
        {tagRow}
      </div>
    </div>
  );
}

// Memoized — with hundreds of cards on screen at once, this avoids re-rendering
// every single one when something unrelated elsewhere changes.
export const AssetCard = memo(AssetCardImpl);
