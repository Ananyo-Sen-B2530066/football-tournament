// POST /api/control — every structural change: draws, roster, settings,
// projector control, tie resolution, reset. OWNER PIN ONLY (server-side).
//
// The draw engine runs on the owner client (it must, for the ceremony), so
// the client posts the generated ties here. This route re-validates the
// structural guards so a malformed or premature draw can't be committed.

import { ownerAllowed, denied } from "@/lib/server/auth";
import {
  applyScore, cancelDraw, confirmDraw, drawControl, getState, importState,
  qualifiedIds, resetAll, resultsBlocked, rosterLocked, setExternalQualifiers, setProjection,
  RosterLocked, setResultsSuppressed, setRoster, setSettings, setTournamentName, stageDraw,
} from "@/lib/server/store";
import { computeTable, cutoffTies, resolveExternalQualifiers, slotsForTie } from "@/lib/table";
import { hasUnresolvedPlaceholders, isPlaceholder, matchWinner, propagateWinners } from "@/lib/draw";
import { DrawKind, Match, TournamentState } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Structural guards re-checked server-side before a draw can be staged. */
function guardStageDraw(s: TournamentState, kind: DrawKind, matches: Match[]): string | null {
  if (!Array.isArray(matches) || matches.length === 0) return "No ties generated.";
  if (kind === "league") {
    if (s.players.length < 2) return "Add players before drawing.";
    return null;
  }
  const resolved = propagateWinners(s.knockout);
  if (kind === "ko1") {
    if (s.league.length === 0) return "Run the league draw first.";
    if (!s.league.every((m) => m.played)) return "Finish all league scores first.";
    const base = qualifiedIds(s);
    if (base.length !== s.qualifiers)
      return `Need exactly ${s.qualifiers} qualified, have ${base.length}.`;
    return null;
  }
  // ko2 — fresh SF draw from decided QF winners
  const qf = resolved.filter((m) => m.stage === "qf");
  if (qf.length === 0) return "No QFs yet — run Knockout Draw #1 first.";
  if (hasUnresolvedPlaceholders(qf)) return "Some QF ties still await R16 winners. Finish all R16s first.";
  if (!qf.every((m) => matchWinner(m))) return "Finish all QFs first (level ties need a pens winner pick).";
  return null;
}

export async function POST(req: Request) {
  if (!ownerAllowed(req)) return denied("Owner");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON." }, 400);
  }
  const { action } = body ?? {};
  const s = getState();

  switch (action) {
    case "settings":
      return json({ ok: true, state: setSettings({ qualifiers: body.qualifiers, matchesPerPlayer: body.matchesPerPlayer }) });

    case "projection":
      return json({ ok: true, state: setProjection({ pages: body.pages, rotate: body.rotate }) });

    case "name": {
      try {
        return json({ ok: true, state: setTournamentName(body.name) });
      } catch (e: any) {
        return json({ ok: false, error: e?.message ?? "Bad name." }, 400);
      }
    }

    case "results": {
      const blocked = resultsBlocked();
      if (blocked) return json({ ok: false, error: blocked }, 409);
      return json({ ok: true, state: setResultsSuppressed(body.suppressed) });
    }

    case "roster": {
      const locked = rosterLocked();
      if (locked) return json({ ok: false, error: locked }, 409);
      try {
        return json({ ok: true, state: setRoster(body.players ?? [], body.matchesPerPlayer) });
      } catch (e: any) {
        if (e instanceof RosterLocked) return json({ ok: false, error: e.message }, 409);
        return json({ ok: false, error: e?.message ?? "Bad roster." }, 400);
      }
    }

    case "stageDraw": {
      const kind = body.kind as DrawKind;
      if (!["league", "ko1", "ko2"].includes(kind)) return json({ ok: false, error: "Bad draw kind." }, 400);
      const err = guardStageDraw(s, kind, body.matches);
      if (err) return json({ ok: false, error: err }, 409);
      // A tie may hold W(...) sides as long as it records `feedsFrom` — that is
      // how the Final stays W(SF-01) v W(SF-02) until the semis are won.
      // But a tie with placeholder sides AND no feedsFrom can never resolve: it
      // is unscoreable and only a reset clears it. A bug in the owner page once
      // posted exactly that, so the server refuses it outright.
      if (kind === "ko2") {
        const dead = (body.matches ?? []).find(
          (m: Match) =>
            (isPlaceholder(m.playerA) || isPlaceholder(m.playerB)) &&
            !(Array.isArray(m.feedsFrom) && m.feedsFrom.length === 2)
        );
        if (dead)
          return json({ ok: false, error: `${dead.id} has unresolved slots but no feeders (${dead.playerA} v ${dead.playerB}). A tie must either name two real players or record which ties feed it.` }, 409);
      }
      return json({ ok: true, state: stageDraw(kind, body.matches) });
    }

    case "drawControl":
      return json({ ok: true, state: drawControl(body.which, body.value) });

    case "cancelDraw":
      return json({ ok: true, state: cancelDraw() });

    case "confirmDraw": {
      const pd = s.pendingDraw;
      if (!pd) return json({ ok: false, error: "No pending draw." }, 409);
      // don't let a draw be committed with ties the audience never saw
      if (pd.revealed < pd.matches.length)
        return json({ ok: false, error: `Reveal all ${pd.matches.length} ties before confirming.` }, 409);
      const r = confirmDraw();
      return json({ ok: r.ok, error: r.error, state: r.state }, r.ok ? 200 : 409);
    }

    case "tieResolve": {
      const table = computeTable(s.players, s.league);
      const ties = cutoffTies(table, s.qualifiers);
      if (ties.length === 0) return json({ ok: false, error: "No cut tie to resolve." }, 409);
      const pool = ties[0];
      const res = resolveExternalQualifiers(table, pool, body.picks ?? [], s.qualifiers);
      if (!res.ok) return json({ ok: false, error: res.error }, 409);
      const sig = [...pool.map((r) => r.playerId).sort(), `slots:${slotsForTie(table, pool, s.qualifiers)}`, `q:${s.qualifiers}`].join("|");
      return json({ ok: true, state: setExternalQualifiers({ ids: res.ids, at: new Date().toISOString(), sig }) });
    }

    case "clearTie":
      return json({ ok: true, state: setExternalQualifiers(null) });

    case "score":
      // owner page can also score (e.g. from a desktop)
      return json(applyScore(body.patch ?? body));

    case "reset":
      return json({ ok: true, state: resetAll() });

    case "import":
      return json({ ok: true, state: importState(body.state) });

    default:
      return json({ ok: false, error: `Unknown action '${action}'.` }, 400);
  }
}
