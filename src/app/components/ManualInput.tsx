import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import {
  Plus,
  Trash2,
  Upload,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Search,
  Copy,
  ChevronDown,
  ChevronUp,
} from "./icons";
import { getExistingAssetIndex } from "../utils/appwriteApi";
import { useUploadJob } from "../context/UploadJobContext";
import {
  SELECTABLE_TYPES,
  deriveAssetName,
  detectType,
  cleanFilename,
  assetKey,
} from "../utils/assetNaming";
import { parsePastedAssets, type PasteParseResult } from "../utils/pasteParser";
import { toast } from "sonner";

/**
 * Add or update a handful of assets by hand.
 *
 * For 10-15 new links, writing a CSV is more ceremony than the job deserves. This
 * is the same operation with a form instead of a file: it goes through the exact
 * same import engine, so a manual entry and a CSV row are indistinguishable once
 * saved — same duplicate detection, same link-replacement, same snapshot republish.
 *
 * Rows are graded against the published library before you save, so you can see
 * what will be created, what will be relinked, and what will be skipped.
 */

type RowStatus = "new" | "replaced" | "unchanged" | "incomplete" | "duplicate" | "unknown";

interface Row {
  /** Stable key so React doesn't re-mount inputs as rows are added or removed. */
  key: string;
  nama_file: string;
  url_lightroom: string;
  asset_name: string;
  /** True once the user edits the name, so we stop overwriting it from the filename. */
  nameEdited: boolean;
  type: string;
  typeEdited: boolean;
}

let rowSeq = 0;
const blankRow = (): Row => ({
  key: `r${++rowSeq}`,
  nama_file: "",
  url_lightroom: "",
  asset_name: "",
  nameEdited: false,
  type: "Other",
  typeEdited: false,
});

