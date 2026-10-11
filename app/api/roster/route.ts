// ============================================================
// POST /api/roster — import the player roster from a spreadsheet.
// Owner-PIN only. Accepts, in one code path:
//   - the raw bytes of an .xlsx (photos read from cell-anchored images)
//   - the raw bytes of a .csv  (photo column may hold URLs)
//   - a published Google Sheets URL to fetch (needs internet)
//
// Two-phase on purpose: `?dryRun=1` parses and returns a PREVIEW (players +
// warnings + how many photos were extracted) so the owner can eyeball it, then
// the same call without dryRun commits it. Photos are written to data/avatars
// so the projector needs no internet afterwards.
// ============================================================

import { ownerAllowed, denied } from "@/lib/server/auth";
import { buildRoster, imageLookup, RawTable } from "@/lib/roster";
import { pickRosterSheet, readXlsx } from "@/lib/server/xlsx";
import { clearAvatars, saveAvatar } from "@/lib/server/avatarStore";
import { getState, rosterLocked, setRoster } from "@/lib/server/store";
import { Player } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

// ---- csv -> RawTable (RFC4180-ish, handles quoted commas) ----
function parseCsv(text: string): RawTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  return { headers: nonEmpty[0].map((c) => c.trim()), rows: nonEmpty.slice(1) };
}

// ---- xlsx -> RawTable + the images found ----
function parseXlsx(buf: Buffer): { table: RawTable; images: { row: number; col: number; ext: string; data: Buffer }[] } | null {
  let sheets;
  try {
    sheets = readXlsx(buf);
  } catch (e: any) {
    throw new Error(`Could not read that .xlsx: ${e.message}`);
  }
  const sheet = pickRosterSheet(sheets);
  if (!sheet) return null;

  // header row = the first row that has any text
  const byRow = new Map<number, { col: number; value: string }[]>();
  for (const c of sheet.cells) {
    if (!byRow.has(c.row)) byRow.set(c.row, []);
    byRow.get(c.row)!.push(c);
  }
  const rowNums = [...byRow.keys()].sort((a, b) => a - b);
  if (rowNums.length === 0) return null;
  const headerRow = rowNums[0];
  const maxCol = Math.max(...[...byRow.values()].flat().map((c) => c.col));
  const headers: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    headers.push(byRow.get(headerRow)?.find((x) => x.col === c)?.value.trim() ?? "");
  }
  const rows: (string | null)[][] = [];
  for (const r of rowNums.filter((n) => n > headerRow)) {
    const cells = byRow.get(r)!;
    const line: (string | null)[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = cells.find((x) => x.col === c);
      const hasImg = sheet.images.some((im) => im.row === r && im.col === c);
      line.push(cell ? cell.value : hasImg ? null : "");
    }
    rows.push(line);
  }
  return {
    table: { headers, rows },
    images: sheet.images.map(({ row, col, ext, data }) => ({ row, col, ext, data })),
  };
}

export async function POST(req: Request) {
  if (!ownerAllowed(req)) return denied("Owner");

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const locked = rosterLocked();
  if (locked) return json({ ok: false, error: locked }, 409);

  let table: RawTable;
  let images: { row: number; col: number; ext: string; data: Buffer }[] = [];

  try {
    const url = new URL(req.url).searchParams.get("url");
    if (url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
      const text = await res.text();
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) throw new Error("That URL did not return a readable CSV. Publish the Players tab to web (CSV) and try again.");
      table = parsed;
    } else {
      const body = Buffer.from(await req.arrayBuffer());
      if (body.length === 0) throw new Error("Empty upload.");
      const isZip = body.length > 4 && body[0] === 0x50 && body[1] === 0x4b;
      if (isZip) {
        const parsed = parseXlsx(body);
        if (!parsed) throw new Error("That .xlsx has no readable rows.");
        table = parsed.table;
        images = parsed.images;
      } else {
        table = parseCsv(body.toString("utf8"));
        if (table.headers.length === 0) throw new Error("That file has no header row.");
      }
    }
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }

  const parsedRoster = buildRoster(table, imageLookup(images));
  if (parsedRoster.errors.length > 0 && parsedRoster.players.length === 0)
    return json({ ok: false, error: parsedRoster.errors.join(" · ") }, 400);

  // map each cell-anchored image to the gamer_id of the row it sits in
  const photoPlan: { gamerId: string; ext: string; data: Buffer }[] = [];
  const photosUnmapped: number[] = [];
  images.forEach((im, n) => {
    const row = parsedRoster.rows[im.row - 2];
    if (row) photoPlan.push({ gamerId: row.gamerId, ext: im.ext, data: im.data });
    else photosUnmapped.push(n);
  });

  const summary = {
    ok: true,
    dryRun,
    players: parsedRoster.players,
    rows: parsedRoster.rows,
    warnings: parsedRoster.warnings,
    errors: parsedRoster.errors,
    photos: {
      found: images.length,
      willStore: photoPlan.length,
      unmatched: photosUnmapped.length,
    },
  };

  // a dry run must not touch the disk
  if (dryRun) return json(summary);

  // commit: the roster is replaced wholesale, so its photos are too
  const stored: string[] = [];
  const skipped: string[] = [];
  if (images.length > 0) {
    clearAvatars();
    for (const p of photoPlan) {
      if (saveAvatar(p.gamerId, p.ext, p.data)) stored.push(p.gamerId);
      else skipped.push(p.gamerId);
    }
  }

  try {
    const s = setRoster(parsedRoster.players as Player[]);
    return json({
      ...summary,
      dryRun: false,
      applied: true,
      photos: { found: images.length, stored: stored.length, skipped },
      state: s,
    });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 409);
  }
}
