import { Match, Player, SheetsResultRow, Stage } from "./types";

function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Parse Players tab: columns name, pot, avatar (header case-insensitive). */
export function parsePlayersCSV(csv: string): { name: string; pot: number; avatar?: string }[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = splitCSVLine(lines[0]).map((h) => h.toLowerCase());
  const ni = head.indexOf("name");
  const pi = head.indexOf("pot");
  const ai = head.indexOf("avatar");
  if (ni < 0) throw new Error("Players sheet needs a 'name' column.");
  return lines.slice(1).map(splitCSVLine).map((cells) => ({
    name: (cells[ni] ?? "").trim(),
    pot: pi >= 0 ? Number(cells[pi]) || 1 : 1,
    avatar: ai >= 0 ? (cells[ai] ?? "").trim() : "",
  })).filter((r) => r.name);
}

/**
 * Merge Sheets players into current roster.
 * Matches by normalized name (stable ids keep fixtures valid).
 * Returns new roster + warnings (e.g. pots changed after draw).
 */
export function mergeSheetsPlayers(
  current: Player[], sheetRows: { name: string; pot: number; avatar?: string }[]
): { players: Player[]; warnings: string[] } {
  const warnings: string[] = [];
  const curByName = new Map(current.map((p) => [p.name.trim().toLowerCase(), p]));
  const seen = new Set<string>();
  const next: Player[] = [];
  let n = 0;
  for (const r of sheetRows) {
    const key = r.name.toLowerCase();
    if (seen.has(key)) { warnings.push(`Players sheet: duplicate '${r.name}' — kept first.`); continue; }
    seen.add(key);
    const existing = curByName.get(key);
    if (existing) {
      if (existing.pot !== r.pot)
        warnings.push(`'${r.name}' moved Pot ${existing.pot} → ${r.pot}. Redraw league if draw already done.`);
      // an empty avatar cell must not wipe an image set in config/local files
      next.push({ ...existing, name: r.name, pot: r.pot, avatar: r.avatar || existing.avatar || "" });
    } else {
      n++;
      next.push({ id: `p-sheets-${next.length + 1}`, name: r.name, pot: r.pot, avatar: r.avatar || "" });
    }
  }
  // validate equal pot sizes
  const byPot = new Map<number, number>();
  next.forEach((p) => byPot.set(p.pot, (byPot.get(p.pot) ?? 0) + 1));
  const sizes = [...byPot.values()];
  if (sizes.length > 0 && !sizes.every((s) => s === sizes[0]))
    warnings.push(`Pots unequal (${[...byPot.entries()].map(([k, v]) => `Pot ${k}: ${v}`).join(", ")}). League draw needs equal pots.`);
  const removed = current.filter((p) => !seen.has(p.name.trim().toLowerCase()));
  if (removed.length > 0)
    warnings.push(`Removed from sheet (kept in app until redraw): ${removed.map((p) => p.name).join(", ")}`);
  return { players: next.length > 0 ? next : current, warnings };
}

/** Players CSV template for volunteers. */
export function buildPlayersTemplate(players: Player[]): string {
  const esc = (v: string) => (v.includes(",") ? `"${v}"` : v);
  return ["name,pot,avatar", ...players.map((p) => `${esc(p.name)},${p.pot},${esc(p.avatar ?? "")}`)].join("\n");
}

/** Parse Google Sheets published CSV (Results tab) into partial match updates. */
export function parseSheetsCSV(csv: string): SheetsResultRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (k: string) => head.indexOf(k);
  return lines.slice(1).map((line) => {
    // minimal CSV parse supporting quoted commas
    const cells: string[] = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    const get = (k: string) => (idx(k) >= 0 ? (cells[idx(k)] ?? "").trim().replace(/^"|"$/g, "") : "");
    return {
      match_id: get("match_id"), stage: get("stage"), round: get("round"),
      player_a: get("player_a"), player_b: get("player_b"),
      score_a: get("score_a"), score_b: get("score_b"),
      played: get("played"), winner: get("winner"), updated_at: get("updated_at"),
    };
  }).filter((r) => r.match_id);
}

const STAGES: Stage[] = ["league", "playoff", "r16", "qf", "sf", "final", "third"];
function normStage(s: string): Stage {
  const t = s.trim().toLowerCase();
  return (STAGES as string[]).includes(t) ? (t as Stage) : "league";
}

/**
 * Merge Sheets rows into matches with LAST-WRITE-WINS per match.
 * - Rows for ids in pendingIds (unsynced local edits) are skipped — local wins until pushed.
 * - Otherwise sheet wins only if row.updated_at is newer than match.updatedAt (or local has none).
 * - Rows without updated_at fall back to overwrite-if-played-data-present to stay backward compatible.
 */
