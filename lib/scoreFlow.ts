// Single definition of "does this tie still need a human?", shared by the
// score card, the To score / Completed filter and the queue counter so those
// three can never disagree about what is left to do.

import type { Match } from "./types";

/** Fixed-bracket tie whose feeders aren't decided yet — can't be scored. */
export function isLocked(m: Match): boolean {
  return (
    (typeof m.playerA === "string" && m.playerA.startsWith("W(")) ||
    (typeof m.playerB === "string" && m.playerB.startsWith("W("))
  );
}

/** Level knockout tie that still needs an explicit winner pick. */
export function needsWinner(m: Match): boolean {
  return m.played && m.scoreA === m.scoreB && !m.penaltyWinner && m.stage !== "league";
}

/** Unscored ties, plus knockout ties still awaiting a winner. */
export function needsAction(m: Match): boolean {
  if (isLocked(m)) return false;
  if (!m.played) return true;
  if (m.stage === "league") return false; // a league draw is a final result
  return needsWinner(m);
}

/** Recorded AND fully decided — safe to show as completed. */
export function isResolved(m: Match): boolean {
  return m.played && !needsAction(m);
}

/** Both sides filled — the only time a result may be committed. */
export function isCompleteScore(a: number | null, b: number | null): boolean {
  return a != null && b != null;
}

/** Why a commit is blocked, or null when it's good to go. */
export function commitBlocker(
  m: Match, a: number | null, b: number | null, winner: string | null
): string | null {
  if (!isCompleteScore(a, b)) return "set both scores";
  if (m.stage !== "league" && a === b && !winner) return "pick a winner";
  return null;
}

// ============================================================
// Draft pruning — a pure rule, so it lives with the other pure
// rules and can be unit-tested without touching storage/React.
// ============================================================

export interface ScoreDraftValue {
  a: number | null;
  b: number | null;
  winner: string | null;
}

/** Drop drafts for ties that no longer exist or are already resolved.
 *  Pure so it can be tested directly. */
export function pruneDrafts(
  drafts: Record<string, ScoreDraftValue>,
  matches: Match[]
): Record<string, ScoreDraftValue> {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const out: Record<string, ScoreDraftValue> = {};
  for (const [id, d] of Object.entries(drafts)) {
    const m = byId.get(id);
    if (!m) continue; // match gone (redraw / reset)
    if (isResolved(m)) continue; // already confirmed by someone
    // nothing actually different from what's recorded — pointless draft
    if (d.a === m.scoreA && d.b === m.scoreB && (d.winner ?? null) === (m.penaltyWinner ?? null)) continue;
    out[id] = d;
  }
  return out;
}
