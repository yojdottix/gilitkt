import { useState, useRef, useMemo } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Alert, AlertDescription } from "./ui/alert";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./ui/table";
import {
  FileText, Upload, Download, CheckCircle, AlertCircle, Database, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, ArrowUp, ArrowDown, Search, Copy, RefreshCw,
} from "./icons";
import { parseCSV, ParsedAsset } from "../utils/csvParser";
import { getExistingAssetIndex } from "../utils/appwriteApi";
import { assetKey } from "../utils/assetNaming";
import { useUploadJob } from "../context/UploadJobContext";
import { copyWithFeedback } from "../utils/clipboard";
import { toast } from "sonner";

const VIEW_PAGE_SIZE = 100;

// "replaced" = filename already in the database, but the CSV carries a different
// url_lightroom, i.e. the asset was re-uploaded to Lightroom. Distinguishing it
// from an untouched duplicate is the whole point: without it, a redesigned asset
// is indistinguishable from a row that needs nothing.
type RowStatus = "new" | "replaced" | "existing" | "unknown";
type SelectionMode = "new" | "manual" | "range";
type StatusFilter = "all" | "new" | "replaced" | "existing";

/**
 * Collapse a sorted list of row numbers into readable ranges.
 * [1,2,3,7,9,10] -> "1-3, 7, 9-10"
 * Makes "which rows are missing?" answerable at a glance instead of as a wall
 * of 300 comma-separated numbers.
 */
function formatRowRanges(nums: number[], maxParts = 40): string {
  if (nums.length === 0) return "-";
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  if (parts.length <= maxParts) return parts.join(", ");
  return `${parts.slice(0, maxParts).join(", ")} … (+${parts.length - maxParts} more groups)`;
}