export function mergeSheetsIntoMatches(
  base: Match[],
  rows: SheetsResultRow[],
  nameToId: Map<string, string>,
  opts?: { pendingIds?: Set<string> }
): { matches: Match[]; errors: string[]; applied: string[] } {
  const errors: string[] = [];
  const applied: string[] = [];
  const pending = opts?.pendingIds ?? new Set<string>();
  const byId = new Map(base.map((m) => [m.id, { ...m }]));
  for (const r of rows) {
    const m = byId.get(r.match_id);
    if (!m) { errors.push(`Sheets: unknown match_id ${r.match_id} — check export.`); continue; }
    if (pending.has(r.match_id)) continue; // unsynced local edit wins for now
    if (r.stage && normStage(r.stage) !== m.stage)
      errors.push(`Sheets: ${r.match_id} stage '${r.stage}' != app '${m.stage}'.`);
    // validate names if provided (skipped on undecided fixed-bracket ties: W(...) placeholders)
    const undecided = (id: string) => typeof id === "string" && id.startsWith("W(");
    if (r.player_a && !undecided(m.playerA) && !undecided(m.playerB)) {
      const id = nameToId.get(r.player_a.trim().toLowerCase());
      if (!id) errors.push(`Sheets: ${r.match_id} unknown player '${r.player_a}'. Names must match exactly.`);
      else if (id !== m.playerA && id !== m.playerB) errors.push(`Sheets: ${r.match_id} '${r.player_a}' not in this fixture.`);
    }
    const sheetTime = r.updated_at ? Date.parse(r.updated_at) : NaN;
    const localTime = m.updatedAt ? Date.parse(m.updatedAt) : NaN;
    const hasSheetData = r.score_a !== "" || r.score_b !== "" || r.winner !== "";
    if (!hasSheetData && !r.played) continue; // blank pre-filled row — nothing to apply
    if (!Number.isNaN(sheetTime) && !Number.isNaN(localTime) && sheetTime <= localTime) continue; // local is newer — keep
    const played = ["true", "1", "yes", "y", "done"].includes(r.played.trim().toLowerCase());
    const sa = r.score_a === "" ? null : Number(r.score_a);
    const sb = r.score_b === "" ? null : Number(r.score_b);
    if ((sa != null && Number.isNaN(sa)) || (sb != null && Number.isNaN(sb))) {
      errors.push(`Sheets: ${r.match_id} scores must be numbers.`); continue;
    }
    m.scoreA = sa; m.scoreB = sb; m.played = played && sa != null && sb != null;
    if (!Number.isNaN(sheetTime)) m.updatedAt = new Date(sheetTime).toISOString();
    if (r.winner) {
      const wid = nameToId.get(r.winner.trim().toLowerCase());
      if (!wid) errors.push(`Sheets: ${r.match_id} unknown winner '${r.winner}'.`);
      else if (m.stage === "league") m.goldenGoalWinner = null;
      else m.penaltyWinner = wid;
    } else if (m.stage !== "league") {
      m.penaltyWinner = null;
    }
    applied.push(r.match_id);
  }
  return { matches: [...byId.values()], errors, applied };
}

/**
 * Build PRE-FILLED Results CSV: every column except the result is filled.
 * Volunteers only touch score_a, score_b, played, winner. match_id is the immutable key.
 */
export function buildSheetsTemplate(matches: Match[], idToName: Map<string, string>): string {
  const esc = (v: string) => (v.includes(",") ? `"${v}"` : v);
  const lines = ["match_id,stage,round,player_a,player_b,score_a,score_b,played,winner,updated_at"];
  for (const m of matches) {
    const a = idToName.get(m.playerA) ?? m.playerA;
    const b = idToName.get(m.playerB) ?? m.playerB;
    const round = m.stage === "league" ? `Matchday ${m.matchday ?? 1}` : m.stage.toUpperCase();
    lines.push([m.id, m.stage, round, esc(a), esc(b), m.scoreA ?? "", m.scoreB ?? "", m.played ? "TRUE" : "FALSE", winnerName(m, idToName), m.updatedAt ?? ""].join(","));
  }
  return lines.join("\n");
}

function winnerName(m: Match, idToName: Map<string, string>): string {
  const w = m.penaltyWinner ?? m.goldenGoalWinner;
  return w ? (idToName.get(w) ?? "") : "";
}

export async function fetchCSV(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status}`);
  return res.text();
}
