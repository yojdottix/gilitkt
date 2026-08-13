import { useMemo, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Plus } from "../icons";
import { toast } from "sonner";
import { type Asset } from "../../utils/appwriteApi";
import { IslandCard } from "./IslandCard";
import { exportIslandAssets } from "./exportIsland";
import { type Island } from "./types";

interface IslandManagerProps {
  assets: Asset[];
  islands: Island[];
  onUpdateIslands: (islands: Island[]) => void;
  onSelectIsland: (island: Island | null) => void;
  selectedIsland?: Island | null;
}

export function IslandManager({
  assets,
  islands,
  onUpdateIslands,
  onSelectIsland,
  selectedIsland,
}: IslandManagerProps) {
  const [editing, setEditing] = useState<Island | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [islandToDelete, setIslandToDelete] = useState<Island | null>(null);

  // One lookup for the whole grid. Resolving members per card meant a full scan
  // of every asset for every island on every render — O(islands x assets) on a
  // list that runs to thousands.
  const assetsByFile = useMemo(() => {
    const map = new Map<string, Asset>();
    assets.forEach((a) => map.set(a.nama_file, a));
    return map;
  }, [assets]);

  const membersOf = (island: Island) =>
    island.asset_ids.map((id) => assetsByFile.get(id)).filter((a): a is Asset => Boolean(a));

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormDescription("");
    setIsFormOpen(true);
  };

  const openRename = (island: Island) => {
    setEditing(island);
    setFormName(island.name);
    setFormDescription(island.description || "");
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setFormName("");
    setFormDescription("");
  };

  const handleSubmit = () => {
    const name = formName.trim();
    if (!name) {
      toast.error("Island name is required");
      return;
    }
    const description = formDescription.trim() || undefined;
    const now = new Date().toISOString();

    if (editing) {
      onUpdateIslands(
        islands.map((i) =>
          i.id === editing.id ? { ...i, name, description, updated_at: now } : i
        )
      );
      toast.success("Island updated", { description: `"${name}" has been updated.` });
    } else {
      onUpdateIslands([
        ...islands,
        { id: `island-${Date.now()}`, name, description, asset_ids: [], created_at: now, updated_at: now },
      ]);
      toast.success("Island created", { description: `"${name}" is ready for assets.` });
    }
    closeForm();
  };

  const handleDelete = () => {
    if (!islandToDelete) return;
    onUpdateIslands(islands.filter((i) => i.id !== islandToDelete.id));
    if (selectedIsland?.id === islandToDelete.id) onSelectIsland(null);
    toast.success("Island deleted", {
      description: `"${islandToDelete.name}" has been removed. Its assets are untouched.`,
    });
    setIslandToDelete(null);
  };

  const exportIsland = (island: Island, format: "csv" | "txt") =>
    exportIslandAssets(island, membersOf(island), format);

  return (
    <div className="space-y-6">
      {/* Rendered only when there is something to describe. On an empty page
          this row and the empty state offered the same action twice, so it is
          removed from the layout rather than hidden — hiding it left its gap
          and its grid gutter behind. */}
      {islands.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Islands are your own shelves: group assets by campaign, theme, or anything else.
          </p>
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="mr-2 size-4" />
            New island
          </Button>
        </div>
      )}

      {islands.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <img
            src="/assets/micro-illus/tds_mi_search_no_island.png"
            alt=""
            aria-hidden="true"
            className="mb-6 size-[60px] object-contain"
          />
          <h3 className="pp-h3 mb-2 text-[var(--pp-text-high)]">No islands found yet</h3>
          <p className="mb-6 max-w-[22rem] text-base leading-[1.38] text-[var(--pp-text-mid)]">
            Set sail and create your first island to organize your assets 🏝️
          </p>
          <Button size="lg" onClick={openCreate} className="min-w-[280px]">
            New island
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {islands.map((island) => (
            <IslandCard
              key={island.id}
              island={island}
              members={membersOf(island)}
              onOpen={() => onSelectIsland(island)}
              onRename={() => openRename(island)}
              onExportCsv={() => exportIsland(island, "csv")}
              onExportTxt={() => exportIsland(island, "txt")}
              onDelete={() => setIslandToDelete(island)}
            />
          ))}
        </div>
      )}

      {/* One dialog for create and rename — they ask for exactly the same two
          fields, and two near-identical dialogs drift apart over time. */}
      <Dialog open={isFormOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Rename Island" : "Create New Island"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the island's name and description."
                : "Name your island now; you can add assets to it from any card."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="island-name">Island Name</Label>
              <Input
                id="island-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="Enter island name…"
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="island-description">Description (Optional)</Label>
              <Textarea
                id="island-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What is this island for?"
                className="mt-1"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formName.trim()}>
              {editing ? "Save changes" : "Create Island"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!islandToDelete} onOpenChange={(open) => !open && setIslandToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Island</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{islandToDelete?.name}"? This can't be undone. The assets themselves stay in
              the library — only the grouping goes away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Island
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
