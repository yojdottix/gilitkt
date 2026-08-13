import { useState } from "react";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { GlassMenu, GlassMenuDivider, GlassMenuItem } from "../GlassMenu";
import { MoreVertical } from "../icons";
import { Edit02, FileDownload01, FileDownload02, Island as IslandGlyph, Trash03 } from "../icons/figma";
import { type Asset } from "../../utils/appwriteApi";
import { type Island } from "./types";

interface IslandCardProps {
  island: Island;
  /** Members of this island, already resolved from the full asset list. */
  members: Asset[];
  onOpen: () => void;
  /*
   * Every action is optional, and the kebab only appears for the ones supplied.
   * A harbor island is the same card with the same collage, but nobody except
   * the superuser may rename or delete one — so those two are simply left off
   * rather than passed and then disabled, which would advertise a control that
   * can never do anything.
   */
  onRename?: () => void;
  onExportCsv?: () => void;
  onExportTxt?: () => void;
  onDelete?: () => void;
}

/**
 * An island rendered as a collage of the artwork inside it.
 *
 * The 1.x card showed three thumbnails in a fixed row and a stack of type-count
 * chips. The design replaces that with a 2x2 mosaic where the first asset gets
 * the whole left half, which reads as a shelf of work rather than a database
 * row, and drops the chips in favour of a single member count.
 */
export function IslandCard({
  island,
  members,
  onOpen,
  onRename,
  onExportCsv,
  onExportTxt,
  onDelete,
}: IslandCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const total = island.asset_ids.length;
  const hasExports = Boolean(onExportCsv || onExportTxt);
  const hasMenu = Boolean(onRename || onDelete) || hasExports;

  const run = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      /* Radius 16 and a 1px border, no shadow. The card's only elevation lives
         on the tiles inside it — see --gili-tile-shadow. */
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[16px] border border-border bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Collage members={members} />

      {/* Details block: 12px sides and top, 20px bottom. */}
      <div className="flex w-full flex-col gap-0.5 px-3 pb-5 pt-3">
        <h3
          className="truncate text-lg font-bold leading-[1.33] text-[var(--pp-text-high)]"
          title={island.name}
        >
          {island.name}
        </h3>
        <p className="truncate text-sm leading-[1.43] text-[var(--pp-text-low)]">
          {total} {total === 1 ? "asset" : "assets"} · {relativeTime(island.updated_at)}
        </p>
      </div>

      {/* Kebab sits over the card's top-right corner, outside the grid. */}
      {hasMenu && (
      <div className="absolute right-0 top-0 p-2">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${island.name}`}
              onClick={(e) => e.stopPropagation()}
              /* Always visible below lg. Hover-reveal on a touch screen means
                 rename, export and delete are simply unreachable there. */
              className="shrink-0 rounded-lg p-1.5 text-[var(--pp-icon-high)] opacity-100 transition-opacity hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:opacity-0 lg:group-hover:opacity-100 lg:data-[state=open]:opacity-100"
            >
              <MoreVertical className="size-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={4}
            onClick={(e) => e.stopPropagation()}
            className="w-48 border-0 bg-transparent p-0 shadow-none"
          >
            <GlassMenu className="rounded-2xl py-2">
              {onRename && (
                <>
                  <GlassMenuItem icon={Edit02} onClick={run(onRename)}>
                    Rename
                  </GlassMenuItem>
                  {hasExports && <GlassMenuDivider />}
                </>
              )}
              {/* 02 is the lined document, 01 the plain sheet. The design puts
                  the lined one on CSV; these were the other way round. */}
              {onExportCsv && (
                <GlassMenuItem icon={FileDownload02} onClick={run(onExportCsv)}>
                  Export to CSV
                </GlassMenuItem>
              )}
              {onExportTxt && (
                <GlassMenuItem icon={FileDownload01} onClick={run(onExportTxt)}>
                  Export to TXT
                </GlassMenuItem>
              )}
              {onDelete && (
                <>
                  {hasExports && <GlassMenuDivider />}
                  <GlassMenuItem icon={Trash03} destructive onClick={run(onDelete)}>
                    Delete Island
                  </GlassMenuItem>
                </>
              )}
            </GlassMenu>
          </PopoverContent>
        </Popover>
      </div>
      )}
    </div>
  );
}

/** "1h", "3d", "2w" — the compact form the card's meta line uses. */
function relativeTime(iso?: string): string {
  if (!iso) return "just now";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * A fixed 2x2 of thumbnails. Slots past the member count stay empty rather than
 * reflowing, because the grid shape is what identifies the component at a
 * glance — one stretched image would read as a different card entirely.
 */
function Collage({ members }: { members: Asset[] }) {
  const shown = members.slice(0, 4);

  // The design's own Empty variant: no grid, a centred glyph and a label. It
  // keeps the card's height stable against a populated one.
  if (shown.length === 0) {
    return (
      <div className="flex h-[253px] w-full flex-col items-center justify-center gap-2">
        <IslandGlyph className="size-8 text-[var(--pp-icon-disabled)]" />
        <p className="text-lg font-bold leading-[1.33] text-[var(--pp-text-disabled)]">
          Empty island
        </p>
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-2 gap-x-3 gap-y-4 px-4 py-5">
      {[0, 1, 2, 3].map((i) => (
        <Tile key={i} asset={shown[i]} />
      ))}
    </div>
  );
}

function Tile({ asset }: { asset?: Asset }) {
  // An absent asset still occupies its cell, so the 2x2 keeps its shape.
  if (!asset) return <div className="h-[98.5px]" />;
  return (
    <div className="flex h-[98.5px] items-center justify-center rounded-lg bg-[var(--pp-bg-base)] p-2.5 [filter:drop-shadow(var(--gili-tile-shadow))]">
      <ImageWithFallback
        src={asset.url_lightroom}
        alt={asset.nama_file}
        className="size-full object-contain"
      />
    </div>
  );
}
