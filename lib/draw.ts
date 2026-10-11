// TYPE-ONLY import on purpose. scripts/verify.mjs loads this module directly with
// Node's type-stripping loader, which erases `import type` but cannot resolve a
// runtime value import (it has no extension / no path-alias support). `mid`
// therefore lives HERE rather than in ./types, so this file has no runtime
// imports and the real engine - not a copy of it - is what gets tested.
import type { Match, Player, Stage } from "./types";

/** Match id for a stage/number pair, e.g. ("sf", 2) -> "SF-02". */
export function mid(stage: Stage, n: number): string {
  return `${stage.toUpperCase()}-${String(n).padStart(2, "0")}`;
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Assign players to pots by order (round-robin). Use Setup screen to re-shuffle. */
export function assignPots(names: string[], pots: number): Player[] {
  if (pots === 1) {
    return names.map((name, i) => ({ id: `p-${i + 1}`, name: name.trim(), pot: 1 }));
  }
  const per = Math.floor(names.length / pots);
  return names.map((name, i) => ({
    id: `p-${i + 1}`,
    name: name.trim(),
    pot: Math.floor(i / per) + 1,
  }));
}

export type LeagueMode = "single" | "twoPot" | "ucl";

/** Which league format the current player-pot split corresponds to. */
export function leagueModeOf(players: Player[]): LeagueMode {
  const pots = new Set(players.map((p) => p.pot)).size;
  if (pots === 1) return "single";
  if (pots === 2) return "twoPot";
  return "ucl";
}

/**
 * LEAGUE DRAW (UCL-style, neutral venue, true matchdays):
 * Built round-by-round: in each of (pots-1) matchdays, EVERY player plays
 * exactly once, against one opponent from a not-yet-faced OTHER pot.
 * Guarantees: 1 opponent per other pot, no intra-pot games, equal games,
 * and a proper Matchday 1 → matches → Matchday 2 → … fixture structure.
 * Requires an even total player count (else someone would sit out a round).
 */
export function drawLeague(players: Player[]): Match[] {
  const pots = [...new Set(players.map((p) => p.pot))].sort((a, b) => a - b);
  const byPot = new Map<number, Player[]>();
  pots.forEach((p) => byPot.set(p, players.filter((x) => x.pot === p)));
  const sizes = pots.map((p) => byPot.get(p)!.length);
  if (!sizes.every((s) => s === sizes[0]))
    throw new Error("All pots must be equal size for 1-per-other-pot draw.");
  if (players.length % 2 !== 0)
    throw new Error(
      `Odd player count (${players.length}) — every matchday needs everyone paired. Add/remove one player or change the pot split.`
    );

  const rounds = pots.length - 1;
  const potOf = new Map(players.map((p) => [p.id, p.pot]));

  for (let attempt = 0; attempt < 300; attempt++) {
    const faced = new Map<string, Set<number>>(players.map((p) => [p.id, new Set()]));
    const roundsPairs: [string, string][][] = [];
    let ok = true;
    for (let r = 0; r < rounds; r++) {
      const round = buildRound(shuffle(players.map((p) => p.id)), faced, potOf);
      if (!round) { ok = false; break; }
      for (const [a, b] of round) {
        faced.get(a)!.add(potOf.get(b)!);
        faced.get(b)!.add(potOf.get(a)!);
      }
      roundsPairs.push(round);
    }
    if (!ok) continue;
    // flatten round-major with stable within-day order (by pot-pair, then id)
    const matches: Match[] = [];
    let n = 0;
    roundsPairs.forEach((round, ri) => {
      const ordered = [...round].sort((x, y) =>
        potKey(x, potOf).localeCompare(potKey(y, potOf)) || x[0].localeCompare(y[0])
      );
      for (const [a, b] of ordered) {
        n++;
        matches.push({
          id: mid("league", n),
          stage: "league",
          playerA: a, playerB: b,
          scoreA: null, scoreB: null,
          played: false,
          matchday: ri + 1,
        });
      }
    });
    return matches;
  }
  throw new Error("Draw failed after 300 attempts — try Shuffle pots / re-run (registrations may need rebalancing).");
}

function potKey(pair: [string, string], potOf: Map<string, number>): string {
  const [x, y] = [potOf.get(pair[0])!, potOf.get(pair[1])!];
  return `${Math.min(x, y)}-${Math.max(x, y)}`;
}

/** Backtracking perfect matching over eligible pairs (MRV heuristic, node-capped). */
function buildRound(
  ids: string[], faced: Map<string, Set<number>>, potOf: Map<string, number>
): [string, string][] | null {
  const unpaired = new Set(ids);
  const pairs: [string, string][] = [];
  let nodes = 0;
  const eligible = (p: string): string[] => {
    const out: string[] = [];
    for (const q of unpaired) {
      if (q === p) continue;
      if (potOf.get(q) === potOf.get(p)) continue;
      if (faced.get(p)!.has(potOf.get(q)!)) continue;
      if (faced.get(q)!.has(potOf.get(p)!)) continue;
      out.push(q);
    }
    return out;
  };
  const dfs = (): boolean => {
    if (unpaired.size === 0) return true;
    if (++nodes > 30000) return false;
    // most-constrained player first
    let pick = "", best: string[] = [], bestN = Infinity;
    for (const p of unpaired) {
      const e = eligible(p);
      if (e.length === 0) return false;
      if (e.length < bestN) { bestN = e.length; pick = p; best = e; if (bestN === 1) break; }
    }
    for (const q of shuffle(best)) {
      unpaired.delete(pick); unpaired.delete(q);
      pairs.push([pick, q]);
      if (dfs()) return true;
      pairs.pop();
      unpaired.add(pick); unpaired.add(q);
    }
    return false;
  };
  return dfs() ? pairs : null;
}

/** Verify matchday structure: (pots-1) matchdays, everyone plays exactly once per day. */
export function verifyMatchdays(players: Player[], matches: Match[]): string[] {
  const errs: string[] = [];
  const pots = new Set(players.map((p) => p.pot)).size;
  const days = [...new Set(matches.map((m) => m.matchday ?? 0))].sort((a, b) => a - b);
  if (days.length !== pots - 1)
    errs.push(`Expected ${pots - 1} matchdays, got ${days.length}.`);
  for (const d of days) {
    const day = matches.filter((m) => m.matchday === d);
    if (day.length !== players.length / 2)
      errs.push(`Matchday ${d}: expected ${players.length / 2} ties, got ${day.length}.`);
    const seen = new Set<string>();
    for (const m of day) {
      for (const id of [m.playerA, m.playerB]) {
        if (seen.has(id)) {
          const nm = players.find((p) => p.id === id)?.name ?? id;
          errs.push(`Matchday ${d}: ${nm} plays twice.`);
        }
        seen.add(id);
      }
    }
    if (seen.size !== players.length)
      errs.push(`Matchday ${d}: ${seen.size}/${players.length} players scheduled (someone sits out).`);
  }
  return errs;
}

/** Verify fairness: every player has exactly (pots-1) games, one per other pot. */
export function verifyLeague(players: Player[], matches: Match[]): string[] {
  const errs: string[] = [];
  const pmap = new Map(players.map((p) => [p.id, p]));
  for (const p of players) {
    const mine = matches.filter((m) => m.playerA === p.id || m.playerB === p.id);
    const others = mine.map((m) => pmap.get(m.playerA === p.id ? m.playerB : m.playerA)!);
    if (mine.length !== new Set(players.map((x) => x.pot)).size - 1)
      errs.push(`${p.name}: expected ${new Set(players.map((x) => x.pot)).size - 1} games, got ${mine.length}`);
    if (others.some((o) => o.pot === p.pot)) errs.push(`${p.name}: intra-pot game found`);
    const potsFaced = others.map((o) => o.pot).sort().join(",");
    const expected = [...new Set(players.map((x) => x.pot))].filter((x) => x !== p.pot).sort().join(",");
    if (potsFaced !== expected) errs.push(`${p.name}: faced pots [${potsFaced}], expected [${expected}]`);
  }
  return errs;
}

/**
 * 2-POT LEAGUE: every player plays exactly 2, both vs the OTHER pot.
 * Two crossing rounds, second shifted so no opponent repeats.
 * Requires exactly 2 equal pots, N even, N ≥ 4.
 */
export function drawTwoPot(players: Player[]): Match[] {
  const pots = [...new Set(players.map((p) => p.pot))].sort((a, b) => a - b);
  if (pots.length !== 2) throw new Error("2-pot draw needs exactly 2 pots — set Pots to 2.");
  const byPot = new Map<number, Player[]>(pots.map((k) => [k, players.filter((p) => p.pot === k)]));
  const sizes = pots.map((k) => byPot.get(k)!.length);
  if (sizes[0] !== sizes[1]) throw new Error(`2-pot draw needs equal pots (got ${sizes.join("/")}). Use 1 pot (flexible) instead.`);
  if (players.length < 4) throw new Error("2-pot league needs at least 4 players.");
  if (players.length % 2 !== 0) throw new Error(`2-pot needs even player count (got ${players.length}).`);
  const A = shuffle(byPot.get(pots[0])!.map((p) => p.id));
  const B = shuffle(byPot.get(pots[1])!.map((p) => p.id));
  const k = A.length;
  const potOf = new Map(players.map((p) => [p.id, p.pot]));
  const matches: Match[] = [];
  let n = 0;
  // Matchday 1: A[i] vs B[i]
  for (let i = 0; i < k; i++) {
    n++;
    matches.push({ id: mid("league", n), stage: "league", playerA: A[i], playerB: B[i], scoreA: null, scoreB: null, played: false, matchday: 1 });
  }
  // Matchday 2: A[i] vs B[(i+1)%k] — shifted so no repeat
  for (let i = 0; i < k; i++) {
    n++;
    matches.push({ id: mid("league", n), stage: "league", playerA: A[i], playerB: B[(i + 1) % k], scoreA: null, scoreB: null, played: false, matchday: 2 });
  }
  // stable within-day display: sort each day by pot-key then id (caller sorts overall)
  void potOf;
  return matches;
}

export function verifyTwoPot(players: Player[], matches: Match[]): string[] {
  const errs: string[] = [];
  if (matches.length !== players.length) errs.push(`2-pot: expected ${players.length} ties (2 per player /2), got ${matches.length}.`);
  const byId = new Map(players.map((p) => [p.id, p]));
  const days = [...new Set(matches.map((m) => m.matchday ?? 0))].sort((a, b) => a - b);
  if (days.length !== 2) errs.push(`2-pot: expected 2 matchdays, got ${days.length}.`);
  for (const d of days) {
    const day = matches.filter((m) => m.matchday === d);
    if (day.length !== players.length / 2) errs.push(`Matchday ${d}: expected ${players.length / 2} ties, got ${day.length}.`);
    const seen = new Set<string>();
    for (const m of day) for (const id of [m.playerA, m.playerB]) {
      if (seen.has(id)) errs.push(`Matchday ${d}: ${byId.get(id)?.name ?? id} plays twice.`);
      seen.add(id);
    }
  }
  for (const p of players) {
    const mine = matches.filter((m) => m.playerA === p.id || m.playerB === p.id);
    if (mine.length !== 2) errs.push(`${p.name}: expected 2 games, got ${mine.length}.`);
    const opps = mine.map((m) => byId.get(m.playerA === p.id ? m.playerB : m.playerA)!);
    if (opps.some((o) => o.pot === p.pot)) errs.push(`${p.name}: has intra-pot game — 2-pot requires both vs opposite pot.`);
    if (new Set(opps.map((o) => o.id)).size !== opps.length) errs.push(`${p.name}: repeated opponent.`);
  }
  return errs;
}

/**
 * 1-POT FLEXIBLE LEAGUE: single pool, manager sets K distinct opponents each.
 * Circle-method partial round-robin. Even N => exactly K each. Odd N => rotating
 * byes, so players get K or K-1 (K must be even when N odd).
 */
export function drawFlexLeague(players: Player[], K: number): Match[] {
  const N = players.length;
  if (K < 1) throw new Error("Matches per player must be ≥ 1.");
  if (K > N - 1) throw new Error(`K=${K} > players-1 (${N - 1}).`);
  if (N % 2 !== 0 && K % 2 !== 0) throw new Error(`Odd player count (${N}) needs K even (got ${K}) so total matches is integer.`);
  if (N * K % 2 !== 0) throw new Error(`N=${N} × K=${K} must be even (total matches integer).`);
  const ids = players.map((p) => p.id);
  const rounds = buildFlexRounds(ids, K);
  const matches: Match[] = [];
  let n = 0;
  rounds.forEach((round, ri) => {
    const ordered = [...round].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [a, b] of ordered) {
      n++;
      matches.push({ id: mid("league", n), stage: "league", playerA: a, playerB: b, scoreA: null, scoreB: null, played: false, matchday: ri + 1 });
    }
  });
  return matches;
}

