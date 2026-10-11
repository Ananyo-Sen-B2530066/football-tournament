import { POINTS_DRAW, POINTS_WIN } from "@/config/tournament.config";
import { Match, Player, TableRow } from "./types";
import { matchWinner } from "./draw";

export function computeTable(players: Player[], matches: Match[]): TableRow[] {
  const rows = new Map<string, TableRow>(
    players.map((p) => [
      p.id,
      { playerId: p.id, name: p.name, pot: p.pot, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] },
    ])
  );
  const league = matches.filter((m) => m.stage === "league" && m.played && m.scoreA != null && m.scoreB != null);
  // chronological for form
  league.forEach((m) => {
    const A = rows.get(m.playerA)!, B = rows.get(m.playerB)!;
    const a = m.scoreA!, b = m.scoreB!;
    A.p++; B.p++; A.gf += a; A.ga += b; B.gf += b; B.ga += a;
    if (a > b) { A.w++; A.pts += POINTS_WIN; B.l++; A.form.push("W"); B.form.push("L"); }
    else if (b > a) { B.w++; B.pts += POINTS_WIN; A.l++; B.form.push("W"); A.form.push("L"); }
    else { A.d++; B.d++; A.pts += POINTS_DRAW; B.pts += POINTS_DRAW; A.form.push("D"); B.form.push("D"); }
  });
  const out = [...rows.values()];
  out.forEach((r) => { r.gd = r.gf - r.ga; r.form = r.form.slice(-5); });
  out.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
  return out;
}

/** Find cut-off ties needing golden-goal playoff: rows level with last qualifier on pts+gd+gf. */
export function cutoffTies(table: TableRow[], qualifiers: number): TableRow[][] {
  if (table.length <= qualifiers) return [];
  const cut = table[qualifiers - 1];
  const tied = table.filter(
    (r) => r.pts === cut.pts && r.gd === cut.gd && r.gf === cut.gf
  );
  const spansCut = tied.some((_, i) => {
    const idx = table.indexOf(tied[i]);
    return idx < qualifiers && table.indexOf(tied[tied.length - 1]) >= qualifiers;
  });
  if (!spansCut || tied.length < 2) return [];
  return [tied];
}

/** Slots the tied group competes for = qualifiers minus rows already cleanly above the group. */
export function slotsForTie(table: TableRow[], tied: TableRow[], qualifiers: number): number {
  const firstIdx = table.indexOf(tied[0]);
  return Math.max(0, qualifiers - firstIdx);
}

export interface ExternalResolution {
  ok: boolean;
  ids: string[];
  error?: string;
}

/**
 * External tie resolution (decided OUTSIDE this app, e.g. separate tie-breaker UI).
 * Requires exactly `slots` selections, all within the tied pool.
 * Returns the final qualifier id list: clean top rows + confirmed names.
 */
export function resolveExternalQualifiers(
  table: TableRow[], tied: TableRow[], selectedIds: string[], qualifiers: number
): ExternalResolution {
  const pool = new Set(tied.map((r) => r.playerId));
  const uniq = [...new Set(selectedIds)];
  const slots = slotsForTie(table, tied, qualifiers);
  if (uniq.length !== slots)
    return { ok: false, ids: [], error: `Select exactly ${slots} player(s) — currently ${uniq.length}.` };
  const outsiders = uniq.filter((id) => !pool.has(id));
  if (outsiders.length > 0)
    return { ok: false, ids: [], error: "Selections must come from the tied pool only." };
  const keep = table.filter((r) => !pool.has(r.playerId)).slice(0, qualifiers - slots).map((r) => r.playerId);
  // preserve table order: walk table, take keep-rows and confirmed rows
  const confirmed = new Set(uniq);
  const ordered = table.filter((r) => keep.includes(r.playerId) || confirmed.has(r.playerId)).map((r) => r.playerId);
  if (ordered.length !== qualifiers)
    return { ok: false, ids: [], error: "Resolution does not fill exactly the qualifier count." };
  return { ok: true, ids: ordered };
}

export function unresolvedKnockout(matches: Match[]): Match[] {
  return matches.filter(
    (m) =>
      m.stage !== "league" &&
      m.played &&
      m.scoreA === m.scoreB &&
      !m.penaltyWinner &&
      !m.goldenGoalWinner
  );
}

export function winnerOf(m: Match): string | null {
  return matchWinner(m);
}