export function ManualInput() {
  const job = useUploadJob();
  const [rows, setRows] = useState<Row[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [existingIndex, setExistingIndex] = useState<Map<string, string> | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  /**
   * Key of the row that should take focus.
   *
   * Done with autoFocus rather than a ref because this project is on React 18,
   * where a ref passed to a plain function component (which `Input` is) is
   * ignored with a warning — the focus call would have silently done nothing.
   * autoFocus fires on mount, and a new row is mounted exactly when we want it.
   */
  const [focusKey, setFocusKey] = useState<string | null>(null);

  /** The paste box: raw text, open/closed, and the last parse for its summary. */
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [lastPaste, setLastPaste] = useState<PasteParseResult | null>(null);

  // Check against the library on mount. Costs zero database reads — it resolves
  // from the published snapshot — so there's no reason to make the user ask.
  const check = async () => {
    setIsChecking(true);
    const res = await getExistingAssetIndex();
    setIsChecking(false);
    if (res.success && res.data) setExistingIndex(res.data);
    else toast.error("Couldn't read the library", { description: res.error });
  };

  useEffect(() => {
    void check();
  }, []);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /**
   * Typing a filename fills in the name and type — until you edit them yourself,
   * at which point your value wins and stops being overwritten on every keystroke.
   */
  const setFilename = (key: string, raw: string) => {
    const nama_file = cleanFilename(raw);
    setRows((prev) =>
      prev.map((r) =>
        r.key !== key
          ? r
          : {
              ...r,
              nama_file,
              asset_name: r.nameEdited ? r.asset_name : deriveAssetName(nama_file),
              type: r.typeEdited ? r.type : detectType(nama_file),
            }
      )
    );
  };

  const addRow = () => {
    const row = blankRow();
    setRows((prev) => [...prev, row]);
    setFocusKey(row.key); // so you can keep typing without reaching for the mouse
  };

  /**
   * Turn pasted spreadsheet text into rows.
   *
   * Appends rather than replaces, so a second paste extends the batch instead of
   * discarding the first — but drops the untouched blank scaffolding rows first,
   * otherwise every paste leaves three empty rows stranded in the middle.
   *
   * Name and type come from the same `deriveAssetName` / `detectType` pair the
   * typed path uses. That is the point of routing through them rather than
   * re-deriving here: a pasted row and a typed row must be indistinguishable once
   * they are in the form, or the two paths drift and only one of them stays right.
   */
  const applyPaste = () => {
    const result = parsePastedAssets(pasteText);
    setLastPaste(result);

    if (result.rows.length === 0) {
      toast.error("Nothing to read in that paste", {
        description:
          "Each line needs a filename and a link starting with http, separated by a tab or a comma.",
      });
      return;
    }

    const pasted: Row[] = result.rows.map((r) => {
      const nama_file = cleanFilename(r.nama_file);
      return {
        key: `r${++rowSeq}`,
        nama_file,
        url_lightroom: r.url_lightroom,
        asset_name: deriveAssetName(nama_file),
        nameEdited: false,
        type: detectType(nama_file),
        typeEdited: false,
      };
    });

    setRows((prev) => {
      const kept = prev.filter((r) => r.nama_file.trim() || r.url_lightroom.trim());
      return [...kept, ...pasted];
    });
    setPasteText("");

    toast.success(`${pasted.length} row${pasted.length === 1 ? "" : "s"} read from the paste`, {
      description:
        result.duplicateUrls.length > 0
          ? "One or more links are used by more than one filename — check the warning below before saving."
          : "Names and types filled in automatically. Everything stays editable.",
    });
  };

  const removeRow = (key: string) =>
    setRows((prev) => (prev.length === 1 ? [blankRow()] : prev.filter((r) => r.key !== key)));

  /** Rows with anything typed in them. Blank rows are scaffolding, not data. */
  const filledRows = useMemo(
    () => rows.filter((r) => r.nama_file.trim() || r.url_lightroom.trim()),
    [rows]
  );

  const statusOf = useMemo(() => {
    const seen = new Map<string, number>();
    filledRows.forEach((r) => {
      const n = assetKey(r.nama_file);
      if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
    });

    return (row: Row): RowStatus => {
      const name = row.nama_file.trim();
      const url = row.url_lightroom.trim();
      if (!name || !url) return "incomplete";
      // Two rows in this form claiming the same filename — the second would
      // silently overwrite the first, so flag it before saving rather than after.
      if ((seen.get(assetKey(name)) ?? 0) > 1) return "duplicate";
      if (!existingIndex) return "unknown";
      // assetKey(), not the raw name: the library may hold
      // `tds_ic_purchase_list_blue.png` while you typed a different case, or
      // left the `.png` off entirely. Matching exactly graded those as New, so
      // the link was never replaced and the import created a second row for one
      // artwork.
      const key = assetKey(name);
      if (!existingIndex.has(key)) return "new";
      return existingIndex.get(key) !== url ? "replaced" : "unchanged";
    };
  }, [filledRows, existingIndex]);

  /**
   * Links claimed by more than one filename in this form.
   *
   * A link used twice under two names imports without complaint and looks correct
   * in the grid, because both entries resolve to a real image — the wrong one for
   * one of them. It comes from a copy-paste slip in the source sheet and stays
   * invisible unless something goes looking, so this counts names per URL rather
   * than URLs per name.
   *
   * Deliberately kept OUT of RowStatus. Status decides what gets written, and a
   * shared link is not a reason to refuse to write: the same artwork does
   * legitimately serve two names sometimes, and only the person pasting knows
   * which case this is. Folding it into the status enum would have quietly made
   * those rows unsavable.
   */
  const sharedLinkUrls = useMemo(() => {
    const namesPerUrl = new Map<string, Set<string>>();
    filledRows.forEach((r) => {
      const url = r.url_lightroom.trim();
      const name = assetKey(r.nama_file);
      if (!url || !name) return;
      const set = namesPerUrl.get(url) ?? new Set<string>();
      set.add(name);
      namesPerUrl.set(url, set);
    });
    return new Set(
      [...namesPerUrl.entries()].filter(([, names]) => names.size > 1).map(([url]) => url)
    );
  }, [filledRows]);

  const sharedLinkGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    filledRows.forEach((r) => {
      const url = r.url_lightroom.trim();
      if (!sharedLinkUrls.has(url)) return;
      groups.set(url, [...(groups.get(url) ?? []), r.nama_file.trim()]);
    });
    return [...groups.entries()];
  }, [filledRows, sharedLinkUrls]);

  const counts = useMemo(() => {
    const c = { new: 0, replaced: 0, unchanged: 0, incomplete: 0, duplicate: 0, unknown: 0 };
    filledRows.forEach((r) => { c[statusOf(r)]++; });
    return c;
  }, [filledRows, statusOf]);

  const savable = counts.new + counts.replaced;
  const blocked = counts.duplicate > 0;

  const handleSave = async () => {
    if (blocked) {
      toast.error("Fix the duplicate filenames first");
      return;
    }
    const payload = filledRows
      .filter((r) => {
        const s = statusOf(r);
        return s === "new" || s === "replaced" || s === "unknown";
      })
      .map((r) => ({
        id: "",
        nama_file: r.nama_file.trim(),
        asset_name: (r.asset_name.trim() || deriveAssetName(r.nama_file)).trim(),
        url_lightroom: r.url_lightroom.trim(),
        type: r.type,
      }));

    if (payload.length === 0) {
      toast.info("Nothing to save", { description: "Every row is already in the library, unchanged." });
      return;
    }

    // The same engine the CSV importer uses: creates what's new, replaces changed
    // links, skips unchanged rows and republishes the snapshot afterwards.
    await job.start(payload, {
      label: `Manual input — ${payload.length} row${payload.length === 1 ? "" : "s"}`,
      updateExistingLink: true,
    });

    setRows([blankRow(), blankRow(), blankRow()]);
    await check();
  };

  const StatusBadge = ({ row }: { row: Row }) => {
    const s = statusOf(row);
    if (s === "incomplete") return <span className="text-xs text-muted-foreground">—</span>;
    if (s === "unknown") return <span className="text-xs text-muted-foreground">?</span>;
    if (s === "duplicate")
      return (
        <Badge
          variant="destructive"
          className="text-xs"
          title="Another row in this form has the same filename — capitalisation and the file extension don't make it a different one"
        >
          Duplicate
        </Badge>
      );
    if (s === "new")
      return (
        <Badge className="border-transparent bg-[var(--pp-bg-green-low)] text-[var(--pp-text-positive)] text-xs">
          New
        </Badge>
      );
    if (s === "replaced")
      return (
        <Badge
          className="border-transparent bg-[var(--pp-bg-blue-low)] text-[var(--pp-text-active)] text-xs"
          title="Already in the library with a different link — the link will be replaced"
        >
          Replaced
        </Badge>
      );
    return (
      <Badge variant="secondary" className="text-xs text-muted-foreground" title="Already in the library, identical">
        Unchanged
      </Badge>
    );
  };

  return (
    <div className="flex-1 space-y-6 p-6 max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Manual Input
          </CardTitle>
          <CardDescription>
            Add a few assets without making a CSV. Type a filename — or paste the filename and
            link columns straight out of a spreadsheet — and the name and type fill themselves in,
            both still editable. Filenames are matched against the library ignoring capitalisation
            and the file extension, so <code>tds_ic_purchase_list_blue</code> finds an existing{" "}
            <code>tds_ic_purchase_list_blue.png</code> instead of adding a second copy of it.
            Saving uses the same import as Upload CSV, so duplicates and changed links behave
            identically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {isChecking ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Checking the library…
              </span>
            ) : existingIndex ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-[var(--pp-text-positive)]" />
                Checked against {existingIndex.size.toLocaleString("en-US")} assets — 0 database reads
              </span>
            ) : (
              <span className="text-muted-foreground">Library not loaded.</span>
            )}
            <Button variant="ghost" size="sm" onClick={check} disabled={isChecking}>
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Re-check
            </Button>
          </div>

          {/*
            Paste from a spreadsheet.

            Closed by default and folded into this tab rather than given a menu
            entry of its own: it produces exactly the rows below it, so it is a
            faster way to fill this form, not a separate operation. A second
            Superuser menu item would have implied otherwise.
          */}
          <div className="rounded-[8px] border">
            <button
              type="button"
              onClick={() => setPasteOpen((o) => !o)}
              className="flex w-full items-center gap-2 p-3 text-left text-sm font-medium hover:bg-muted/50"
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
              Paste from a spreadsheet
              <span className="font-normal text-muted-foreground">— filename and link columns</span>
              {pasteOpen ? (
                <ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {pasteOpen && (
              <div className="space-y-3 border-t p-3">
                <p className="text-xs text-muted-foreground">
                  Copy the filename and link columns straight out of Sheets, Numbers or the
                  Appwrite console and paste them here. Title and header lines above the data are
                  ignored, and the columns can be in either order — whichever cell starts with
                  <code className="mx-1">http</code>is treated as the link.
                </p>

                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  placeholder={
                    "ot_bt_cc_hero_card.png\thttps://s-light.tiket.photos/…\not_bt_cc_hero_travel.png\thttps://s-light.tiket.photos/…"
                  }
                  className="font-mono text-xs"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add as rows
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPasteText("");
                      setLastPaste(null);
                    }}
                    disabled={!pasteText.trim() && !lastPaste}
                  >
                    Clear
                  </Button>
                </div>

                {lastPaste && (
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <p>
                      Read {lastPaste.rows.length} row
                      {lastPaste.rows.length === 1 ? "" : "s"}
                      {lastPaste.ignored.length > 0 &&
                        ` · skipped ${lastPaste.ignored.length} header or title line${
                          lastPaste.ignored.length === 1 ? "" : "s"
                        }`}
                    </p>
                    {lastPaste.incomplete.length > 0 && (
                      <p className="text-[var(--pp-text-alert)]">
                        {lastPaste.incomplete.length} line
                        {lastPaste.incomplete.length === 1 ? "" : "s"} had a filename or a link but
                        not both, and {lastPaste.incomplete.length === 1 ? "was" : "were"} left out
                        {lastPaste.incomplete.length <= 5 &&
                          ` (line ${lastPaste.incomplete.map((i) => i.line).join(", ")})`}
                        .
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rows */}
          <div className="space-y-3">
            {/* Column headers, desktop only — on mobile each field is labelled inline. */}
            <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[1.3fr_1.5fr_1.1fr_150px_90px_36px]">
              <div>nama_file</div>
              <div>url_lightroom</div>
              <div>asset_name (auto)</div>
              <div>Type</div>
              <div>Status</div>
              <div />
            </div>

            {rows.map((row) => (
              <div
                key={row.key}
                className="grid gap-2 rounded-[8px] border p-3 lg:grid-cols-[1.3fr_1.5fr_1.1fr_150px_90px_36px] lg:items-center lg:border-0 lg:p-0"
              >
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground lg:hidden">nama_file</label>
                  <Input
                    autoFocus={row.key === focusKey}
                    value={row.nama_file}
                    onChange={(e) => setFilename(row.key, e.target.value)}
                    placeholder="tds_ic_train_blue"
                    className="min-w-0"
                    size={1}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted-foreground lg:hidden">url_lightroom</label>
                  <Input
                    value={row.url_lightroom}
                    onChange={(e) => update(row.key, { url_lightroom: e.target.value.trim() })}
                    placeholder="https://s-light.tiket.photos/…"
                    className="min-w-0"
                    size={1}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted-foreground lg:hidden">asset_name</label>
                  <Input
                    value={row.asset_name}
                    onChange={(e) => update(row.key, { asset_name: e.target.value, nameEdited: true })}
                    placeholder="fills in automatically"
                    className="min-w-0"
                    size={1}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-muted-foreground lg:hidden">Type</label>
                  <Select
                    value={row.type}
                    onValueChange={(v) => update(row.key, { type: v, typeEdited: true })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SELECTABLE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground lg:hidden">Status</span>
                  <StatusBadge row={row} />
                  {sharedLinkUrls.has(row.url_lightroom.trim()) && (
                    <span
                      className="text-[var(--pp-text-alert)]"
                      title="Another row uses this exact link under a different filename"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(row.key)}
                  className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  title="Remove this row"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <Button variant="outline" onClick={addRow} className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add another row
          </Button>

          {/* Summary */}
          {filledRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-muted/50 p-3 text-sm">
              {counts.new > 0 && <Badge className="border-transparent bg-[var(--pp-bg-green-low)] text-[var(--pp-text-positive)]">{counts.new} new</Badge>}
              {counts.replaced > 0 && <Badge className="border-transparent bg-[var(--pp-bg-blue-low)] text-[var(--pp-text-active)]">{counts.replaced} link replaced</Badge>}
              {counts.unchanged > 0 && <Badge variant="secondary">{counts.unchanged} unchanged</Badge>}
              {counts.incomplete > 0 && <Badge variant="secondary">{counts.incomplete} incomplete</Badge>}
              {counts.duplicate > 0 && <Badge variant="destructive">{counts.duplicate} duplicate</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">
                {savable} row{savable === 1 ? "" : "s"} will be written
              </span>
            </div>
          )}

          {blocked && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Two or more rows have the same <code>nama_file</code>. Capitalisation and the file
                extension don't make it a different asset, so <code>foo</code> and{" "}
                <code>foo.png</code> count as one. Saving them would create duplicate entries in
                the library — remove or rename one before saving.
              </AlertDescription>
            </Alert>
          )}

          {sharedLinkGroups.length > 0 && (
            <Alert className="border-transparent bg-[var(--pp-bg-orange-low)]">
              <AlertCircle className="h-4 w-4 text-[var(--pp-text-alert)]" />
              <AlertDescription className="space-y-1.5 text-sm">
                <p>
                  {sharedLinkGroups.length === 1 ? "One link is" : `${sharedLinkGroups.length} links are`}{" "}
                  used by more than one filename. Both entries will save and both will display —
                  showing the same artwork. If that is not deliberate, one of these links was
                  copied into the wrong cell.
                </p>
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {sharedLinkGroups.map(([url, names]) => (
                    <li key={url}>{names.join(" and ")}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {counts.incomplete > 0 && !blocked && (
            <p className="text-xs text-muted-foreground">
              {counts.incomplete} row{counts.incomplete === 1 ? " is" : "s are"} missing a filename or
              a link and will be skipped.
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            onClick={handleSave}
            disabled={job.isActive || blocked || savable === 0}
          >
            <Upload className="mr-2 h-4 w-4" />
            {savable === 0 ? "Nothing to save yet" : `Save ${savable} asset${savable === 1 ? "" : "s"}`}
          </Button>

          <p className="text-xs text-muted-foreground">
            Costs {savable} write{savable === 1 ? "" : "s"} and no database reads. New assets are
            created, changed links are replaced on the existing entry, and identical rows are left
            alone. The published library updates itself afterwards, so everyone else sees the change
            on their next reload.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