function buildFlexRounds(ids: string[], K: number): [string, string][][] {
  const N = ids.length;
  const even = N % 2 === 0;
  const arr: (string | null)[] = even ? [...ids] : [...ids, null]; // null = bye
  const M = arr.length; // even
  const totalRounds = M - 1; // N-1 if even, N if odd
  const need = Math.min(K, totalRounds);
  // circle method: fixed at 0, rotate the rest
  const rounds: [string, string][][] = [];
  const a = [...arr];
  for (let r = 0; r < need; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < M / 2; i++) {
      const x = a[i], y = a[M - 1 - i];
      if (x != null && y != null) round.push([x, y]);
    }
    if (round.length > 0) rounds.push(round);
    // rotate tail
    const last = a.pop()!;
    a.splice(1, 0, last);
  }
  return rounds;
}

export function verifyFlexLeague(players: Player[], matches: Match[], K: number): string[] {
  const errs: string[] = [];
  const N = players.length;
  const expectedMatches = Math.floor((N * K) / 2);
  // odd N with K even: M-1==N rounds taken K, one bye per round -> total real matches = K*(N-1)/2
  // For N odd, expected real = K*(N-1)/2  (since each round has one bye)
  const expectedFlex = N % 2 === 0 ? (N * K) / 2 : (K * (N - 1)) / 2;
  if (matches.length !== expectedFlex && matches.length !== expectedMatches)
    errs.push(`flex: expected ${expectedFlex} ties, got ${matches.length}.`);
  const byId = new Set(players.map((p) => p.id));
  for (const m of matches) {
    if (!byId.has(m.playerA) || !byId.has(m.playerB)) errs.push(`unknown player in ${m.id}`);
    if (m.playerA === m.playerB) errs.push(`${m.id}: self-pair.`);
  }
  // no repeated pairings
  const seen = new Set<string>();
  for (const m of matches) {
    const key = [m.playerA, m.playerB].sort().join("::");
    if (seen.has(key)) errs.push(`repeated pairing ${key} in ${m.id}`);
    seen.add(key);
  }
  for (const p of players) {
    const mine = matches.filter((m) => m.playerA === p.id || m.playerB === p.id);
    const want = N % 2 === 0 ? K : K; // odd allows K-1 due to bye
    if (N % 2 === 0) {
      if (mine.length !== K) errs.push(`${p.name}: expected ${K} games, got ${mine.length}.`);
    } else {
      if (mine.length !== K && mine.length !== K - 1) errs.push(`${p.name}: expected ${K} or ${K - 1} (bye), got ${mine.length}.`);
    }
    void want;
    if (new Set(mine.map((m) => (m.playerA === p.id ? m.playerB : m.playerA))).size !== mine.length)
      errs.push(`${p.name}: repeated opponent.`);
  }
  return errs;
}

