import { forwardRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "./ui/utils";
import { GlassMenu, GlassMenuDivider, GlassMenuItem } from "./GlassMenu";
import { Check, ChevronDown, ChevronLeft, ChevronRight, SearchLg } from "./icons/figma";
import { X } from "./icons";
import { ASSET_TYPE_FILTERS } from "./constants/projectConstants";
import { type SortOption } from "./AssetGrid";

/**
 * The header's controls.
 *
 * 1.x spread these across two header rows: a card-size slider, a segmented
 * grid/list toggle, a sort <Select>, and a pager at the bottom of the page. The
 * design collapses all of it into one row — two dropdown chips on the left, the
 * page range on the right — which is what makes a single-row header possible.
 */

/**
 * The design's "Chips - 01 General": a dropdown trigger, 16px label, 16px caret.
 *
 * The ref has to be forwarded. <PopoverTrigger asChild> hands its ref to this
 * component so Radix can measure the chip and anchor the menu to it; a plain
 * function component silently drops that ref, and the menu is then positioned
 * against nothing and rendered off-screen above the viewport.
 */
const Chip = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean }
>(({ children, open, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    {...props}
    className={cn(
      "flex shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-card px-3 py-2",
      "text-base leading-[1.38] text-foreground transition-colors hover:bg-accent/50",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      open && "bg-accent/50"
    )}
  >
    <span className="whitespace-nowrap">{children}</span>
    <ChevronDown className="size-4 shrink-0" />
  </button>
));
Chip.displayName = "Chip";

interface ControlPopoverProps {
  label: string;
  /** The design draws each menu at a fixed width rather than sizing to content. */
  width: string;
  children: (close: () => void) => ReactNode;
}

/*
 * Both chips open the same dark glassmorphic menu the island and user popovers
 * use, so the popover's own surface is stripped back to nothing and GlassMenu
 * supplies the blur, fill and radius.
 */
function ControlPopover({ label, width, children }: ControlPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip open={open}>{label}</Chip>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        // 8px on all four sides, which is tighter than the surface default of
        // 16px top and bottom. twMerge drops the primitive's py-4 in favour of
        // this p-2 rather than stacking them.
        className={cn("p-2", width)}
      >
        {/*
          px-0 cancels GlassMenu's own px-2.
          Two 8px insets were stacking — this shell's p-2 plus GlassMenu's px-2 —
          so these two chips sat at 16px horizontal while the design draws 8px.
          Overridden here rather than in GlassMenu because the island and user
          popovers keep the 16px inset deliberately.
        */}
        <GlassMenu className="px-0">{children(() => setOpen(false))}</GlassMenu>
      </PopoverContent>
    </Popover>
  );
}

/** The design's density options are three discrete stops, not a continuous range. */
const MIN_COLUMNS = 4;
const MAX_COLUMNS = 8;

/*
 * "Control - 02 Segmented": a translucent track with the active stop lifted out
 * of it on a white, shadowed pill.
 */
function DensityControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (columns: number) => void;
}) {
  return (
    // No inset of its own: the popover's 8px is the only gutter, the same as
    // the menu rows above. Keeping a px-2 here left this track 8px narrower on
    // each side than the List and Grid rows it sits under.
    <div className="w-full">
      {/* A slider rather than three stops, so 5 and 7 are reachable — the grid
          already maps every column count from 4 to 8.

          The white pill is a plain div sized to the value, not the range input's
          thumb, because a thumb cannot contain text and the design puts the
          number inside the fill. The real input sits transparent on top and owns
          all the interaction, so dragging, clicking the track and the arrow keys
          all behave natively. */}
      <div className="group relative h-[30px] w-full rounded-lg bg-white/20 p-0.5">
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex h-[26px] items-center rounded-md pl-3",
            // Fixed white on fixed dark, not the theme's surface tokens: the menu
            // behind it is dark in both themes, so a token that flips would make
            // the fill vanish in dark mode.
            "bg-white [filter:drop-shadow(0px_2px_4px_rgba(48,49,53,0.16))]",
            "transition-[width] duration-150 ease-out",
            "group-focus-within:ring-2 group-focus-within:ring-white/60"
          )}
          // Floors at 44px so the number never gets clipped at the minimum, then
          // grows across whatever track is left.
          style={{
            width: `calc(44px + (100% - 44px) * ${
              (value - MIN_COLUMNS) / (MAX_COLUMNS - MIN_COLUMNS)
            })`,
          }}
        >
          <span className="font-sans text-sm font-bold leading-[1.43] text-[var(--pp-n800)]">
            {value}
          </span>
        </div>

        <input
          type="range"
          min={MIN_COLUMNS}
          max={MAX_COLUMNS}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Cards per row"
          className="absolute inset-0 size-full cursor-pointer appearance-none bg-transparent opacity-0 focus:outline-none"
        />
      </div>
    </div>
  );
}

