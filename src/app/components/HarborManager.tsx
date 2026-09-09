import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import { AlertCircle, ArrowLeft, Check, Grid3X3, List, Loader2, Plus, Trash2, X } from "./icons";
import { SearchLg } from "./icons/figma";
import { cn } from "./ui/utils";
import { useAssetData } from "./hooks/useAssetData";
import { searchAssets, type Asset } from "../utils/appwriteApi";
import { fetchHarborIslands, publishHarborIslands, type HarborIsland } from "../utils/harbor";

/**
 * How many search hits to draw at once. The library runs to thousands, and
 * every row carries a thumbnail, so this is a rendering budget rather than a
 * meaningful limit — the search box is how you get to the rest.
 */
const RESULT_LIMIT = 100;

type PickerLayout = "list" | "grid";

/**
 * Superuser screen for the Harbor.
 *
 * Edits are held locally and written in one go, rather than publishing on every
 * keystroke: a publish replaces the whole file, and assembling a collection is
 * dozens of small changes in a row. So the screen carries an explicit
 * Publish — which also means a half-built shelf is never visible to anyone.
 */
export function HarborManager() {
  const { assets, loading: assetsLoading } = useAssetData();

  const [islands, setIslands] = useState<HarborIsland[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<PickerLayout>("list");
  const [toDelete, setToDelete] = useState<HarborIsland | null>(null);

  useEffect(() => {
    fetchHarborIslands()
      .then(setIslands)
      .finally(() => setLoading(false));
  }, []);

  const editing = islands.find((i) => i.id === editingId) ?? null;

  const assetsByFile = useMemo(() => {
    const map = new Map<string, Asset>();
    assets.forEach((a) => map.set(a.nama_file, a));
    return map;
  }, [assets]);

  const apply = (next: HarborIsland[] | ((prev: HarborIsland[]) => HarborIsland[])) => {
    setIslands(next);
    setDirty(true);
  };

  const patchEditing = (patch: Partial<HarborIsland>) => {
    if (!editingId) return;
    apply((prev) =>
      prev.map((i) =>
        i.id === editingId ? { ...i, ...patch, updated_at: new Date().toISOString() } : i
      )
    );
  };

  const createIsland = () => {
    const now = new Date().toISOString();
    const island: HarborIsland = {
      id: `harbor-${Date.now()}`,
      name: "Untitled collection",
      asset_ids: [],
      created_at: now,
      updated_at: now,
    };
    apply([...islands, island]);
    setEditingId(island.id);
    setQuery("");
  };

  const deleteIsland = () => {
    if (!toDelete) return;
    apply(islands.filter((i) => i.id !== toDelete.id));
    if (editingId === toDelete.id) setEditingId(null);
    setToDelete(null);
  };

  /*
   * Derived from the island as it stands at the moment the click lands, rather
   * than from the render that drew the row: adding twenty assets is twenty
   * clicks in quick succession, and reading the closure would drop any that
   * land inside the same render.
   */
  const toggleMember = (nama_file: string) => {
    if (!editingId) return;
    apply((prev) =>
      prev.map((i) =>
        i.id === editingId
          ? {
              ...i,
              asset_ids: i.asset_ids.includes(nama_file)
                ? i.asset_ids.filter((id) => id !== nama_file)
                : [...i.asset_ids, nama_file],
              updated_at: new Date().toISOString(),
            }
          : i
      )
    );
  };

  const publish = async () => {
    const unnamed = islands.find((i) => !i.name.trim());
    if (unnamed) {
      toast.error("Every collection needs a name", {
        description: "Name the untitled collection before publishing.",
      });
      return;
    }

    setPublishing(true);
    setError(null);
    const result = await publishHarborIslands(islands);
    setPublishing(false);

    if (!result.success) {
      setError(result.error || "Could not publish the harbor.");
      return;
    }
    setDirty(false);
    toast.success("Harbor published", {
      description: `${islands.length} ${islands.length === 1 ? "collection is" : "collections are"} now visible to everyone.`,
    });
  };

  const results = useMemo(() => {
    if (!editing) return [];
    const pool = query.trim() ? searchAssets(assets, query) : assets;
    return pool.slice(0, RESULT_LIMIT);
  }, [assets, query, editing]);

  const members = editing
    ? editing.asset_ids
        .map((id) => assetsByFile.get(id))
        .filter((a): a is Asset => Boolean(a))
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Loading the published harbor…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl flex-1 space-y-6 p-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* One publish bar for the whole screen, whichever view is showing —
          otherwise leaving the editor looks like it discarded the edits. */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-[var(--pp-bg-sunken)] p-4">
        <p className="text-sm text-muted-foreground">
          {dirty
            ? "You have changes that nobody else can see yet."
            : "Everything here is published and live."}
        </p>
        <Button onClick={publish} disabled={!dirty || publishing} className="shrink-0">
          {publishing ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {publishing ? "Publishing…" : "Publish changes"}
        </Button>
      </div>

      {editing ? (
        <>
          <Button variant="ghost" onClick={() => setEditingId(null)} className="-ml-2">
            <ArrowLeft className="mr-2 size-4" />
            All collections
          </Button>

          <Card>
            <CardHeader>
              <CardTitle>Collection details</CardTitle>
              <CardDescription>
                The name is what everyone sees in the Harbor menu.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="harbor-name">Name</Label>
                <Input
                  id="harbor-name"
                  value={editing.name}
                  onChange={(e) => patchEditing({ name: e.target.value })}
                  placeholder="Product icons, Payment illustrations…"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="harbor-description">Description (optional)</Label>
                <Textarea
                  id="harbor-description"
                  value={editing.description || ""}
                  onChange={(e) => patchEditing({ description: e.target.value || undefined })}
                  placeholder="What belongs on this shelf?"
                  className="mt-1"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Assets in this collection ({editing.asset_ids.length})
              </CardTitle>
              <CardDescription>
                Search the library and click an asset to add or remove it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {members.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {members.map((asset) => (
                    <button
                      key={asset.nama_file}
                      type="button"
                      onClick={() => toggleMember(asset.nama_file)}
                      title="Remove from this collection"
                      className="flex items-center gap-1.5 rounded-full border border-border bg-[var(--pp-chip-selected-bg)] py-1 pl-2 pr-1.5 text-sm text-[var(--pp-chip-selected-fg)] transition-colors hover:bg-accent"
                    >
                      <span className="max-w-[16rem] truncate">{asset.nama_file}</span>
                      <X className="size-3.5 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* An id in the collection that no longer resolves to an asset:
                  worth reporting here, because on the guest side it silently
                  disappears from the shelf. */}
              {editing.asset_ids.length > members.length && !assetsLoading && (
                <p className="text-xs text-[var(--pp-text-alert)]">
                  {editing.asset_ids.length - members.length} asset(s) in this collection are no
                  longer in the library and won't be shown.
                </p>
              )}

              <div className="flex items-center gap-2">
                <div className="flex h-[42px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-[var(--gili-search-surface)] px-3">
                  <SearchLg className="size-5 shrink-0 text-[var(--pp-icon-low)]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search assets to add…"
                    aria-label="Search assets to add"
                    className="min-w-0 flex-1 bg-transparent text-base leading-[1.38] text-foreground outline-none placeholder:text-[var(--pp-text-disabled)]"
                  />
                </div>

                {/* Two ways to look at the same hits: the list names every file,
                    which is how you tell near-identical variants apart, and the
                    grid shows enough artwork at once to pick by eye. */}
                <div
                  role="group"
                  aria-label="Result layout"
                  className="flex h-[42px] shrink-0 items-center gap-1 rounded-lg border border-border p-1"
                >
                  <LayoutButton
                    label="List"
                    active={layout === "list"}
                    onClick={() => setLayout("list")}
                  >
                    <List className="size-4" />
                  </LayoutButton>
                  <LayoutButton
                    label="Grid"
                    active={layout === "grid"}
                    onClick={() => setLayout("grid")}
                  >
                    <Grid3X3 className="size-4" />
                  </LayoutButton>
                </div>
              </div>

              {assetsLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading the library…
                </div>
              ) : results.length === 0 ? (
                <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  Nothing matches "{query}".
                </p>
              ) : layout === "list" ? (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {results.map((asset) => {
                    const inCollection = editing.asset_ids.includes(asset.nama_file);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggleMember(asset.nama_file)}
                        className="flex w-full items-center gap-3 p-2 text-left transition-colors hover:bg-accent/50"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded bg-[var(--pp-bg-sunken)] p-1">
                          <ImageWithFallback
                            src={asset.url_lightroom}
                            alt=""
                            className="size-full object-contain"
                          />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">
                            {asset.asset_name || asset.nama_file}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {asset.nama_file}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className={
                            inCollection
                              ? "text-[var(--pp-icon-positive)]"
                              : "text-[var(--pp-icon-low)]"
                          }
                        >
                          {inCollection ? <Check className="size-5" /> : <Plus className="size-5" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {results.map((asset) => {
                    const inCollection = editing.asset_ids.includes(asset.nama_file);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggleMember(asset.nama_file)}
                        // The border carries the selected state here: a corner
                        // tick alone is easy to miss against busy artwork.
                        className={cn(
                          "group flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
                          inCollection
                            ? "border-[var(--pp-brand-blue)] bg-[var(--pp-chip-selected-bg)]"
                            : "border-border hover:bg-accent/50"
                        )}
                      >
                        <span className="relative flex aspect-square items-center justify-center rounded bg-[var(--pp-bg-sunken)] p-2">
                          <ImageWithFallback
                            src={asset.url_lightroom}
                            alt=""
                            className="size-full object-contain"
                          />
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute right-1 top-1 flex size-6 items-center justify-center rounded-full",
                              inCollection
                                ? "bg-[var(--pp-brand-blue)] text-white"
                                : "bg-[var(--pp-bg-base)] text-[var(--pp-icon-low)]"
                            )}
                          >
                            {inCollection ? (
                              <Check className="size-4" />
                            ) : (
                              <Plus className="size-4" />
                            )}
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {asset.asset_name || asset.nama_file}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {asset.nama_file}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!assetsLoading && results.length === RESULT_LIMIT && (
                <p className="text-xs text-muted-foreground">
                  Showing the first {RESULT_LIMIT} matches — narrow the search to see more.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Collections</CardTitle>
            <CardDescription>
              The Harbor is a set of read-only shelves everyone can browse. Someone who doesn't
              know what an asset is called can find it here instead of guessing at the search box.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {islands.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing moored yet.
              </p>
            ) : (
              islands.map((island) => (
                <div
                  key={island.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {island.name || "Untitled collection"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {island.asset_ids.length}{" "}
                      {island.asset_ids.length === 1 ? "asset" : "assets"}
                      {island.description ? ` · ${island.description}` : ""}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setEditingId(island.id)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setToDelete(island)}
                    aria-label={`Delete ${island.name}`}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}

            <Button variant="outline" onClick={createIsland} className="w-full">
              <Plus className="mr-2 size-4" />
              New collection
            </Button>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{toDelete?.name}"? The assets stay in the library — only this shelf goes
              away. It disappears for everyone once you publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteIsland}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LayoutButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${label} view`}
      aria-label={`${label} view`}
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-[var(--pp-chip-selected-bg)] text-[var(--pp-chip-selected-fg)]"
          : "text-[var(--pp-icon-low)] hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