export function CsvViewer() {
  const job = useUploadJob();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedAssets, setParsedAssets] = useState<ParsedAsset[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [viewPage, setViewPage] = useState(1);
  const [jumpToPageInput, setJumpToPageInput] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // --- Database checker ---
  // null = not checked yet. A Map (even an empty one) = we have a real answer.
  // Maps nama_file -> the url_lightroom currently stored, so a row can be graded
  // as new / replaced / unchanged rather than just present-or-absent.
  const [existingIndex, setExistingIndex] = useState<Map<string, string> | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);

  // --- Selection ---
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("range");
  const [manualSelected, setManualSelected] = useState<Set<number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Range inputs stay as raw text so they can be cleared and retyped freely.
  const [fromRowInput, setFromRowInput] = useState("1");
  const [toRowInput, setToRowInput] = useState("");

  const [updateExistingType, setUpdateExistingType] = useState(false);
  // On by default, unlike type: a changed link means the underlying file changed,
  // so keeping the old (retired) URL is a bug, not a conservative default.
  const [updateExistingLink, setUpdateExistingLink] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const total = parsedAssets.length;

  /** Blank CSV in the exact shape the parser expects. */
  const downloadTemplate = () => {
    const template = `nama_file,url_lightroom,category
tds_si_example_illustration.png,https://example.com/image1.jpg,Spot
tds_mi_sample_icon.png,https://example.com/image2.jpg,Micro
tds_ic_menu_icon.png,https://example.com/image3.jpg,Icon
custom_graphic.png,https://example.com/image4.jpg,Supergraphic`;

    const blob = new Blob([template], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asset_upload_template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const rowStatus = (rowNo: number): RowStatus => {
    if (!existingIndex) return "unknown";
    const row = parsedAssets[rowNo - 1];
    const name = row?.nama_file?.trim();
    if (!name) return "unknown";
    // assetKey(), not the raw name — see assetNaming. Comparing exactly meant a
    // re-upload spelled `Halim.png` against a stored `halim.png`, or a row
    // written without its `.png`, was graded New — so its link was never
    // replaced and the import duplicated the asset.
    const key = assetKey(name);
    if (!existingIndex.has(key)) return "new";
    const storedUrl = existingIndex.get(key) ?? "";
    const incomingUrl = row?.url_lightroom?.trim() ?? "";
    // Lightroom issues a fresh URL per upload, so a changed link means the file
    // itself was replaced. An identical link means nothing to do.
    return incomingUrl && incomingUrl !== storedUrl ? "replaced" : "existing";
  };

  const newRowNos = useMemo(() => {
    if (!existingIndex) return [];
    const out: number[] = [];
    parsedAssets.forEach((_row, i) => {
      if (rowStatus(i + 1) === "new") out.push(i + 1);
    });
    return out;
  }, [parsedAssets, existingIndex]);

  /** Filename matches but the link changed — a re-upload. */
  const replacedRowNos = useMemo(() => {
    if (!existingIndex) return [];
    const out: number[] = [];
    parsedAssets.forEach((_row, i) => {
      if (rowStatus(i + 1) === "replaced") out.push(i + 1);
    });
    return out;
  }, [parsedAssets, existingIndex]);

  /** Matches an existing row with the same link — nothing to do. */
  const existingRowNos = useMemo(() => {
    if (!existingIndex) return [];
    const out: number[] = [];
    parsedAssets.forEach((_row, i) => {
      if (rowStatus(i + 1) === "existing") out.push(i + 1);
    });
    return out;
  }, [parsedAssets, existingIndex]);

  // Rows tagged with their permanent CSV row number BEFORE sorting/filtering, so
  // the displayed number always matches what gets imported.
  const numberedRows = useMemo(
    () => parsedAssets.map((row, idx) => ({ row, rowNo: idx + 1 })),
    [parsedAssets]
  );

  const visibleRows = useMemo(() => {
    let rows = numberedRows;
    if (existingIndex && statusFilter !== "all") {
      rows = rows.filter(({ rowNo }) => rowStatus(rowNo) === statusFilter);
    }
    return sortDir === "asc" ? rows : [...rows].reverse();
  }, [numberedRows, sortDir, statusFilter, existingIndex]);

  const totalViewPages = Math.max(1, Math.ceil(visibleRows.length / VIEW_PAGE_SIZE));
  const safeViewPage = Math.min(viewPage, totalViewPages);
  const viewStart = (safeViewPage - 1) * VIEW_PAGE_SIZE;
  const pageRows = useMemo(
    () => visibleRows.slice(viewStart, viewStart + VIEW_PAGE_SIZE),
    [visibleRows, viewStart]
  );

  const toggleSortDir = () => {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    setViewPage(1);
  };

  const handleFile = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setParseErrors(["Please select a CSV file"]);
      return;
    }

    setSelectedFile(file);
    job.reset();

    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });

    const { assets, errors } = parseCSV(content);
    setParsedAssets(assets);
    setParseErrors(errors);
    setViewPage(1);
    setFromRowInput(assets.length > 0 ? "1" : "");
    setToRowInput(assets.length > 0 ? String(Math.min(assets.length, VIEW_PAGE_SIZE)) : "");
    // A new file invalidates any previous check — stale statuses would be worse
    // than no statuses.
    setExistingIndex(null);
    setManualSelected(new Set());
    setStatusFilter("all");
    setSelectionMode("range");
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleCheckDatabase = async () => {
    setIsChecking(true);
    setCheckedCount(0);
    try {
      const res = await getExistingAssetIndex((n) => setCheckedCount(n));
      if (!res.success || !res.data) throw new Error(res.error || "Couldn't read the database");
      setExistingIndex(res.data);
      setViewPage(1);

      const newCount = parsedAssets.filter((r) => {
        const n = r.nama_file?.trim();
        return n && !res.data!.has(n);
      }).length;

      // Once we know exactly what's missing, picking rows by hand is busywork —
      // so jump straight to the "new only" selection.
      if (newCount > 0) {
        setSelectionMode("new");
        toast.success(`${newCount} rows are not in the database yet`, {
          description: `${parsedAssets.length - newCount} rows already exist and will be skipped.`,
        });
      } else {
        toast.info("Every row in this CSV already exists in the database", {
          description: "There are no new assets to import.",
        });
      }
    } catch (error) {
      toast.error("Database check failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsChecking(false);
    }
  };

  const goToPage = (page: number) => setViewPage(Math.max(1, Math.min(totalViewPages, page)));

  const handleJumpToPage = () => {
    const parsed = parseInt(jumpToPageInput, 10);
    if (!isNaN(parsed)) goToPage(parsed);
    setJumpToPageInput("");
  };

  // --- Range mode maths (no cap on range size) ---
  const fromRowNum = parseInt(fromRowInput, 10);
  const toRowNum = parseInt(toRowInput, 10);
  const hasValidFrom = !isNaN(fromRowNum) && fromRowNum > 0;
  const hasValidTo = !isNaN(toRowNum) && toRowNum > 0;
  const clampedFrom = hasValidFrom ? Math.max(1, Math.min(fromRowNum, total || 1)) : NaN;
  const clampedTo = hasValidTo
    ? Math.max(hasValidFrom ? clampedFrom : 1, Math.min(toRowNum, total || 1))
    : NaN;
  const rangeValid = total > 0 && hasValidFrom && hasValidTo && clampedTo >= clampedFrom;

  /** The row numbers the current mode resolves to. Single source of truth for import. */
  const selectedRowNos = useMemo<number[]>(() => {
    if (total === 0) return [];
    if (selectionMode === "new") return newRowNos;
    if (selectionMode === "manual") return [...manualSelected].sort((a, b) => a - b);
    if (!rangeValid) return [];
    const out: number[] = [];
    for (let n = clampedFrom; n <= clampedTo; n++) out.push(n);
    return out;
  }, [selectionMode, newRowNos, manualSelected, rangeValid, clampedFrom, clampedTo, total]);

  const selectedCount = selectedRowNos.length;

  const toggleManualRow = (rowNo: number) => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      next.has(rowNo) ? next.delete(rowNo) : next.add(rowNo);
      return next;
    });
  };

  const selectAllOnPage = () => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach(({ rowNo }) => next.add(rowNo));
      return next;
    });
  };

  const clearPageSelection = () => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      pageRows.forEach(({ rowNo }) => next.delete(rowNo));
      return next;
    });
  };

  const handleCopyNewRows = () =>
    copyWithFeedback(
      formatRowRanges(newRowNos, Number.MAX_SAFE_INTEGER),
      () => toast.success("Copied the list of new rows"),
      (msg) => toast.error("Copy failed", { description: msg })
    );

  const handleImport = async () => {
    if (total === 0) return;

    if (selectedCount === 0) {
      toast.error("No rows selected", {
        description:
          selectionMode === "range"
            ? "Enter a valid 'from' and 'to' row first."
            : selectionMode === "manual"
            ? "Tick at least one row in the table first."
            : "Run the database check first, or every row in this CSV already exists.",
      });
      return;
    }

    const slice = selectedRowNos.map((n) => parsedAssets[n - 1]).filter(Boolean);

    // Handed to the app-level job provider rather than run here, so navigating
    // away from the CSV Viewer doesn't kill the import.
    await job.start(slice, {
      label: `${selectedFile?.name || "CSV"} — ${selectedCount} rows`,
      updateExistingType,
      updateExistingLink,
    });

    // The database just changed, so the cached check is stale.
    setExistingIndex(null);
    setManualSelected(new Set());
  };

  const StatusBadge = ({ rowNo }: { rowNo: number }) => {
    const s = rowStatus(rowNo);
    if (s === "unknown") return <span className="text-xs text-muted-foreground">-</span>;
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
          title="Filename already in the database, but the link changed — the asset was re-uploaded to Lightroom."
        >
          Replaced
        </Badge>
      );
    return (
      <Badge variant="secondary" className="text-xs text-muted-foreground">
        Unchanged
      </Badge>
    );
  };

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto space-y-6">
      {/* File Picker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload CSV
          </CardTitle>
          <CardDescription>
            Open a CSV from your computer to review it, check which rows aren't in the database yet,
            then pick what to import.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer border-muted-foreground/25 hover:border-muted-foreground/50 transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            {selectedFile ? (
              <p className="font-medium text-[var(--pp-text-positive)]">{selectedFile.name}</p>
            ) : (
              <p className="font-medium">Click to choose a CSV file from your computer</p>
            )}
            <p className="text-sm text-muted-foreground mt-1">
              Columns: nama_file, asset_name, url_lightroom, type
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {/* Template + format reference.
              Moved here from the old "Upload Asset" screen when that menu was
              removed — it was the only place you could get the template, so
              deleting the menu without this would have removed a feature. Folded
              into a <details> so it doesn't push the actual work down the page. */}
          <details className="mt-4 rounded-[8px] bg-muted/50 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Need the template, or the column reference?
            </summary>
            <div className="mt-3 space-y-3">
              <Button onClick={downloadTemplate} variant="outline" size="sm">
                <Download className="w-4 h-4 mr-2" />
                Download CSV template
              </Button>
              <div className="rounded-[8px] border bg-background p-2 font-mono text-xs">
                nama_file,url_lightroom,category
                <br />
                tds_si_example.png,https://…,Spot
                <br />
                tds_mi_icon.png,https://…,Micro
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  <strong className="text-foreground">Columns:</strong>{" "}
                  <code>nama_file</code> (or filename, asset_library_name) and{" "}
                  <code>url_lightroom</code> (or lightroom, url, link) are required.{" "}
                  <code>category</code> (or type) is optional.
                </p>
                <p>
                  <strong className="text-foreground">Valid categories:</strong> Spot, Micro, Icon,
                  Supergraphic, Other, General. Leave it blank and the type is detected from the
                  filename prefix instead.
                </p>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      {parseErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium mb-1">{parseErrors.length} rows skipped</p>
            <ul className="text-sm list-disc pl-4 max-h-32 overflow-y-auto">
              {parseErrors.slice(0, 20).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {total > 0 && (
        <>
          {/* ---------- Database checker ---------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Check Database
              </CardTitle>
              <CardDescription>
                Compare the nama_file column against what's already in the database, so you can see exactly which rows are genuinely new.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={handleCheckDatabase} disabled={isChecking} className="w-full sm:w-auto">
                <RefreshCw className={`w-4 h-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
                {isChecking
                  ? `Checking… (${checkedCount} assets read)`
                  : existingIndex
                  ? "Check Again"
                  : "Check Now"}
              </Button>

              {existingIndex && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-muted p-3">
                      <div className="text-xl font-bold">{total}</div>
                      <div className="text-xs text-muted-foreground">rows in CSV</div>
                    </div>
                    <div className="rounded-lg bg-[var(--pp-bg-green-low)] p-3">
                      <div className="text-xl font-bold text-[var(--pp-text-positive)]">
                        {newRowNos.length}
                      </div>
                      <div className="text-xs text-[var(--pp-text-positive)]">not in DB</div>
                    </div>
                    <div className="rounded-lg bg-muted p-3">
                      <div className="text-xl font-bold text-muted-foreground">
                        {existingRowNos.length}
                      </div>
                      <div className="text-xs text-muted-foreground">already in DB</div>
                    </div>
                  </div>

                  {newRowNos.length > 0 && (
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">Rows not in the database</span>
                        <Button variant="ghost" size="sm" onClick={handleCopyNewRows}>
                          <Copy className="w-3.5 h-3.5 mr-1.5" />
                          Copy
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground break-words font-mono leading-relaxed">
                        {formatRowRanges(newRowNos)}
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    The database holds {existingIndex.size} assets in total. This check resets automatically after an import, or when you open a different file, so you never act on a stale status.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---------- Preview ---------- */}
          <Card>
            <CardHeader>
              <CardTitle>Review Data ({total} rows total)</CardTitle>
              <CardDescription>
                Showing {VIEW_PAGE_SIZE} rows per page.
                {statusFilter !== "all" && ` Filtered: ${visibleRows.length} rows.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={toggleSortDir}>
                  {sortDir === "asc" ? (
                    <ArrowUp className="w-4 h-4 mr-1.5" />
                  ) : (
                    <ArrowDown className="w-4 h-4 mr-1.5" />
                  )}
                  {sortDir === "asc" ? "Row 1 first" : "Last row first"}
                </Button>

                {existingIndex && (
                  <div className="flex items-center gap-1">
                    {(["all", "new", "replaced", "existing"] as StatusFilter[]).map((f) => (
                      <Button
                        key={f}
                        variant={statusFilter === f ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setStatusFilter(f);
                          setViewPage(1);
                        }}
                      >
                        {f === "all"
                          ? "All"
                          : f === "new"
                            ? `New (${newRowNos.length})`
                            : f === "replaced"
                              ? `Replaced (${replacedRowNos.length})`
                              : `Unchanged (${existingRowNos.length})`}
                      </Button>
                    ))}
                  </div>
                )}

                {selectionMode === "manual" && (
                  <div className="flex items-center gap-1 ml-auto">
                    <Button variant="outline" size="sm" onClick={selectAllOnPage}>
                      Select this page
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearPageSelection}>
                      Clear selection
                    </Button>
                  </div>
                )}
              </div>

              <div className="border rounded-lg overflow-auto max-h-[420px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {selectionMode === "manual" && <TableHead className="w-10" />}
                      <TableHead className="w-24">
                        <button
                          type="button"
                          onClick={toggleSortDir}
                          className="inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground"
                          title={
                            sortDir === "asc"
                              ? "Click to see the last rows (the ones you just added) first"
                              : "Click to go back to the original order"
                          }
                        >
                          Row
                          {sortDir === "asc" ? (
                            <ArrowUp className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead>nama_file</TableHead>
                      <TableHead>asset_name</TableHead>
                      <TableHead>type</TableHead>
                      <TableHead>url_lightroom</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map(({ row, rowNo }) => (
                      <TableRow
                        key={rowNo}
                        className={
                          selectionMode === "manual" && manualSelected.has(rowNo)
                            ? "bg-accent/50"
                            : undefined
                        }
                      >
                        {selectionMode === "manual" && (
                          <TableCell>
                            <Checkbox
                              checked={manualSelected.has(rowNo)}
                              onCheckedChange={() => toggleManualRow(rowNo)}
                              aria-label={`Select row ${rowNo}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground">{rowNo}</TableCell>
                        <TableCell>
                          <StatusBadge rowNo={rowNo} />
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate">{row.nama_file}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{row.asset_name}</TableCell>
                        <TableCell>{row.type}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
                          {row.url_lightroom}
                        </TableCell>
                      </TableRow>
                    ))}
                    {pageRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          No rows match this filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => goToPage(1)} disabled={safeViewPage <= 1} title="First page">
                    <ChevronsLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(safeViewPage - 1)} disabled={safeViewPage <= 1}>
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>
                </div>

                <span className="text-sm text-muted-foreground">
                  Page {safeViewPage} / {totalViewPages}
                </span>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => goToPage(safeViewPage + 1)} disabled={safeViewPage >= totalViewPages}>
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goToPage(totalViewPages)} disabled={safeViewPage >= totalViewPages} title="Last page">
                    <ChevronsRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <label className="text-sm text-muted-foreground whitespace-nowrap">Jump to page</label>
                <Input
                  type="number"
                  min={1}
                  max={totalViewPages}
                  placeholder={`1-${totalViewPages}`}
                  value={jumpToPageInput}
                  onChange={(e) => setJumpToPageInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJumpToPage()}
                  className="w-24 h-9"
                />
                <Button variant="outline" size="sm" onClick={handleJumpToPage}>
                  Go
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ---------- Selection + import ---------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Pilih Row untuk Di-import
              </CardTitle>
              <CardDescription>Three ways to pick rows — use whichever fits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mode switcher */}
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    { key: "new", label: "Not in database", hint: "Automatically selects every new row" },
                    { key: "manual", label: "Pick manually", hint: "Tick rows one by one in the table" },
                    { key: "range", label: "Row range", hint: "From row X to row Y" },
                  ] as { key: SelectionMode; label: string; hint: string }[]
                ).map((m) => {
                  const disabled = m.key === "new" && !existingIndex;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectionMode(m.key)}
                      className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selectionMode === m.key
                          ? "border-[var(--pp-stroke-active)] bg-accent"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {disabled ? "Run the database check first" : m.hint}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectionMode === "range" && (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-sm text-muted-foreground mb-1 block">From row</label>
                    <Input
                      type="number"
                      min={1}
                      max={total}
                      value={fromRowInput}
                      onChange={(e) => setFromRowInput(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-sm text-muted-foreground mb-1 block">To row</label>
                    <Input
                      type="number"
                      min={1}
                      max={total}
                      value={toRowInput}
                      onChange={(e) => setToRowInput(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {selectionMode === "manual" && (
                <p className="text-sm text-muted-foreground">
                  Tick rows in the table above. Currently selected: <strong>{manualSelected.size}</strong> rows.
                  {existingIndex && newRowNos.length > 0 && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="underline hover:no-underline"
                        onClick={() => setManualSelected(new Set(newRowNos))}
                      >
                        Centang semua yang not in DB ({newRowNos.length})
                      </button>
                    </>
                  )}
                </p>
              )}

              <div className="rounded-lg bg-muted p-3 text-sm">
                {selectedCount > 0 ? (
                  <>
                    <strong>{selectedCount}</strong> rows will be imported
                    {selectionMode === "range" && rangeValid && ` (baris ${clampedFrom}-${clampedTo})`}
                    {selectionMode === "new" && ` — baris ${formatRowRanges(newRowNos, 8)}`}
                    .
                    {existingIndex && selectionMode !== "new" && (
                      <span className="text-muted-foreground">
                        {" "}
                        Of those, {selectedRowNos.filter((n) => rowStatus(n) === "new").length} are
                        genuinely new
                        {(() => {
                          const replacing = selectedRowNos.filter((n) => rowStatus(n) === "replaced").length;
                          return replacing > 0
                            ? ` and ${replacing} ${replacing === 1 ? "is a re-upload" : "are re-uploads"} with a new link`
                            : "";
                        })()}
                        .
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">No rows selected yet.</span>
                )}
              </div>

              <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
                <Checkbox
                  id="csv-viewer-update-existing-link"
                  checked={updateExistingLink}
                  onCheckedChange={(checked) => setUpdateExistingLink(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="csv-viewer-update-existing-link" className="text-sm font-normal leading-snug cursor-pointer">
                  Replace the <strong>Lightroom link</strong> when a filename already exists but the
                  CSV has a different URL — i.e. the asset was re-uploaded after a redesign.
                  {existingIndex && replacedRowNos.length > 0 && (
                    <span className="text-[var(--pp-text-active)]">
                      {" "}
                      {replacedRowNos.length} row{replacedRowNos.length === 1 ? "" : "s"} in this file
                      {replacedRowNos.length === 1 ? " looks" : " look"} like re-uploads.
                    </span>
                  )}
                  <span className="block mt-1 text-xs text-muted-foreground">
                    On by default: Lightroom mints a new URL on every upload, so a changed link means
                    the file itself changed. Turn it off to leave existing links alone.
                  </span>
                </Label>
              </div>

              <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
                <Checkbox
                  id="csv-viewer-update-existing-type"
                  checked={updateExistingType}
                  onCheckedChange={(checked) => setUpdateExistingType(checked === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="csv-viewer-update-existing-type" className="text-sm font-normal leading-snug cursor-pointer">
                  Update the <strong>type</strong> of assets whose filename already exists in the
                  database (asset_name stays as it is). Leave this off and the type of existing
                  assets is left untouched.
                </Label>
              </div>

              {!job.isActive && (
                <Button className="w-full" size="lg" onClick={handleImport} disabled={total === 0}>
                  <Upload className="w-4 h-4 mr-2" />
                  {selectedCount > 0 ? `Import ${selectedCount} rows` : "Import selected rows"}
                </Button>
              )}

              {job.isActive && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{job.status === "paused" ? "Import paused" : "Importing to Appwrite…"}</span>
                    <span>{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} />
                  <p className="text-xs text-muted-foreground">
                    {job.done} / {job.total} rows. Use the panel in the bottom-right corner to
                    pause, resume or stop — it keeps running even if you go back to the dashboard.
                  </p>
                  <div className="flex gap-2">
                    {job.status === "running" ? (
                      <Button size="sm" variant="secondary" onClick={job.pause}>Pause</Button>
                    ) : (
                      <Button size="sm" onClick={job.resume}>Resume</Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={job.cancel}>Stop</Button>
                  </div>
                </div>
              )}

              {job.status === "done" && (
                <Alert className="border-[var(--pp-stroke-positive)] bg-[var(--pp-bg-green-low)]">
                  <CheckCircle className="h-4 w-4 text-[var(--pp-icon-positive)]" />
                  <AlertDescription className="text-[var(--pp-text-positive)] space-y-2">
                    <p>{job.message}</p>
                    <p className="text-xs opacity-80">
                      The "new / already exists" status has been reset. Run Check Again above to
                      see the current state.
                    </p>
                    <Button size="sm" onClick={job.reset}>Select other rows / import again</Button>
                  </AlertDescription>
                </Alert>
              )}

              {job.status === "cancelled" && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="space-y-2">
                    <p>{job.message}</p>
                    <Button size="sm" onClick={job.reset}>Dismiss</Button>
                  </AlertDescription>
                </Alert>
              )}

              {job.status === "error" && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-bold">Import failed</p>
                    <p className="text-sm">{job.message}</p>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