export function ViewControl({
  viewMode,
  onViewModeChange,
  gridColumns,
  onGridColumnsChange,
}: {
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  gridColumns: number;
  onGridColumnsChange: (columns: number) => void;
}) {
  return (
    <ControlPopover label="View" width="w-[180px]">
      {() => (
        <>
          <GlassMenuItem selected={viewMode === "list"} onClick={() => onViewModeChange("list")}>
            List
          </GlassMenuItem>
          <GlassMenuItem selected={viewMode === "grid"} onClick={() => onViewModeChange("grid")}>
            Grid
          </GlassMenuItem>
          {/* Density is meaningless in list view, where every row is full width. */}
          {viewMode === "grid" && (
            <DensityControl value={gridColumns} onChange={onGridColumnsChange} />
          )}
        </>
      )}
    </ControlPopover>
  );
}

/**
 * One option in the Asset Type menu.
 *
 * Structured like GlassMenuItem — outer box owns the hit area, inner box owns
 * the hover plate — but it cannot BE a GlassMenuItem: that component puts a
 * trailing check on a chosen row, and this menu is multi-select, so the design
 * gives every row a leading checkbox that is present whether or not it is on.
 */
function AssetTypeOption({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      className="group/row w-full text-left focus-visible:outline-none"
    >
      <span
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-base font-bold leading-[1.38] transition-colors",
          "text-[var(--pp-text-static-white)]",
          "group-hover/row:bg-white/10 group-focus-visible/row:bg-white/10"
        )}
      >
        {/* The box keeps its 40%-white fill in both states — the design does not
            switch it to a solid accent when ticked, the glyph alone reports it.
            Fixed white rather than a surface token because this panel is dark in
            both themes. */}
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded bg-white/40"
        >
          {checked && <Check className="size-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </span>
    </button>
  );
}

/**
 * The Asset Type filter: a chip that reports what is on, and a searchable
 * multi-select menu behind it.
 *
 * The chip has three faces, per the design. Nothing selected, it reads "Asset
 * Type" with a caret, like View and Sort. Exactly one, it names that type and
 * offers a cross to drop it, because with a single filter the label alone says
 * everything and clearing is the only likely next move. Two or more, the name
 * would no longer fit, so it goes back to "Asset Type" with a count badge.
 */
export function AssetTypeControl({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (types: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );

  const soleLabel =
    selected.length === 1
      ? ASSET_TYPE_FILTERS.find((t) => t.value === selected[0])?.label
      : undefined;

  const needle = query.trim().toLowerCase();
  const matches = ASSET_TYPE_FILTERS.filter((t) => t.label.toLowerCase().includes(needle));
  // Chosen types rise into their own group above the rule, so what is on is
  // legible without reading the whole list.
  const chosen = matches.filter((t) => selected.includes(t.value));
  const rest = matches.filter((t) => !selected.includes(t.value));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A stale search term would otherwise hide most of the list next time.
        if (!next) setQuery("");
      }}
    >
      {/* The border belongs to this wrapper, not to the trigger, so the clear
          cross can live inside the same outline while staying its own button —
          a button nested in a button is invalid, and making the cross a span
          would take it away from keyboard and screen-reader users. */}
      <div
        className={cn(
          "flex shrink-0 items-center rounded-lg border bg-card transition-colors",
          selected.length ? "border-[var(--pp-stroke-active)]" : "border-border"
        )}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              selected.length ? `Asset type, ${selected.length} selected` : "Filter by asset type"
            }
            className={cn(
              "flex items-center gap-1 rounded-lg px-3 py-2",
              "text-base leading-[1.38] text-foreground transition-colors hover:bg-accent/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              open && "bg-accent/50"
            )}
          >
            <span className="whitespace-nowrap">{soleLabel ?? "Asset Type"}</span>
            {selected.length === 0 && <ChevronDown className="size-4 shrink-0" />}
            {selected.length > 1 && (
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--pp-bg-blue-high)] font-sans text-xs font-semibold leading-none text-[var(--pp-text-static-white)]">
                {selected.length}
              </span>
            )}
          </button>
        </PopoverTrigger>

        {soleLabel && (
          <button
            type="button"
            onClick={() => onChange([])}
            aria-label={`Clear ${soleLabel} filter`}
            title="Clear filter"
            // -ml-2 pulls back the trigger's own 12px right padding to the 4px
            // gap the design draws between the label and the cross.
            className="-ml-2 flex shrink-0 items-center rounded-lg py-2 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-4 items-center justify-center rounded-full bg-[var(--pp-n700)] text-[var(--pp-text-static-white)]">
              <X className="size-3" />
            </span>
          </button>
        )}
      </div>

      <PopoverContent align="start" sideOffset={6} className="w-[248px] p-2">
        <GlassMenu className="px-0">
          <div className="flex w-full items-center gap-2 px-2">
            {/* N400 on both the glyph and the placeholder, as the design draws
                it. A fixed rung rather than --pp-icon-low: that token flips with
                the theme, and this surface does not. */}
            <SearchLg className="size-5 shrink-0 text-[var(--pp-n400)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search asset type"
              aria-label="Search asset type"
              className="min-w-0 flex-1 bg-transparent text-base leading-[1.38] text-[var(--pp-text-static-white)] outline-none placeholder:text-[var(--pp-n400)]"
            />
          </div>

          <GlassMenuDivider />

          {matches.length === 0 ? (
            <p className="px-2 py-1 text-base leading-[1.38] text-[var(--pp-n400)]">
              No asset type found
            </p>
          ) : (
            <>
              {chosen.map((type) => (
                <AssetTypeOption
                  key={type.value}
                  label={type.label}
                  checked
                  onToggle={() => toggle(type.value)}
                />
              ))}
              {/* Only a separator between two populated groups; on its own above
                  or below nothing it would read as an empty section. */}
              {chosen.length > 0 && rest.length > 0 && <GlassMenuDivider />}
              {rest.map((type) => (
                <AssetTypeOption
                  key={type.value}
                  label={type.label}
                  checked={false}
                  onToggle={() => toggle(type.value)}
                />
              ))}
            </>
          )}
        </GlassMenu>
      </PopoverContent>
    </Popover>
  );
}