/** Fixed-bracket placeholder ids look like W(R16-01). */
export function isPlaceholder(id: string): boolean {
  return typeof id === "string" && id.startsWith("W(");
}
export function hasUnresolvedPlaceholders(matches: Match[]): boolean {
  return matches.some((m) => isPlaceholder(m.playerA) || isPlaceholder(m.playerB));
}

/** Random knockout draw: shuffle entrants into pairs. */
export function drawKnockoutRound(
  entrantIds: string[], stage: Stage, startN = 1, feedsFromPairs?: [string, string][]
): Match[] {
  const s = shuffle(entrantIds);
  if (s.length % 2 !== 0) throw new Error("Knockout draw needs even entrants.");
  return s.reduce<Match[]>((acc, _, i) => {
    if (i % 2 === 0)
      acc.push({
        id: mid(stage, startN + acc.length),
        stage,
        playerA: s[i], playerB: s[i + 1],
        scoreA: null, scoreB: null, played: false,
        feedsFrom: feedsFromPairs?.[acc.length] ?? null,
      });
    return acc;
  }, []);
}

/**
 * A uniformly random pairing of n labelled items into n/2 unordered pairs.
 *
 * Used to decide WHICH previous-round tie feeds each next-round tie. Pairing 8
 * R16 ties into 4 QF ties has 7x5x3x1 = 105 possible outcomes; pairing 4 QF
 * ties into 2 SFs has 3; pairing 2 SFs into the Final has 1 (so the Final is
 * fixed, which is correct).
 *
 * Uniformity: take the lowest unpaired index, then give it a uniformly random
 * partner from whatever is left. That visits every perfect matching equally
 * often, rather than the biased result you get from a plain shuffle.
 *
 * `rand` is injectable purely so tests can force a specific pairing.
 */
