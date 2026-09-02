/**
 * Turning a block of pasted spreadsheet text into asset rows.
 *
 * The CSV importer needs a file with a header row it can recognise. This handles
 * the other, messier half of the job: two columns copied straight out of Google
 * Sheets, Numbers or the Appwrite console, pasted into a box. That paste has no
 * usable header, often carries the sheet's title line above the data, and arrives
 * tab-separated rather than comma-separated.
 *
 * The parser does NOT try to identify columns by name, because there are no names
 * to read. It anchors on the URL instead: in every line, the token that starts
 * with http is the link, and the remaining text is the filename. That single rule
 * is what makes junk lines free — a sheet title like
 * `cloud-asset-csv_ios_cloud_asset (7)` contains no URL, so it falls out on its
 * own without needing a list of patterns to ignore.
 */

import { assetKey } from './assetNaming';

export interface PastedRow {
  nama_file: string;
  url_lightroom: string;
  /** 1-based line number in the pasted text, so warnings can point at something. */
  line: number;
}

export interface PasteParseResult {
  rows: PastedRow[];
  /** Lines that carried a filename but no link, or a link but no filename. */
  incomplete: PastedRow[];
  /** Lines with nothing usable at all — sheet titles, counts, blank separators. */
  ignored: { line: number; text: string }[];
  /**
   * Filenames appearing more than once in the paste.
   *
   * Manual Input already blocks on this, but reporting it here means you see it
   * the moment you paste rather than after scanning the rows.
   */
  duplicateNames: string[];
  /**
   * URLs appearing more than once under DIFFERENT filenames.
   *
   * This is the failure the form could not previously see. Two names pointing at
   * one image imports cleanly and looks correct in the grid — both entries render,
   * because both resolve. You only find out when someone downloads the wrong
   * artwork. It usually comes from a copy-paste slip in the source sheet, so the
   * paste box is the right place to catch it.
   */
  duplicateUrls: { url: string; filenames: string[] }[];
}

/** A token is the link if it looks like one. Anything else is filename material. */
const isUrl = (token: string) => /^https?:\/\//i.test(token);

/**
 * Strip the wrapping a spreadsheet adds and a person's stray keystrokes.
 *
 * Excel and Sheets quote any cell containing the delimiter, and doubled quotes are
 * how they escape a literal one. Trailing commas turn up when a row is copied out
 * of a CSV file rather than a sheet.
 */
const cleanCell = (value: string) =>
  value
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/""/g, '"')
    .replace(/,+$/, '')
    .trim();

/**
 * Split one line into cells.
 *
 * Tab first because that is what a real spreadsheet paste uses, and a tab can
 * never appear inside a filename or a URL — so it is the only delimiter here that
 * is safe to trust blindly. Comma and semicolon come next for text copied out of a
 * CSV. Runs of two or more spaces are the last resort, for text copied out of a
 * rendered table; a single space is deliberately NOT a delimiter, because
 * filenames and titles contain single spaces all the time.
 */
const splitLine = (line: string): string[] => {
  if (line.includes('\t')) return line.split('\t');
  if (/[;,]/.test(line) && !/^https?:\/\/[^;,]*$/i.test(line)) return line.split(/[;,]/);
  return line.split(/\s{2,}/);
};

/**
 * Filenames need an extension to be recognisable, but the source sheet does not
 * always carry one. Left alone rather than guessed at: `.png` is the common case
 * but `.svg` is real too, and inventing the wrong one produces an asset nobody can
 * match against Lightroom later.
 */
const looksLikeFilename = (token: string) =>
  token.length > 0 && !isUrl(token) && !/^\(?\d+\)?$/.test(token);

export function parsePastedAssets(raw: string): PasteParseResult {
  const rows: PastedRow[] = [];
  const incomplete: PastedRow[] = [];
  const ignored: { line: number; text: string }[] = [];

  const lines = (raw || '').replace(/\r\n?/g, '\n').split('\n');

  /**
   * Whether we have reached the data yet.
   *
   * Everything above the first line containing a URL is preamble — the sheet's
   * title, a column header, an export count — and is ignored silently. Below that
   * point the same shape means something different: a line with a filename but no
   * link is a row whose link is genuinely missing, and that is worth telling you
   * about. Without this distinction the sheet title gets reported as a broken row
   * on every single paste, and a warning you always ignore is a warning that stops
   * working.
   */
  let inData = false;

  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const text = rawLine.trim();
    if (!text) return; // blank separators are not worth reporting

    const cells = splitLine(text).map(cleanCell).filter((c) => c.length > 0);

    // A URL pasted on its own line, with the filename on the line above or below,
    // is a shape we cannot reassemble without guessing which line pairs with
    // which — so a lone URL is reported as incomplete rather than silently joined.
    const url = cells.find(isUrl) ?? '';
    const nama_file = cells.find(looksLikeFilename) ?? '';

    if (url) inData = true;

    if (!url && !inData) {
      ignored.push({ line, text }); // header / title / count above the data
      return;
    }

    if (!url && !nama_file) {
      ignored.push({ line, text });
      return;
    }

    if (!url || !nama_file) {
      incomplete.push({ nama_file, url_lightroom: url, line });
      return;
    }

    rows.push({ nama_file, url_lightroom: url, line });
  });

  // Duplicate filenames — the same failure Manual Input already blocks on, and
  // counted on the same assetKey(), so `foo` and `foo.png` in one paste are the
  // one asset the form will grade them as rather than two rows that look fine
  // here and then block on save.
  const nameCounts = new Map<string, number>();
  rows.forEach((r) => {
    const key = assetKey(r.nama_file);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  });
  const duplicateNames = rows
    .filter((r) => (nameCounts.get(assetKey(r.nama_file)) ?? 0) > 1)
    .map((r) => r.nama_file)
    .filter((name, i, all) => all.indexOf(name) === i);

  // Duplicate links. Grouped by URL and only reported when the filenames differ,
  // because two identical rows are a duplicate-name problem, not this one.
  // Keyed on assetKey() but carrying the filename as it was pasted, so the
  // warning quotes what you can find in your sheet while still treating `foo`
  // and `foo.png` as the one name they are.
  const byUrl = new Map<string, Map<string, string>>();
  rows.forEach((r) => {
    const names = byUrl.get(r.url_lightroom) ?? new Map<string, string>();
    if (!names.has(assetKey(r.nama_file))) names.set(assetKey(r.nama_file), r.nama_file);
    byUrl.set(r.url_lightroom, names);
  });
  const duplicateUrls = [...byUrl.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([url, names]) => ({ url, filenames: [...names.values()] }));

  return { rows, incomplete, ignored, duplicateNames, duplicateUrls };
}
