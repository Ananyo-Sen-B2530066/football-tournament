// ============================================================
// Minimal .xlsx reader — cells AND cell-anchored embedded images.
// ------------------------------------------------------------
// Needed because a registration sheet carries player photos as
// images placed INSIDE cells, and no spreadsheet library exposes
// those (SheetJS doesn't read images at all). Built on Node
// built-ins only: the file is a zip, so we walk its central
// directory and inflate the parts with zlib.
//
// Reads: shared strings, inline strings, numeric cells, and each
// drawing anchor's from/col + from/row so an image can be attached
// to the row it sits in.
// ============================================================

import zlib from "node:zlib";
import path from "node:path";

export interface XlsxCell {
  row: number; // 1-based
  col: number; // 1-based
  value: string;
}

export interface XlsxImage {
  row: number; // 1-based row the image is anchored to
  col: number; // 1-based column it is anchored in
  ext: string; // png | jpg | ...
  data: Buffer;
}

export interface XlsxSheet {
  name: string;
  cells: XlsxCell[];
  images: XlsxImage[];
}

const MAX_UNCOMPRESSED = 80 * 1024 * 1024; // zip-bomb guard

/** Read a zip from a Buffer into { path: Buffer }. */
function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end-of-central-directory record).");

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let budget = MAX_UNCOMPRESSED;

  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(lho + 26);
    const localExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + localNameLen + localExtraLen;
    const raw = buf.slice(start, start + compSize);
    budget -= compSize;
    if (budget < 0) throw new Error("File is too large / looks like a zip bomb.");
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    // other methods (bzip2 etc.) are never used by xlsx — skip them
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");

/** Resolve a relationship Target against the part's folder, e.g.
 *  "../drawings/drawing1.xml" from "xl/worksheets" -> "xl/drawings/drawing1.xml" */
const resolvePart = (baseDir: string, target: string) =>
  target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(baseDir, target));

/** "BC12" -> { col: 55, row: 12 } */
function refToRC(ref: string): { col: number; row: number } {
  const letters = (ref.match(/^[A-Z]+/i) ?? ["A"])[0].toUpperCase();
  const row = Number((ref.match(/\d+/) ?? ["1"])[0]);
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row };
}

const textOf = (xml: string) =>
  decodeXml([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

function sharedStrings(parts: Map<string, Buffer>): string[] {
  const raw = parts.get("xl/sharedStrings.xml");
  if (!raw) return [];
  return [...raw.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/** sheet names in workbook order, paired with their part paths */
function sheetIndex(parts: Map<string, Buffer>): { name: string; path: string }[] {
  const wb = parts.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const relsRaw = parts.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const rels = new Map<string, string>();
  for (const m of relsRaw.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, resolvePart("xl", target));
  }
  const out: { name: string; path: string }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeXml(/name="([^"]+)"/.exec(m[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const target = rid ? rels.get(rid) : undefined;
    if (target) out.push({ name, path: target });
  }
  if (out.length === 0) {
    // some writers omit the rels; fall back to whatever sheets exist
    for (const p of parts.keys()) {
      const m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(p);
      if (m) out.push({ name: `Sheet${m[1]}`, path: p });
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
  }
  return out;
}

function readCells(parts: Map<string, Buffer>, sheetPath: string, ss: string[]): XlsxCell[] {
  const xml = parts.get(sheetPath)?.toString("utf8") ?? "";
  const cells: XlsxCell[] = [];
  for (const m of xml.matchAll(/<c\s([^>]*?)\/?>(?:([\s\S]*?)<\/c>)?/g)) {
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const ref = /r="([A-Z]+\d+)"/i.exec(attrs)?.[1];
    if (!ref) continue;
    const { col, row } = refToRC(ref);
    const t = /t="([^"]+)"/.exec(attrs)?.[1];
    let value = "";
    if (t === "s") {
      const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
      value = Number.isFinite(i) ? ss[i] ?? "" : "";
    } else if (t === "inlineStr") {
      value = textOf(body);
    } else if (t === "str") {
      value = textOf(body) || (/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
    } else {
      value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
    }
    if (value !== "") cells.push({ row, col, value });
  }
  return cells;
}

/** Follow sheet rels -> drawing rels -> xl/media, mapping anchors to rows. */
function readImages(parts: Map<string, Buffer>, sheetPath: string): XlsxImage[] {
  const sheetDir = sheetPath.slice(0, sheetPath.lastIndexOf("/"));
  const sheetFile = sheetPath.slice(sheetPath.lastIndexOf("/") + 1);
  const sheetRels = parts.get(`${sheetDir}/_rels/${sheetFile}.rels`)?.toString("utf8") ?? "";

  const drawingTargets: string[] = [];
  for (const m of sheetRels.matchAll(/<Relationship\b[^>]*>/g)) {
    const type = /Type="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? "";
    if (type.includes("/drawing") && target) drawingTargets.push(resolvePart(sheetDir, target));
  }

  const images: XlsxImage[] = [];
  for (const drawingPath of drawingTargets) {
    const drawingDir = drawingPath.slice(0, drawingPath.lastIndexOf("/"));
    const drawingFile = drawingPath.slice(drawingPath.lastIndexOf("/") + 1);
    const drawingRels = parts.get(`${drawingDir}/_rels/${drawingFile}.rels`)?.toString("utf8") ?? "";
    const media = new Map<string, { path: string; ext: string }>();
    for (const m of drawingRels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])?.[1];
      const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? "";
      const type = /Type="([^"]+)"/.exec(m[0])?.[1] ?? "";
      if (!id || !type.includes("/image")) continue;
      const resolved = resolvePart(drawingDir, target);
      const ext = (resolved.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? "bin").toLowerCase();
      media.set(id, { path: resolved, ext });
    }

    const xml = parts.get(drawingPath)?.toString("utf8") ?? "";
    // both anchor forms place the image by its top-left cell
    for (const m of xml.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/g)) {
      const anchor = m[0];
      const colM = /<xdr:from>[\s\S]*?<xdr:col>\s*(\d+)\s*<\/xdr:col>/.exec(anchor);
      const rowM = /<xdr:from>[\s\S]*?<xdr:row>\s*(\d+)\s*<\/xdr:row>/.exec(anchor);
      const rid = /r:embed="([^"]+)"/.exec(anchor)?.[1];
      if (!colM || !rowM || !rid) continue;
      const hit = media.get(rid);
      if (!hit) continue;
      const data = parts.get(hit.path);
      if (!data) continue;
      images.push({ row: Number(rowM[1]) + 1, col: Number(colM[1]) + 1, ext: hit.ext, data });
    }
  }
  return images;
}

/** Parse an .xlsx Buffer into every sheet's cells + anchored images. */
export function readXlsx(buf: Buffer): XlsxSheet[] {
  const parts = unzip(buf);
  const ss = sharedStrings(parts);
  return sheetIndex(parts).map(({ name, path }) => ({
    name,
    cells: readCells(parts, path, ss),
    images: readImages(parts, path),
  }));
}

/** Pick the sheet most likely to hold the roster, preferring a "players"-ish name. */
export function pickRosterSheet(sheets: XlsxSheet[]): XlsxSheet | null {
  if (sheets.length === 0) return null;
  return (
    sheets.find((s) => /player|roster|registr|entry/i.test(s.name)) ?? sheets[0]
  );
}
