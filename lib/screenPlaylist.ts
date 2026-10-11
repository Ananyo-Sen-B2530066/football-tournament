// Pure decision function for the projection site. Kept free of React so the
// whole state machine can be unit-tested in scripts/verify.mjs — this is the
// part that decides what the audience sees, so it shouldn't only be verified
// by staring at a projector.

import type { DrawKind } from "./types";

export type ScreenStatus = "group-running" | "group-complete";

/** A page the projector can show. "knockout" is not tickable — it is simply
 *  what the projector shows once the bracket exists. */
export type PageId = "table" | "knockout" | string;

export type ScreenPlan =
  | { kind: "ceremony" }
  | { kind: "results" }
  | { kind: "not-prepared" }
  | { kind: "status"; status: ScreenStatus }
  | { kind: "rotate"; pages: PageId[]; fallback: boolean };

export interface ScreenInput {
  hasPendingDraw: boolean;
  leagueCount: number;
  knockoutCount: number;
  qualifiers: number;
  sfDrawDone: boolean;
  leagueDone: boolean;
  matchdays: number[];
  projection: { pages: string[]; rotate: boolean };
  /** Tournament over (final decided, and 3rd place if it's in the format). */
  tournamentFinished: boolean;
  resultsSuppressed: boolean;
}

/** Build ScreenInput from the shared state + derived values, so the home page
 *  and the projector feed the exact same numbers into planScreen(). */
export function screenInput(
  s: {
    pendingDraw: unknown;
    league: unknown[];
    knockout: unknown[];
    qualifiers: number;
    sfDrawDone: boolean;
    projection: { pages: string[]; rotate: boolean };
    resultsSuppressed?: boolean;
  },
  d: { leagueDone: boolean; matchdays: number[]; tournamentFinished: boolean },
  /** Lets the projector locally "peek" past the results without the owner code. */
  overrides?: { ignoreResults?: boolean }
): ScreenInput {
  return {
    hasPendingDraw: !!s.pendingDraw,
    leagueCount: s.league.length,
    knockoutCount: s.knockout.length,
    qualifiers: s.qualifiers,
    sfDrawDone: s.sfDrawDone,
    leagueDone: d.leagueDone,
    matchdays: d.matchdays,
    projection: s.projection,
    tournamentFinished: d.tournamentFinished,
    resultsSuppressed: s.resultsSuppressed === true || overrides?.ignoreResults === true,
  };
}

export const isPageId = (v: unknown): v is string => typeof v === "string" && /^(md\d+|table)$/.test(v);

/**
 * Turn the owner's ticked page list into the pages the projector will actually
 * cycle through. Pure, so it can be unit-tested and previewed on the owner page
 * before the audience ever sees it.
 *
 *  - Knockout stage: the bracket is always shown; the table only if ticked.
 *  - Group stage: the ticked matchdays that still exist, then the table.
 *  - Nothing ticked during the group stage: fall back to the table, so the
 *    projector can never end up blank mid-event.
 */
export function resolvePages(
  ticked: string[],
  ctx: { matchdays: number[]; hasTable: boolean; knockout: boolean }
): { pages: PageId[]; fallback: boolean } {
  const set = new Set((ticked ?? []).filter(isPageId));
  const wantTable = ctx.hasTable && set.has("table");

  if (ctx.knockout) {
    const pages: PageId[] = ["knockout"];
    if (wantTable) pages.push("table");
    return { pages, fallback: false };
  }

  const pages: PageId[] = [];
  for (const d of ctx.matchdays) {
    const key = `md${d}`;
    if (set.has(key) && !pages.includes(key)) pages.push(key);
  }
  if (wantTable) pages.push("table");

  if (pages.length === 0) {
    if (!ctx.hasTable) return { pages: [], fallback: true };
    return { pages: ["table"], fallback: true };
  }
  return { pages, fallback: false };
}

/** Priority: ceremony > results > not-prepared > rotate > status.
 *  Ceremony stays above results on purpose: if a draw is ever staged after the
 *  final (a re-draw), the live draw must not be hidden behind a podium. */
export function planScreen(i: ScreenInput): ScreenPlan {
  // 1. a staged draw takes over the whole screen — group AND knockout
  if (i.hasPendingDraw) return { kind: "ceremony" };

  // 2. the tournament is over and the owner hasn't held the results back
  if (i.tournamentFinished && !i.resultsSuppressed) return { kind: "results" };

  // 3. nothing has been drawn at all
  if (i.leagueCount === 0 && i.knockoutCount === 0) return { kind: "not-prepared" };

  const { pages, fallback } = resolvePages(i.projection.pages, {
    matchdays: i.matchdays,
    hasTable: true,
    knockout: i.knockoutCount > 0,
  });

  if (pages.length > 0) return { kind: "rotate", pages, fallback };

  // 3. last resort: no page is renderable at all
  return { kind: "status", status: i.leagueDone ? "group-complete" : "group-running" };
}

// ============================================================
// Human-readable stage description, derived from the SAME plan the
// projector uses — so the home page and the projector can never
// disagree about what stage the tournament is in.
// ============================================================

export type Tone = "idle" | "live" | "draw" | "done";

export interface StageSummary {
  label: string;
  tone: Tone;
  detail: string;
}

const DRAW_NAMES: Record<string, string> = {
  league: "Group stage draw",
  ko1: "Knockout draw #1",
  ko2: "Semi-final draw",
};

export const pageLabel = (p: PageId): string =>
  p === "table" ? "Point Table" : p === "knockout" ? "Knockout" : `Matchday ${p.replace(/^md/, "")}`;

export function describePlan(
  plan: ScreenPlan,
  ctx: {
    pendingKind?: DrawKind | null;
    championName?: string | null;
    tiesToScore?: number;
    matchdays?: number[];
    rosterSize?: number;
  } = {}
): StageSummary {
  const toScore = ctx.tiesToScore ?? 0;
  const bits: string[] = [];
  if (toScore > 0) bits.push(`${toScore} tie${toScore === 1 ? "" : "s"} to score`);
  if (plan.kind === "results") {
    bits.push("final standings + credits");
  } else if (plan.kind === "rotate" && plan.pages.length) {
    bits.push(`projector: ${plan.pages.map(pageLabel).join(", ")}${plan.fallback ? " (fallback)" : ""}`);
  }

  const detail = bits.join(" · ");
  const wrap = (label: string, tone: Tone): StageSummary => ({ label, tone, detail });

  if (plan.kind === "ceremony")
    return wrap(`🎲 ${DRAW_NAMES[ctx.pendingKind ?? ""] ?? "Draw"} in progress`, "draw");
  if (plan.kind === "results")
    return wrap(ctx.championName ? `🏆 Champion: ${ctx.championName}` : "🏆 Final standings", "done");
  if (plan.kind === "not-prepared")
    return wrap(
      (ctx.rosterSize ?? 0) > 0 ? "Waiting for the group draw" : "No tournament set up yet",
      "idle"
    );
  if (plan.kind === "status")
    return plan.status === "group-complete"
      ? wrap("Group stage complete — knockout draw next", "live")
      : wrap("Group stage running", "live");

  if (ctx.championName) return wrap(`🏆 Champion: ${ctx.championName}`, "done");
  return wrap(
    plan.pages.includes("knockout") ? "Knockout in progress" : "Group stage running",
    "live"
  );
}

