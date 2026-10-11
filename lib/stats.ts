// ============================================================
// Tournament statistics for the results page.
// ------------------------------------------------------------
// One pass over league + knockout ties. Nothing here changes how
// results are RECORDED — the numbers are derived on the fly, so a
// corrected score is reflected immediately.
//
// Kept free of React (and of any non-type local import) so
// scripts/verify.mjs can import and test the real implementation.
// ============================================================

import type { Match, Player } from "./types";

export interface TournamentStats {
  playerId: string;
  name: string;
  gamerId: string;
  apps: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  conceded: number;
  gd: number;
  cleanSheets: number;
  /** Largest margin this player won by (0 if they never won). */
  biggestWin: number;
  /** The tie that margin came from, for a human-readable caption. */
  biggestWinMatchId?: string;
  biggestWinOpponent?: string;
  /**
   * The ACTUAL goals from that win, not the margin. The results caption used to
   * print `biggestWin` followed by a hard-coded 0, which turned a 6-2 win into
   * "4-0" — a fabricated scoreline on the closing screen. These three fields
   * exist so the caption can only ever tell the truth.
   */
  /** Goals the player scored in that win. */
  biggestWinScoreSelf?: number;
  /** Goals the opponent scored in that win. */
  biggestWinScoreAgainst?: number;
  /**
   * True when the player was the AWAY side (playerB) in the recorded fixture.
   * Without this a 2-4 away win reads exactly like a 2-4 home loss.
   */
  biggestWinAway?: boolean;
}

const isPh = (v: string) => typeof v === "string" && v.startsWith("W(");

function blank(player: Player): TournamentStats {
  return {
    playerId: player.id,
    name: player.name,
    gamerId: player.id, // gamer_id IS the player id
    apps: 0, wins: 0, draws: 0, losses: 0,
    goals: 0, conceded: 0, gd: 0, cleanSheets: 0,
    biggestWin: 0,
  };
}

/**
 * Winner of a played tie, from the point of view of the recorded sides.
 *  - a level knockout tie is a WIN for penaltyWinner, not a draw
 *  - a level league tie is a genuine draw
 */
function winnerOf(m: Match): string | null {
  if (m.scoreA == null || m.scoreB == null) return null;
  if (m.scoreA > m.scoreB) return m.playerA;
  if (m.scoreB > m.scoreA) return m.playerB;
  if (m.stage !== "league" && m.penaltyWinner) return m.penaltyWinner;
  return null;
}

/** Compute per-player stats across the league and the knockout. */
/**
 * Record a win, and remember the biggest one along with everything the caption
 * needs to describe it honestly.
 *
 * All four fields move together on purpose: a margin without its scoreline is
 * how "4-0" got printed for a 6-2 game in the first place. `self`/`opp` are
 * from the WINNER's point of view; `away` records which side they were on.
 *
 * A level tie won on penalties has a margin of 0, so it can never become a
 * "biggest win" — correct, since there is no goal difference to brag about.
 */
function noteWin(
  me: TournamentStats, opp: TournamentStats,
  m: Match, self: number, oppGoals: number, away: boolean,
) {
  me.wins++;
  opp.losses++;
  if (self - oppGoals > me.biggestWin) {
    me.biggestWin = self - oppGoals;
    me.biggestWinMatchId = m.id;
    me.biggestWinOpponent = opp.name;
    me.biggestWinScoreSelf = self;
    me.biggestWinScoreAgainst = oppGoals;
    me.biggestWinAway = away;
  }
}

