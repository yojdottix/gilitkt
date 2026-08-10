import { type ComponentType } from 'react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar } from './ui/sidebar';
import { GiliLogo } from './GiliLogo';
import { Asset } from '../utils/appwriteApi';
import { cn } from './ui/utils';
import { SyncStatusLine } from './SyncStatusLine';
import { UserMenu } from './UserMenu';
import { BarChart3, Download, Image, KeyRound, Plus, Settings, Trash2, Upload } from './icons';
import {
  Atom02,
  Compass03,
  Cube01,
  Image01,
  Island,
  LayoutLeft,
  PuzzlePiece02,
  StickerCircle,
} from './icons/figma';
import { ISLANDS_KEY } from './islands/types';

// "upload" (the old Upload Asset screen) was removed: it duplicated the CSV
// import that Upload CSV already does, and having two doors to the same job
// meant guessing which one was current. Its CSV template moved into CsvViewer.
export type AdminTab = "csv-viewer" | "manual-input" | "manage" | "analytics" | "backup" | "hard-reset" | "settings" | "about-image";

/**
 * The key is the value the rest of the app filters on and must keep matching
 * getAssetCounts(); the title is only ever displayed. They diverged in 2.0 —
 * the design renames "All Assets" to "All" and "Spot Illus" to "Spot
 * Illustration" — so callers pass keys around and labels stay cosmetic.
 */
interface SidebarNavItem {
  key: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  count?: number;
  danger?: boolean;
}

interface SharedSidebarProps {
  onNavigateBack?: () => void;
  onNavigateToAssetManagement?: () => void;
  onCategoryClick: (categoryKey: string) => void;
  assetCounts: Record<string, number>;
  assets: Asset[];
  loading: boolean;
  error: string | null;
  dataSource: string;
  handleRefresh: () => void;
  showBackButton?: boolean;
  /** Which item is currently highlighted, by key. */
  selectedCategory?: string;
  onRequestSuperuserLogin?: () => void;
  onOpenAbout?: () => void;
  // Admin-mode navigation — when mode="admin", the sidebar shows Admin submenu
  // items (Upload CSV, Manage, Analytics, etc.) instead of the asset-type list.
  mode?: "dashboard" | "admin";
  activeAdminTab?: AdminTab;
  onAdminTabChange?: (tab: AdminTab) => void;
}