export function randomPairing(n: number, rand: () => number = Math.random): number[][] {
  if (n % 2 !== 0) throw new Error("randomPairing needs an even number of feeders.");
  const left = Array.from({ length: n }, (_, i) => i);
  const pairs: number[][] = [];
  while (left.length) {
    const a = left.shift()!;
    const pick = Math.floor(rand() * left.length);
    const b = left.splice(pick, 1)[0];
    pairs.push(a < b ? [a, b] : [b, a]); // lower index first => exactly 105 outcomes
  }
  return pairs;
}

/**
 * Build the next round as placeholders fed by the current round's ties.
 *
 * The FEEDING IS DRAWN: pairing 8 R16 ties into 4 QF ties has 105 possible
 * schemes and this picks one at random, so the quarter-final pairings are
 * decided live in the same ceremony as the R16 draw — not pre-arranged
 * sequentially as W(R16-01) v W(R16-02), W(R16-03) v W(R16-04), ...
 *
 * The next round still exists as placeholders so the whole bracket is shown at
 * the end of that ceremony. Winners are filled in later by propagateWinners(),
 * which follows `feedsFrom` — so it resolves each tie from the feeders this
 * function actually chose, not by position.
 *
 * Pass `pairing` explicitly to pin the scheme (tests).
 */