const SORT_LABELS: Record<SortOption, string> = {
  recent: "Last added",
  alphabetical: "Alphabetical",
  type: "By type",
};

export function SortControl({
  sortBy,
  onSortChange,
}: {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
}) {
  return (
    <ControlPopover label={SORT_LABELS[sortBy]} width="w-48">
      {(close) => (
        <>
          {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
            <GlassMenuItem
              key={option}
              selected={sortBy === option}
              onClick={() => {
                onSortChange(option);
                close();
              }}
            >
              {SORT_LABELS[option]}
            </GlassMenuItem>
          ))}
        </>
      )}
    </ControlPopover>
  );
}

const PAGE_SIZE = 50;

/**
 * Page range and stepper, as the design draws it: "1-50 of 4566" followed by
 * two chevrons, with no visible chrome around any of it.
 *
 * The range itself is a button. The design has no jump-to-page control, but at
 * 4,566 assets that is 92 pages to chevron through, so the capability from 1.x
 * is kept on the one element already showing the page numbers. It looks exactly
 * like the static text in the design until you click it.
 */
export function PaginationControl({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState("");

  const go = (target: number) => onPageChange(Math.max(1, Math.min(totalPages, target)));

  const submitJump = () => {
    const parsed = Number.parseInt(jump, 10);
    if (!Number.isNaN(parsed)) go(parsed);
    setJump("");
    setOpen(false);
  };

  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Jump to page"
            className="whitespace-nowrap text-right text-base leading-[1.38] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {first}-{last} of <span className="font-bold">{total.toLocaleString()}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="flex w-[279px] flex-col gap-2 p-2"
        >
          {/* High Emphasis on the glass surface is the static white, not
              --pp-text-high, which is mixed for a light page. */}
          <p className="px-2 py-1 text-base leading-[1.38] font-bold text-[var(--pp-text-static-white)]">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-start gap-2">
            {/* Fixed palette rungs rather than the semantic surface tokens: this
                panel is dark in both themes, so --pp-bg-base and friends would
                invert the field and the button out from under it. */}
            <input
              type="number"
              min={1}
              max={totalPages}
              placeholder={`1-${totalPages}`}
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitJump()}
              aria-label="Page number"
              autoFocus
              className={cn(
                "h-[42px] min-w-0 flex-1 rounded-lg border border-[var(--pp-b400)] bg-white/10 px-3",
                "text-base leading-[1.38] text-[var(--pp-text-static-white)] outline-none",
                "placeholder:text-[var(--pp-a60)]",
                // Chrome draws stepper arrows inside a number field on hover,
                // which the design has no room for and does not show.
                "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              )}
            />
            <button
              type="button"
              onClick={submitJump}
              disabled={!jump}
              className={cn(
                "h-[42px] min-w-[84px] shrink-0 rounded-[10px] border border-[var(--pp-n400)] px-5",
                "text-base leading-[1.38] font-bold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                jump
                  ? "bg-[var(--pp-n0)] text-[var(--pp-n800)]"
                  : "cursor-not-allowed bg-[var(--pp-n200)] text-[var(--pp-n400)]"
              )}
            >
              Go
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-1">
        <PagerButton
          label="Previous page"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          icon={ChevronLeft}
        />
        <PagerButton
          label="Next page"
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
          icon={ChevronRight}
        />
      </div>
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  icon: Icon,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center rounded-md text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled ? "cursor-not-allowed text-[var(--pp-icon-disabled)]" : "hover:text-[var(--pp-text-active)]"
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}