export function tournamentStats(players: Player[], league: Match[], knockout: Match[]): TournamentStats[] {
  const rows = new Map<string, TournamentStats>(players.map((p) => [p.id, blank(p)]));

  const apply = (m: Match) => {
    if (m.scoreA == null || m.scoreB == null) return;
    if (isPh(m.playerA) || isPh(m.playerB)) return; // locked bracket slot
    const A = rows.get(m.playerA);
    const B = rows.get(m.playerB);
    if (!A || !B) return; // player not on the roster (shouldn't happen)

    const a = m.scoreA, b = m.scoreB;
    A.apps++; B.apps++;
    A.goals += a; A.conceded += b;
    B.goals += b; B.conceded += a;
    if (b === 0) A.cleanSheets++;
    if (a === 0) B.cleanSheets++;

    const w = winnerOf(m);
    if (w === m.playerA) noteWin(A, B, m, a, b, false);
    else if (w === m.playerB) noteWin(B, A, m, b, a, true);
    else { A.draws++; B.draws++; }
  };

  league.forEach(apply);
  knockout.forEach(apply);
  rows.forEach((r) => { r.gd = r.goals - r.conceded; });
  return [...rows.values()];
}

// ============================================================
// Credits — a top-5 leaderboard per statistic.
// ============================================================

export interface CreditEntry {
  rank: number;
  stats: TournamentStats;
  value: number;
}

export interface CreditBoard {
  key: string;
  title: string;
  /** Makes the direction obvious: a 2 is good here but not on Top scorer. */
  hint: string;
  unit: string;
  /** true when a LOW value is the good one. */
  lowerIsBetter: boolean;
  entries: CreditEntry[];
  /** How many shared the 5th value but were cut by the row cap. */
  moreTied: number;
}

export const CREDIT_LIMIT = 5;
export const CREDIT_ROW_CAP = 10;

const BOARD_DEFS: {
  key: string; title: string; hint: string; unit: string; lowerIsBetter: boolean;
  value: (s: TournamentStats) => number;
}[] = [
  { key: "scorer", title: "TOP SCORER", hint: "most goals", unit: "goals", lowerIsBetter: false, value: (s) => s.goals },
  { key: "defence", title: "BEST DEFENCE", hint: "fewest conceded", unit: "conceded", lowerIsBetter: true, value: (s) => s.conceded },
  { key: "wins", title: "MOST WINS", hint: "most wins", unit: "wins", lowerIsBetter: false, value: (s) => s.wins },
  { key: "losses", title: "FEWEST DEFEATS", hint: "fewest defeats", unit: "defeated", lowerIsBetter: true, value: (s) => s.losses },
  { key: "cleans", title: "MOST CLEAN SHEETS", hint: "clean sheets", unit: "clean sheets", lowerIsBetter: false, value: (s) => s.cleanSheets },
  { key: "margin", title: "BIGGEST WIN", hint: "largest winning margin", unit: "goals", lowerIsBetter: false, value: (s) => s.biggestWin },
  { key: "gd", title: "BEST GOAL DIFFERENCE", hint: "best goal difference", unit: "GD", lowerIsBetter: false, value: (s) => s.gd },
];

/**
 * Top CREDIT_LIMIT for a stat, in competition-ranking style: equal values
 * share a rank and the next rank skips (9,7,5,5,2 -> 1,2,3,3,5). Everyone
 * tied on the 5th value is included, so the list may run past five rows.
 *
 * Players with 0 matches are excluded everywhere — without that, someone who
 * never played would top "fewest conceded" and "fewest defeats" on zeroes.
 */
