import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "./ui/use-mobile";
import { X, Plus, ZoomIn, Settings } from "./icons";
import { ArrowUpRight } from "./icons/ArrowUpRight";
import { ImageZoomModal } from "./ImageZoomModal";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { type Asset } from "../utils/appwriteApi";
import { toast } from "sonner";
import { copyWithFeedback } from "../utils/clipboard";
import { extractTags, tagChipClasses, tagChipTitle } from "./helpers/assetHelpers";
import { Copy03 } from "./icons/figma";
import { CheckCircle } from "./icons/CheckCircle";
import { cn } from "./ui/utils";
import { IslandPicker } from "./islands/IslandPicker";
import { type Island } from "./islands/types";
import { useSuperuser } from "../context/SuperuserContext";

interface AssetDetailPanelProps {
  asset: Asset;
  isOpen: boolean;
  onClose: () => void;
  onTagClick?: (tag: string) => void;
  /** Tags currently switched on, lowercased — kept in step with the search box. */
  activeTags?: string[];
  islands?: Island[];
  onUpdateIslands?: (islands: Island[]) => void;
  /** Superuser-only: jump to the Manage Asset screen. */
  onManageAsset?: () => void;
}

export function AssetDetailPanel({
  asset,
  isOpen,
  onClose,
  onTagClick,
  activeTags = [],
  islands = [],
  onUpdateIslands,
  onManageAsset,
}: AssetDetailPanelProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isMobile = useIsMobile();

  /*
   * Zoom is a MOBILE-ONLY mode flag.
   *
   * Mobile cannot fit the stage and the sheet side by side, so it keeps the
   * two-step flow: sheet first, tap the preview to zoom. This stays false until
   * that tap.
   *
   * Desktop is not a mode at all — opening a card opens both halves of one
   * screen, so `showCanvas` below is unconditional there rather than reading
   * this flag. It used to be seeded from `!isMobile` and shared by both
   * layouts, which meant anything that set it back to false while the panel
   * stayed open (the docked stage answering Esc on its own) dropped the desktop
   * screen into a half-state the design has no drawing for: the canvas gone,
   * and the panel widened back to a slab flush against the viewport edge with
   * the 12px gutter and its rounded corners lost.
   */
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  useEffect(() => {
    if (!isMobile) setIsZoomOpen(false);
  }, [isMobile]);

  /** Desktop always docks the stage beside the panel; mobile never does. */
  const showCanvas = !isMobile;
  /** Both layouts that float the panel over a dimmed page rather than slab it. */
  const isFloating = showCanvas || isZoomOpen;
  const { unlocked } = useSuperuser();

  // Swipe-down-to-dismiss, mobile only.
  //
  // The gesture is bound to the drag handle and header strip rather than the
  // whole sheet, so it can never fight the scrolling content below it — the
  // usual failure mode of "drag anywhere" sheets is that flicking through tags
  // dismisses the panel instead of scrolling.
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  /** Past this many pixels the sheet closes; below it, it springs back. */
  const DISMISS_THRESHOLD_PX = 110;

  // A window resize across the breakpoint mid-drag would otherwise leave a
  // stale translateY on the desktop panel.
  useEffect(() => {
    if (!isMobile) {
      setDragY(0);
      dragStartY.current = null;
    }
  }, [isMobile]);

  const handleDragStart = (e: React.PointerEvent) => {
    if (!isMobile) return;
    dragStartY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    // Downward only. Allowing negative values would let the sheet be dragged
    // off the top of the screen.
    setDragY(Math.max(0, e.clientY - dragStartY.current));
  };

  const handleDragEnd = () => {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    if (dragY > DISMISS_THRESHOLD_PX) {
      onClose();
      setDragY(0);
    } else {
      setDragY(0);
    }
  };

  // Lock the page behind the panel.
  //
  // Without this the body keeps scrolling under a position:fixed overlay, which
  // on mobile makes the panel look like it's sliding around — you think you're
  // scrolling the panel but you're moving the page beneath it. position:fixed
  // on <body> also has to restore the previous scroll offset on close, or
  // dismissing the panel silently jumps you back to the top of the grid.
  useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    const { body } = document;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // Esc unwinds one layer at a time. Without the guard both this and the zoom
  // stage answer the same keypress, and dismissing the zoom takes the panel
  // with it.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Desktop closes the whole screen from either region — the canvas is not a
      // layer you can back out of. Mobile still steps back to the sheet.
      if (isMobile && isZoomOpen) setIsZoomOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isZoomOpen, isMobile, onClose]);

  if (!isOpen) return null;

  /**
   * `what` names the thing being copied, and only the link chip has a copied
   * state to flip. Both used to share one handler and one flag, so copying the
   * filename announced "Link copied" and turned the URL row green underneath —
   * it read as though the wrong thing had gone to the clipboard.
   */
  const handleCopyClick = async (text: string, what: "name" | "link") => {
    await copyWithFeedback(
      text,
      () => {
        if (what === "link") {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        }
        toast.success(what === "link" ? "Link copied to clipboard!" : "Name copied to clipboard!");
      },
      (errorMessage: string) => {
        toast.error("Copy failed", { description: errorMessage });
      }
    );
  };

  const tags = extractTags(asset);
  const isTagOn = (tag: string) => activeTags.includes(tag.toLowerCase());

  // Show the REAL filename from the database.
  //
  // This used to synthesise one by gluing a "tds_<type>_" prefix onto the asset
  // name, which produced names that don't exist — e.g. an Other-type asset
  // called `ot_bt_cc_zoom_travel2` was displayed as
  // `tds_si_ot_bt_cc_zoom_travel2.png`: double-prefixed, and mislabelled as a
  // Spot illustration because the prefix map only knew Micro/Icon/Spot and
  // defaulted everything else to "si". Since this is the name people copy to go
  // find the file, a fabricated one is worse than useless.
  const displayName = asset.nama_file || asset.asset_name || 'untitled';


  // Portalled for the same reason as ImageZoomModal: a transformed ancestor
  // would otherwise become the containing block for this fixed overlay.
  return createPortal(
    <div
      /* Mobile: sheet anchored to the bottom edge, full width.
         Desktop (840px+): right-side panel.

         Zoomed on desktop the same container becomes the overlay from the
         design: a 12px gutter all round, the zoom stage taking the remaining
         width, and the panel beside it at 320px rather than on top of it. */
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center lg:items-stretch lg:justify-end",
        isFloating ? "bg-black/80 lg:gap-4 lg:p-3" : "bg-black/50"
      )}
      onClick={onClose}
    >
      {showCanvas && (
        <ImageZoomModal
          src={asset.url_lightroom}
          alt={asset.asset_name}
          caption={displayName}
          isOpen
          // Closes the whole screen, not just the stage. On desktop the canvas
          // is not a layer you can back out of, and leaving the panel behind on
          // its own is the half-state described above.
          onClose={onClose}
          variant="docked"
          className="hidden min-w-0 flex-1 lg:block"
        />
      )}

      <div
        /* Mobile bottom sheet — 85dvh so a strip of backdrop stays visible and
           it reads as a sheet over the grid rather than a new page. dvh over vh
           because mobile browsers resize the viewport as the address bar
           hides/reveals, and vh doesn't re-measure.

           Desktop keeps the full-height 340px right panel and its slide-in. The
           mobile slide-up is separate: a slide-in-from-right on a full-width
           sheet read as the panel drifting sideways.

           flex-col here, with the scroll moved to the content wrapper below, so
           the drag handle stays put instead of scrolling away with the content. */
        className={cn(
          "asset-detail-panel flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-[16px] bg-card shadow-xl animate-in slide-in-from-bottom duration-300 lg:h-full lg:rounded-none lg:slide-in-from-bottom-0 lg:slide-in-from-right-0 lg:duration-300",
          // Zoomed, the panel narrows to 320 and rounds off, because it is now a
          // card floating in the overlay rather than a slab against the edge.
          isFloating
            ? "lg:w-[320px] lg:max-w-[320px] lg:rounded-2xl"
            : "lg:w-[360px] lg:max-w-[360px]"
        )}
        style={
          dragY > 0
            ? { transform: `translateY(${dragY}px)`, transition: "none" }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle, mobile only. Doubles as the swipe target. */}
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center py-2 active:cursor-grabbing lg:hidden"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          role="button"
          tabIndex={-1}
          aria-label="Drag down to close"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header. 20px all round, the title on Body 1 - Bold and a bare 20px
            close glyph — no button chrome, as drawn. */}
        <div className="flex shrink-0 items-center gap-3 p-5">
          <h2 className="min-w-0 flex-1 text-[18px] font-bold leading-[1.33] text-[var(--pp-text-high)]">
            Details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-sm text-[var(--pp-icon-high)] transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Everything between the header and the action footer scrolls. */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Preview band — a fixed 160px-tall image on the sunken surface,
              not a 4:3 card. object-contain across every type: object-cover was
              cropping portrait and non-4:3 assets, which is unusable in a
              library whose whole job is letting you check what an asset
              actually looks like. Click still zooms; the design only draws the
              rest state. */}
          <button
            type="button"
            onClick={() => setIsZoomOpen(true)}
            // Desktop reaches the canvas by opening the card, so the preview is
            // inert there and advertising a zoom step would be a lie. Only
            // mobile still needs the affordance.
            disabled={!isMobile}
            title={isMobile ? "Tap to zoom" : undefined}
            className="group relative flex w-full items-center justify-center bg-[var(--pp-bg-sunken)] px-5 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ImageWithFallback
              src={asset.url_lightroom}
              alt={asset.asset_name}
              className="h-[160px] w-[240px] object-contain"
            />
            {isMobile && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-neutral-900">
                  <ZoomIn className="h-3.5 w-3.5" />
                  Zoom
                </span>
              </span>
            )}
          </button>

          {/* Detail. 20/16 padding, 16px between every field, 4px between a
              field's label and its value. */}
          <div className="flex flex-col gap-4 px-5 py-4">
            <h3 className="break-words text-[18px] font-bold leading-[1.33] text-[var(--pp-text-high)]">
              {asset.asset_name}
            </h3>

            <div className="flex flex-col gap-4">
              {/* Name — filenames have no spaces, so break-all is what actually
                  forces a wrap; line-clamp caps it at 3 lines so a very long
                  name can't push the whole panel down. Click to copy. */}
              <div className="flex flex-col gap-1">
                <div className="text-base leading-[1.38] text-[var(--pp-text-low)]">Name</div>
                <button
                  type="button"
                  onClick={() => handleCopyClick(displayName, "name")}
                  title={`${displayName} — click to copy`}
                  className="line-clamp-3 break-all text-left text-base font-bold leading-[1.38] text-[var(--pp-text-high)] transition-opacity hover:opacity-70"
                >
                  {displayName}
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-base leading-[1.38] text-[var(--pp-text-low)]">Type</div>
                <div className="text-base font-bold leading-[1.38] text-[var(--pp-text-high)]">
                  {asset.type || "Illustration"}
                </div>
              </div>

              {/* Source — opens the asset straight in Lightroom.
                  rel="noopener noreferrer" because target="_blank" otherwise
                  hands the opened page a reference back to this window. */}
              <div className="flex flex-col gap-1">
                <div className="text-base leading-[1.38] text-[var(--pp-text-low)]">Source</div>
                {asset.url_lightroom ? (
                  <a
                    href={asset.url_lightroom}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-0.5 text-base font-bold leading-[1.38] text-[var(--pp-text-active)] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Open in Lightroom (new tab)"
                  >
                    Lightroom
                    <ArrowUpRight className="size-5 shrink-0" />
                  </a>
                ) : (
                  <div className="text-base font-bold leading-[1.38] text-[var(--pp-text-low)]">
                    -
                  </div>
                )}
              </div>

              {tags.length > 0 && (
                <div className="flex flex-col gap-1">
                  <div className="text-base leading-[1.38] text-[var(--pp-text-low)]">Tags</div>
                  <div className="flex flex-wrap items-center gap-1">
                    {tags.map((tag, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className={tagChipClasses(isTagOn(tag))}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTagClick?.(tag);
                        }}
                        title={tagChipTitle(tag, isTagOn(tag))}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action footer, outside the scroller so the primary action is always
            reachable on a short viewport. Same 20/16 padding and 16px rhythm as
            the detail block above it.

            A Download button sat here until 1.0.54. It could not work: it
            fetched the asset from s-light.tiket.photos, a different origin, and
            without `Access-Control-Allow-Origin` from that CDN the browser
            blocks the read. The Source link above is the working path, and the
            copy chip covers the rest. */}
        <div className="flex shrink-0 flex-col gap-4 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-1">
            <div className="text-base leading-[1.38] text-[var(--pp-text-low)]">Details</div>
            {/* The same link chip the inventory card uses: one surface that is
                itself the copy button, rather than a read-only field beside a
                filled action button. Kept as literal markup rather than an
                extracted component because AssetCard owns its own copy state
                and feedback; only the appearance is shared. */}
            <button
              type="button"
              onClick={() => handleCopyClick(asset.url_lightroom, "link")}
              title={`Copy ${asset.url_lightroom}`}
              aria-label="Copy link"
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isCopied
                  ? "bg-[var(--pp-bg-green-low)]"
                  : "bg-[var(--pp-bg-backdrop)] hover:bg-[var(--pp-n200,#d8dce8)]"
              )}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm leading-[1.43]",
                  isCopied ? "text-[var(--pp-text-positive)]" : "text-[var(--pp-text-low)]"
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
          </div>

          {/* Med, not Big: the instance in the design measures 20px side and
              11px top inset with an 8px radius and an 84px minimum, which is
              Med's geometry once the 1px stroke is counted as part of the inset.

              Guest sees Add to Island across the full width, as drawn.
              Superuser gets Edit details beside it, and two of them cannot both
              carry Med's 20px side padding inside 320px, so the pair drops to
              12px — the only value that gives; height, radius and type stay on
              the size. Editing itself still happens on the Manage Asset screen,
              which owns the write path to Appwrite. */}
          <div className="flex items-center gap-2">
            {unlocked && onManageAsset && (
              <Button
                variant="secondary"
                onClick={onManageAsset}
                className="min-w-0 flex-1 px-3"
              >
                <Settings />
                Edit details
              </Button>
            )}

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  className={cn("w-full", unlocked && onManageAsset && "min-w-0 flex-1 px-3")}
                >
                  <Plus />
                  Add to Island
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="center"
                sideOffset={6}
                className="w-[360px] max-w-[calc(100vw-2rem)]"
              >
                <IslandPicker
                  asset={asset}
                  islands={islands}
                  onUpdateIslands={onUpdateIslands ?? (() => {})}
                  onDone={() => setPickerOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Mobile keeps the covering overlay: there is no room to dock a stage
          beside a full-width sheet. */}
      {isMobile && (
        <ImageZoomModal
          src={asset.url_lightroom}
          alt={asset.asset_name}
          caption={displayName}
          isOpen={isZoomOpen}
          onClose={() => setIsZoomOpen(false)}
        />
      )}
    </div>,
    document.body
  );
}
