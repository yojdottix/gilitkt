import { toast } from "sonner";
import { type Asset } from "../../utils/appwriteApi";
import { type Island } from "./types";

/** Filename-safe stem for an island's exports. */
const exportStem = (island: Island) => island.name.replace(/[^a-zA-Z0-9]/g, "_");

function download(filename: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download an island's contents as a file.
 *
 * Shared by the user's own islands and the curated ones, which export
 * identically — a collection is a collection, whoever assembled it.
 */
export function exportIslandAssets(island: Island, members: Asset[], format: "csv" | "txt") {
  if (members.length === 0) {
    toast.error("Nothing to export", { description: "This island doesn't contain any assets." });
    return;
  }

  // Two fields only: the raw nama_file exactly as stored, and the Lightroom
  // URL. The prettified asset_name is a display label, not something you can
  // look anything up by.
  if (format === "csv") {
    const csv = [
      "nama_file,url_lightroom",
      ...members.map((a) => `"${a.nama_file}","${a.url_lightroom}"`),
    ].join("\n");
    download(`${exportStem(island)}_assets.csv`, csv, "text/csv");
  } else {
    const txt = members
      .map((a) => `nama_file: ${a.nama_file}\nurl_lightroom: ${a.url_lightroom}`)
      .join("\n\n");
    download(`${exportStem(island)}_assets.txt`, txt, "text/plain");
  }

  toast.success(`${format.toUpperCase()} exported`, {
    description: `Downloaded "${island.name}" with ${members.length} assets.`,
  });
}