export function buildFixedNextRound(
  fromIds: string[], nextStage: Stage, pairing?: number[][],
): Match[] {
  const pairs = pairing ?? randomPairing(fromIds.length);
  if (pairs.length !== fromIds.length / 2)
    throw new Error(`pairing has ${pairs.length} pairs for ${fromIds.length} feeders.`);
  return pairs.map(([a, b], i) => {
    const fa = fromIds[a];
    const fb = fromIds[b];
    if (fa === undefined || fb === undefined)
      throw new Error(`pairing index out of range: ${a},${b} for ${fromIds.length} feeders.`);
    return {
      id: mid(nextStage, i + 1),
      stage: nextStage,
      playerA: `W(${fa})`,
      playerB: `W(${fb})`,
      scoreA: null, scoreB: null, played: false,
      feedsFrom: [fa, fb],
    };
  });
}

export function matchWinner(m: Match): string | null {
  if (!m.played) return null;
  if (m.goldenGoalWinner) return m.goldenGoalWinner;
  // A recorded winner that isn't one of the two sides is corrupt data, not a
  // result — never let it propagate (it would fake a champion and break the
  // 3rd-place tie, whose loser can no longer be identified).
  if (m.penaltyWinner) {
    if (m.penaltyWinner !== m.playerA && m.penaltyWinner !== m.playerB) return null;
    return m.penaltyWinner;
  }
  if (m.scoreA == null || m.scoreB == null) return null;
  if (m.scoreA > m.scoreB) return isPlaceholder(m.playerA) ? null : m.playerA;
  if (m.scoreB > m.scoreA) return isPlaceholder(m.playerB) ? null : m.playerB;
  return null; // level knockout without penaltyWinner = unresolved
}

/** Fill fixed-bracket placeholders once feeders are decided.
 *  Resolves in dependency order so a regular-score SF winner (2-0) correctly
 *  feeds a real name into the Final — previous version returned the literal
 *  placeholder W(QF-*) as the SF winner, so FINAL stayed stuck on W(QF-*).
 */
export function propagateWinners(all: Match[]): Match[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  // depth = 0 if no feedsFrom, else 1+max(feeder depth)
  const depthCache = new Map<string, number>();
  const depth = (id: string): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const m = byId.get(id);
    if (!m || !m.feedsFrom) { depthCache.set(id, 0); return 0; }
    const d = 1 + Math.max(...m.feedsFrom.map(depth));
    depthCache.set(id, d);
    return d;
  };
  all.forEach((m) => depth(m.id));
  const ordered = [...all].sort((a, b) => (depthCache.get(a.id)! - depthCache.get(b.id)!));

  const winnerMap = new Map<string, string | null>();
  const resolvedMap = new Map<string, Match>();

  for (const orig of ordered) {
    let cur: Match = { ...orig };
    if (cur.feedsFrom) {
      const [a, b] = cur.feedsFrom;
      const wa = winnerMap.get(a);
      const wb = winnerMap.get(b);
      cur = {
        ...cur,
        playerA: wa ?? `W(${a})`,
        playerB: wb ?? `W(${b})`,
      };
    }
    resolvedMap.set(cur.id, cur);
    // computed on the RESOLVED match, so a feeder decided by a regular score
    // yields a real player id here rather than a leftover W(...) placeholder
    winnerMap.set(cur.id, matchWinner(cur));
  }

  return all.map((m) => resolvedMap.get(m.id)!);
}
