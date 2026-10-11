// ============================================================
// One normaliser for every roster source: .xlsx upload, .csv
// upload, and a published Google Sheets URL. Whichever way the
// file arrives, it becomes the same shape the app uses.
//
// Expected columns (aliases accepted, order irrelevant):
//   photo | avatar | picture | image   (URL, or a cell-embedded image)
//   name  | player | gamer
//   gamer_id | gamerid | gamer id | id
//   pot   | pot_no | potno | pot number
//
// gamer_id becomes the player's stable id, so a corrected name or
// a reordered sheet can never orphan a fixture.
// ============================================================

import type { Player } from "./types";

export interface RosterRow {
  name: string;
  gamerId: string;
  pot: number;
  photoUrl: string; // "" when the photo is a cell-embedded image
  hasImage: boolean;
}

export interface RosterParse {
  players: Player[];
  rows: RosterRow[];
  warnings: string[];
  errors: string[];
}

/** Only these are looked up as columns; hasImage is derived, not a column. */
type Column = "photoUrl" | "name" | "gamerId" | "pot";

const ALIASES: Record<Column, string[]> = {
  photoUrl: ["photo", "avatar", "picture", "image", "image_url", "imageurl", "url", "photo_url", "photourl"],
  name: ["name", "player", "player_name", "playername", "gamer", "gamer_name", "gamername", "full name", "fullname"],
  gamerId: ["gamer_id", "gamerid", "gamer id", "gamer-id", "id", "player_id", "playerid", "unique id", "uniqueid", "uid"],
  pot: ["pot", "pot_no", "potno", "pot number", "potnum", "pot_num", "group", "seed"],
};

/** Lowercase and reduce to words, so "Pot No.", "POT_NO" and "potno" all match. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findColumn(headers: string[], field: Column): number {
  const wanted = ALIASES[field].map(norm);
  return headers.findIndex((h) => wanted.includes(norm(h)));
}

/** Google Drive share links don't serve an image directly — rewrite them. */
export function normalizePhotoUrl(url: string): string {
  const u = url.trim();
  if (!u) return "";
  const id = /drive\.google\.com\/file\/d\/([\w-]{10,})/.exec(u)?.[1];
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w512`;
  const open = /drive\.google\.com\/open\?id=([\w-]{10,})/.exec(u)?.[1];
  if (open) return `https://drive.google.com/thumbnail?id=${open}&sz=w512`;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u.replace(/^\/+/, "")}`;
}

/** Safe for a URL path segment and a filename: no slashes, no dot runs,
 *  so a gamer_id can never turn into "..", "../" or a path escape. */
export function safeId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w-]+/g, "-")     // dots and slashes both become "-"
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
  return cleaned || "player";
}

export interface RawTable {
  headers: string[];
  rows: (string | null)[][]; // null = "a cell-anchored image lives here"
}

/**
 * Turn a header + rows table into players. `imageAt(rowIdx, colIdx)` says
 * whether a cell-embedded image was found for that 1-based cell.
 */
export function buildRoster(table: RawTable, hasCellImage: (row: number, col: number) => boolean = () => false): RosterParse {
  const warnings: string[] = [];
  const errors: string[] = [];
  const h = table.headers;

  const cName = findColumn(h, "name");
  const cId = findColumn(h, "gamerId");
  const cPot = findColumn(h, "pot");
  const cPhoto = findColumn(h, "photoUrl");

  if (cName < 0) {
    errors.push(
      `No player-name column found. Expected one of: ${ALIASES.name.join(", ")}. Saw: ${h.join(", ") || "(empty file)"}`
    );
    return { players: [], rows: [], warnings, errors };
  }
  if (cId < 0) warnings.push(`No gamer_id column found — falling back to generated ids (p-1, p-2, …). Saw: ${h.join(", ")}`);

  const rows: RosterRow[] = [];
  const seenId = new Map<string, number>();
  let autoId = 0;

  table.rows.forEach((cells, i) => {
    const excelRow = i + 2; // 1-based, +1 for the header
    // cells can be null (an image placeholder) or a number (a hand-built
    // table) — normalise once so nothing downstream has to care
    const at = (idx: number) => (idx >= 0 ? String(cells[idx] ?? "").trim() : "");
    const name = at(cName);
    if (!name) return; // blank row

    autoId++;
    const rawId = at(cId);
    let gamerId = rawId ? safeId(rawId) : "";
    if (!gamerId) {
      gamerId = `p-${autoId}`;
      if (rawId) warnings.push(`Row ${excelRow}: gamer_id "${rawId}" had no usable characters — using ${gamerId}.`);
    } else if (seenId.has(gamerId)) {
      const prev = seenId.get(gamerId)!;
      warnings.push(`Row ${excelRow}: duplicate gamer_id "${gamerId}" (already used on row ${prev}) — using ${gamerId}-${excelRow}.`);
      gamerId = `${gamerId}-${excelRow}`;
    }
    seenId.set(gamerId, excelRow);

    const potRaw = at(cPot);
    const potNum = Number(potRaw);
    let pot = 1;
    if (potRaw === "") {
      warnings.push(`Row ${excelRow}: no pot number — treated as Pot 1.`);
    } else if (!Number.isFinite(potNum) || potNum < 1) {
      errors.push(`Row ${excelRow}: pot "${potRaw}" is not a number.`);
      pot = 1;
    } else {
      pot = Math.floor(potNum);
    }

    const rawPhoto = at(cPhoto);
    const photoUrl = rawPhoto ? normalizePhotoUrl(rawPhoto) : "";
    const hasImage = !!photoUrl || (cPhoto >= 0 && hasCellImage(excelRow, cPhoto + 1));

    if (!hasImage) warnings.push(`Row ${excelRow} (${name}): no photo — the projector will show initials.`);
    rows.push({ name, gamerId, pot, photoUrl, hasImage });
  });

  if (rows.length < 2) errors.push("Need at least 2 players in the roster.");

  // pot sanity, mirroring the config validator
  if (rows.length > 0) {
    const counts = new Map<number, number>();
    rows.forEach((r) => counts.set(r.pot, (counts.get(r.pot) ?? 0) + 1));
    const sizes = [...counts.values()];
    const distinct = [...counts.keys()].sort((a, b) => a - b);
    if (distinct.length > 1 && !sizes.every((s) => s === sizes[0]))
      warnings.push(`Pots are uneven (${distinct.map((p) => `Pot ${p}: ${counts.get(p)}`).join(", ")}). UCL mode needs equal pots — use 1 or 2 pots instead.`);
  }

  const players: Player[] = rows.map((r) => ({
    id: r.gamerId,
    name: r.name,
    pot: r.pot,
    avatar: r.photoUrl || null,
  }));

  return { players, rows, warnings, errors };
}

/** 1-based cell -> image present? for xlsx-sourced tables. */
export function imageLookup(cells: { row: number; col: number }[]): (row: number, col: number) => boolean {
  const set = new Set(cells.map((c) => `${c.row}:${c.col}`));
  return (row, col) => set.has(`${row}:${col}`);
}