export function creditBoard(
  stats: TournamentStats[],
  key: string,
  limit = CREDIT_LIMIT,
  rowCap = CREDIT_ROW_CAP
): CreditBoard | null {
  const def = BOARD_DEFS.find((b) => b.key === key);
  if (!def) return null;
  const eligible = stats.filter((s) => s.apps > 0);
  if (eligible.length === 0) return null;

  const sorted = [...eligible].sort((a, b) => {
    const d = def.value(a) - def.value(b);
    return def.lowerIsBetter ? d : -d; // ascending when fewer is better
  });

  // Competition ranking: equal values share a rank, the next rank skips.
  // Because a tie keeps the same rank, "rank > limit" is exactly the point
  // where a row falls outside the top-5 group — so everyone tied on 5th comes
  // along for free and the list can run to 6-7 rows.
  const entries: CreditEntry[] = [];
  let rank = 0;
  let prev: number | null = null;
  let capped = false;
  for (const s of sorted) {
    const v = def.value(s);
    if (prev === null || v !== prev) rank = entries.length + 1;
    prev = v;
    if (rank > limit) break;
    entries.push({ rank, stats: s, value: v });
    if (entries.length >= rowCap) { capped = true; break; }
  }

  // if the row cap bit, say how many shared the last shown value
  const last = entries.length ? entries[entries.length - 1].value : null;
  let moreTied = 0;
  if (capped && last !== null) {
    const shown = entries.filter((e) => e.value === last).length;
    moreTied = Math.max(0, eligible.filter((s) => def.value(s) === last).length - shown);
  }

  return {
    key: def.key,
    title: def.title,
    hint: def.hint,
    unit: def.unit,
    lowerIsBetter: def.lowerIsBetter,
    entries,
    moreTied,
  };
}

export const CREDIT_KEYS = BOARD_DEFS.map((b) => b.key);
export const CREDIT_META = BOARD_DEFS;

// ============================================================
// Podium
// ============================================================

export interface Podium {
  champion: TournamentStats | null;
  runnerUp: TournamentStats | null;
  third: TournamentStats | null;
  /** Why 3rd is missing, so the UI can explain rather than show a gap. */
  thirdNote?: string;
}

/**
 * Top 3 = champion, runner-up, 3rd place. Third place comes from the
 * 3rd-place tie when it was played; otherwise both semi-final losers are
 * joint third, which is honest rather than inventing a ranking.
 */
export function podium(stats: TournamentStats[], league: Match[], knockout: Match[]): Podium {
  const byId = new Map(stats.map((s) => [s.playerId, s]));
  const final = knockout.find((m) => m.stage === "final");
  const thirdTie = knockout.find((m) => m.stage === "third");

  if (!final || !final.played || final.scoreA == null || final.scoreB == null)
    return { champion: null, runnerUp: null, third: null };

  const championId = winnerOf(final);
  if (!championId) return { champion: null, runnerUp: null, third: null };
  const runnerId = championId === final.playerA ? final.playerB : final.playerA;

  let third: TournamentStats | null = null;
  let thirdNote: string | undefined;
  if (thirdTie && thirdTie.played) {
    const t = winnerOf(thirdTie);
    if (t) third = byId.get(t) ?? null;
  }
  if (!third) {
    // joint 3rd: the two semi-final losers, most recent first for stability
    const losers = knockout
      .filter((m) => m.stage === "sf" && m.played)
      .map((m) => (m.scoreA! > m.scoreB! ? m.playerB : m.playerA))
      .map((id) => byId.get(id))
      .filter((s): s is TournamentStats => !!s);
    if (losers.length === 2) {
      third = losers[0];
      thirdNote = `Joint 3rd with ${losers[1].name} — the 3rd-place tie was not played`;
    }
  }

  return {
    champion: byId.get(championId) ?? null,
    runnerUp: byId.get(runnerId) ?? null,
    third,
    thirdNote,
  };
}

/**
 * "Tournament finished" = the final is decided AND, when 3rd place is part of
 * the format, that tie has been played too. The `thirdPlaceEnabled` escape
 * matters: with 3rd place switched off it can never be played, so requiring
 * it would make the tournament permanently unfinishable.
 */
export function tournamentFinished(knockout: Match[], thirdPlaceEnabled: boolean): boolean {
  const final = knockout.find((m) => m.stage === "final");
  if (!final || !final.played || !winnerOf(final)) return false;
  if (!thirdPlaceEnabled) return true;
  const third = knockout.find((m) => m.stage === "third");
  return !!third && third.played && !!winnerOf(third);
}
