import { useMemo } from "react";
import { Loader2 } from "../icons";
import { type Asset } from "../../utils/appwriteApi";
import { type HarborIsland } from "../../utils/harbor";
import { IslandCard } from "./IslandCard";
import { exportIslandAssets } from "./exportIsland";

interface HarborBrowserProps {
  assets: Asset[];
  islands: HarborIsland[];
  loading: boolean;
  onSelectIsland: (island: HarborIsland) => void;
}

/**
 * The Harbor, as everyone but the superuser sees it.
 *
 * Deliberately not IslandManager with the buttons taken out. That component's
 * whole reason to exist is the create/rename/delete flow — three dialogs and the
 * state behind them — none of which belongs on a screen where the collections
 * arrive read-only from Storage. What the two genuinely share is the card and the
 * export, and those are imported rather than reimplemented.
 */
export function HarborBrowser({
  assets,
  islands,
  loading,
  onSelectIsland,
}: HarborBrowserProps) {
  // One lookup for the whole grid, as in IslandManager: resolving members per
  // card is a full scan of every asset per island, per render.
  const assetsByFile = useMemo(() => {
    const map = new Map<string, Asset>();
    assets.forEach((a) => map.set(a.nama_file, a));
    return map;
  }, [assets]);

  // Members are resolved against the library the client already has, so an asset
  // deleted since the collection was published just stops appearing.
  const membersOf = (island: HarborIsland) =>
    island.asset_ids.map((id) => assetsByFile.get(id)).filter((a): a is Asset => Boolean(a));

  if (loading) {
    return (
      <div className="flex animate-in flex-col items-center justify-center gap-4 py-20 text-center fade-in duration-300">
        <Loader2 className="size-10 animate-spin text-[var(--pp-brand-blue)]" />
        <p className="text-sm text-muted-foreground">Loading the harbor…</p>
      </div>
    );
  }

  if (islands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <img
          src="/assets/micro-illus/tds_mi_search_no_island.png"
          alt=""
          aria-hidden="true"
          className="mb-6 size-[60px] object-contain"
        />
        <h3 className="pp-h3 mb-2 text-[var(--pp-text-high)]">The harbor is empty</h3>
        <p className="max-w-[24rem] text-base leading-[1.38] text-[var(--pp-text-mid)]">
          These shelves are put together by the design team. Once they publish one, it shows up
          here for everyone.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Ready-made collections from the design team — a good place to start when you don't know
        what an asset is called yet.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {islands.map((island) => (
          <IslandCard
            key={island.id}
            island={island}
            members={membersOf(island)}
            onOpen={() => onSelectIsland(island)}
            /* Exports only. Rename and delete are the superuser's, and passing
               them here is what would make these editable. */
            onExportCsv={() => exportIslandAssets(island, membersOf(island), "csv")}
            onExportTxt={() => exportIslandAssets(island, membersOf(island), "txt")}
          />
        ))}
      </div>
    </div>
  );
}