export function SharedSidebar({
  onNavigateBack,
  onNavigateToAssetManagement,
  onCategoryClick,
  assetCounts,
  selectedCategory,
  showBackButton = false,
  onRequestSuperuserLogin,
  onOpenAbout,
  mode = "dashboard",
  activeAdminTab,
  onAdminTabChange,
}: SharedSidebarProps) {
  const { open, isMobile, toggleSidebar } = useSidebar();
  const isAdminMode = mode === "admin";

  /*
   * `open` describes the DESKTOP collapse toggle and nothing else. Below 840px
   * ui/sidebar renders this as an 18rem Sheet and leaves `open` false, so every
   * layout branch written against `open` picked the icon-rail treatment and the
   * drawer came out as a column of centred icons with no labels.
   *
   * `collapsed` is the question those branches actually want to ask. A drawer is
   * never collapsed, so on mobile this is always false and the full layout wins.
   * `open` itself is still correct for the collapse trigger's hover rule, which
   * genuinely is about the desktop toggle.
   */
  const collapsed = !isMobile && !open;

  const assetTypeItems: SidebarNavItem[] = [
    { key: "All Assets", title: "All", icon: Compass03, count: assetCounts["All Assets"] || 0 },
    { key: "Spot Illus", title: "Spot Illustration", icon: Image01, count: assetCounts["Spot Illus"] || 0 },
    { key: "Micro Illustration", title: "Micro Illustration", icon: Cube01, count: assetCounts["Micro Illustration"] || 0 },
    { key: "Icons", title: "Icons", icon: Atom02, count: assetCounts["Icons"] || 0 },
    { key: "Supergraphic", title: "Supergraphic", icon: StickerCircle, count: assetCounts["Supergraphic"] || 0 },
    { key: "Other", title: "Other", icon: PuzzlePiece02, count: assetCounts["Other"] || 0 },
  ];

  const islandItem: SidebarNavItem = {
    key: ISLANDS_KEY,
    title: "Island",
    icon: Island,
    count: assetCounts[ISLANDS_KEY] || 0,
  };

  const adminItems: SidebarNavItem[] = [
    { key: "csv-viewer", title: "Upload CSV", icon: Upload },
    { key: "manual-input", title: "Manual Input", icon: Plus },
    { key: "manage", title: "Manage Asset", icon: Settings },
    { key: "analytics", title: "Analytics", icon: BarChart3 },
    { key: "backup", title: "Backup & Restore", icon: Download },
    { key: "about-image", title: "About Image", icon: Image },
  ];

  const adminDangerItems: SidebarNavItem[] = [
    { key: "hard-reset", title: "Hard Reset Database", icon: Trash2, danger: true },
  ];

  const adminSettingsItems: SidebarNavItem[] = [
    { key: "settings", title: "Settings", icon: KeyRound },
  ];

  const isItemActive = (item: SidebarNavItem) =>
    isAdminMode ? activeAdminTab === item.key : selectedCategory === item.key;

  const handleItemClick = (item: SidebarNavItem) => {
    if (isAdminMode) onAdminTabChange?.(item.key as AdminTab);
    else onCategoryClick(item.key);
  };

  const renderItem = (item: SidebarNavItem) => {
    const active = isItemActive(item);
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => handleItemClick(item)}
        title={collapsed ? item.title : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          // The icon carries its own colour, so it can only follow the row's
          // hover through a named group — a bare `group` would also match the
          // sidebar root's own `group` and light every icon at once.
          "group/nav flex w-full items-center gap-2 rounded-lg p-2 text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "justify-center" : "justify-start",
          active
            ? "bg-[var(--pp-bg-blue-low)] font-bold text-[var(--pp-text-active)]"
            : "hover:bg-accent/50 hover:font-bold",
          !active &&
            !item.danger &&
            "text-[var(--pp-text-low)] hover:text-[var(--pp-text-high)]",
          item.danger && !active && "text-destructive hover:bg-destructive/10",
          item.danger && active && "bg-destructive/10 text-destructive"
        )}
      >
        <item.icon
          className={cn(
            "size-5 shrink-0 transition-colors",
            !active &&
              !item.danger &&
              "text-[var(--pp-icon-low)] group-hover/nav:text-[var(--pp-icon-high)]"
          )}
        />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
            {item.count !== undefined && (
              // No weight of its own: it inherits the row's, so the count turns
              // bold with the label when the row is active or hovered.
              <span className="shrink-0 font-sans text-right text-sm">
                {item.count}
              </span>
            )}
          </>
        )}
      </button>
    );
  };

  return (
    // Transparent and border-free: in the design the sidebar sits directly on
    // the page's sunken surface, and the white content panel's own rounded edge
    // is what separates the two. A border here would read as a double rule.
    //
    // The rule is inline because the width comes from ui/sidebar's own
    // `group-data-[side=left]:border-r`. That variant compiles through :where(),
    // so a `border-r-0` utility would tie it on specificity and the winner
    // would come down to Tailwind's internal sort order rather than anything
    // written here.
    <Sidebar
      collapsible="icon"
      style={{ borderRightWidth: 0 }}
      className="[&_[data-sidebar=sidebar]]:bg-transparent"
    >
      {/*
        The collapse control is always on screen while the sidebar is expanded,
        and hides behind a hover on the logo once it is collapsed. Three details
        make that work rather than merely look right:

        NAMED GROUP. ui/sidebar puts a bare `group` on the sidebar root, and
        Tailwind's `group-hover:` matches ANY ancestor carrying `.group`, not
        the nearest one. A bare `group` here would reveal the control whenever
        the pointer was anywhere in the sidebar, which is not a hover on the
        logo. `group/logo` scopes it to this row.

        OPACITY, NOT MOUNTING. The control keeps its box in both states, so the
        logo cannot shift sideways when it appears, and `focus-visible` keeps it
        reachable by keyboard — a keyboard user never produces a hover.

        SWAP, NOT SIDE-BY-SIDE, WHEN COLLAPSED. The icon rail is 68px, and the
        logo mark plus the control plus its gap needs 64px of the 44px left
        inside the padding. So collapsed, the control sits on top of the logo
        and the two cross-fade; expanded, they sit side by side as drawn.
      */}
      <SidebarHeader className={cn("pb-5 pt-8", collapsed ? "px-3" : "px-4")}>
        <div
          className={cn(
            "group/logo relative flex items-center",
            collapsed ? "justify-center" : "justify-between"
          )}
        >
          <span className="flex items-center">
            <GiliLogo collapsed={collapsed} />
          </span>

          {/* The drawer has its own dismiss and no rail to collapse into, so the
              desktop toggle would only be a second way to close it. */}
          {!isMobile && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
              title={open ? "Collapse sidebar" : "Expand sidebar"}
              className={cn(
                "rounded-md p-0.5 text-[var(--pp-icon-low)] hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                open
                  ? "opacity-100"
                  : "absolute inset-0"
              )}
            >
              {/* Collapsed, the control is an invisible target laid over the
                  logo, and the logo itself stays put.
                  
                  It used to be an icon that faded in while the logo faded out.
                  That reads as a missing logo rather than as a swap: collapsing
                  leaves the pointer sitting exactly where the button was, so
                  the hover is already satisfied and the rail comes up blank
                  until you happen to move the mouse away. */}
              {open ? <LayoutLeft className="size-5" /> : null}
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className={cn("flex-1 gap-3 py-3", collapsed ? "px-3" : "px-4")}>
        {isAdminMode ? (
          <>
            <NavGroup label={collapsed ? null : "ADMIN MENU"}>{adminItems.map(renderItem)}</NavGroup>
            <Divider />
            <NavGroup label={collapsed ? null : "DANGER ZONE"}>
              {adminDangerItems.map(renderItem)}
            </NavGroup>
            <NavGroup label={null}>{adminSettingsItems.map(renderItem)}</NavGroup>
            {showBackButton && (
              <button
                type="button"
                onClick={onNavigateBack}
                className="mt-2 w-full rounded-lg p-2 text-left text-sm text-[var(--pp-text-low)] transition-colors hover:bg-accent/50"
              >
                {collapsed ? "←" : "← Back to dashboard"}
              </button>
            )}
          </>
        ) : (
          <>
            <NavGroup label={collapsed ? null : "ASSET TYPE"}>
              {assetTypeItems.map(renderItem)}
            </NavGroup>
            <Divider />
            {renderItem(islandItem)}
          </>
        )}
      </SidebarContent>

      {/* `items-center` matters only when collapsed: the user chip is a fixed
          size-8 box, and a fixed-width child in a stretch column pins itself to
          the left edge while the sync dot above it centres itself, which is what
          made the rail read crooked. */}
      <SidebarFooter className={cn("gap-2 p-4 pb-3", collapsed && "items-center px-3")}>
        <SyncStatusLine open={!collapsed} />
        <UserMenu
          collapsed={collapsed}
          onRequestLogin={() => onRequestSuperuserLogin?.()}
          onManageAssets={() => onNavigateToAssetManagement?.()}
          onOpenAbout={() => onOpenAbout?.()}
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function NavGroup({ label, children }: { label: string | null; children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-3">
      {label && <p className="text-sm font-bold text-[var(--pp-text-low)]">{label}</p>}
      <div className="flex w-full flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-border" />;
}
