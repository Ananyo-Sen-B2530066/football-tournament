"use client";
// ============================================================
// Shared tournament state for /owner, /editor and /screen.
// ------------------------------------------------------------
// Polls GET /api/state?since=<revision> — the server answers 204 when
// nothing changed, so an idle phone costs ~0 bytes. Score writes are
// optimistic (instant on the device that typed them) and survive going
// offline via a small localStorage outbox, so a volunteer walking out
// of WiFi range doesn't lose a result.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { POLL_INTERVAL_MS, THIRD_PLACE } from "@/config/tournament.config";
import { cutoffTies, computeTable, slotsForTie } from "./table";
import { isPlaceholder, matchWinner, propagateWinners } from "./draw";
import * as stats from "./stats";
import { KO_STAGES, Match, TableRow, TournamentState } from "./types";

const OUTBOX_KEY = "techfest2027-outbox-v2";
const DEVICE_KEY = "techfest2027-device";

export interface ScoreDraft {
  matchId: string;
  scoreA: number | null;
  scoreB: number | null;
  penaltyWinner?: string | null;
  editedAt: string;
  device: string;
}

function loadQueue(): Record<string, ScoreDraft> {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveQueue(q: Record<string, ScoreDraft>) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); } catch {}
}
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) {
      d = Math.random().toString(36).slice(2, 7).toUpperCase();
      localStorage.setItem(DEVICE_KEY, d);
    }
    return d;
  } catch { return "?????"; }
}

export function useTournament(intervalMs: number = POLL_INTERVAL_MS) {
  const [state, setState] = useState<TournamentState | null>(null);
  const [online, setOnline] = useState(true);
  const [conflict, setConflict] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const revRef = useRef(-1);
  const stateRef = useRef<TournamentState | null>(null);
  const queueRef = useRef<Record<string, ScoreDraft>>(typeof window === "undefined" ? {} : loadQueue());
  // `queued` is RENDERED (the "N queued" badge on /editor), so it must be
  // identical on the server and on the first client render. Publishing the count
  // only after mount fixes that.
  //
  // queueRef above deliberately still loads synchronously on the client: a ref's
  // initial value is never rendered so it cannot cause a mismatch, and the
  // mount-time flush() ends in saveQueue(queueRef.current) — loading it in an
  // effect instead would let that flush save an empty map and DESTROY queued
  // offline scores. Same pattern as useDrafts in lib/drafts.ts.
  const [queued, setQueued] = useState(0);
  useEffect(() => { setQueued(Object.keys(queueRef.current).length); }, []);

  // `me` stamps score attribution (device/editedBy on every score), so it stays
  // synchronous and unchanged. It is never rendered and never used on the
  // server, so reading localStorage for it is safe. The label the owner header
  // DISPLAYS is a separate mount-populated value, because Math.random() there
  // cannot match the server's "?????".
  const me = useMemo(() => deviceId(), []);
  const [deviceLabel, setDeviceLabel] = useState("");
  useEffect(() => { setDeviceLabel(me); }, [me]);

  const adopt = useCallback((s: TournamentState) => {
    stateRef.current = s;
    revRef.current = s.revision;
    setState(s);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?since=${revRef.current}`, { cache: "no-store" });
      if (res.status === 204) { setOnline(true); setLoading(false); return; }
      if (!res.ok) throw new Error(String(res.status));
      adopt((await res.json()) as TournamentState);
      setOnline(true);
    } catch {
      setOnline(false);
      setLoading(false);
    }
  }, [adopt]);

  // flush queued offline edits
  const flush = useCallback(async () => {
    const q = queueRef.current;
    const ids = Object.keys(q);
    if (ids.length === 0) return;
    for (const id of ids) {
      const d = q[id];
      try {
        const res = await fetch("/api/score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(d),
        });
        if (res.ok) {
          delete queueRef.current[id];
        } else if (res.status === 409) {
          // someone else entered it — drop ours, the server copy wins
          delete queueRef.current[id];
          setConflict("Another device already recorded that score.");
        } else {
          break; // still failing, keep the rest queued
        }
      } catch { break; }
    }
    saveQueue(queueRef.current);
    setQueued(Object.keys(queueRef.current).length);
    await refresh();
  }, [refresh]);

  // initial load + poll loop
  useEffect(() => {
    refresh().then(flush);
    const t = setInterval(() => { refresh(); }, intervalMs);
    const onFocus = () => { refresh(); flush(); };
    const onOnline = () => { refresh(); flush(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, flush, intervalMs]);

  /** Record a score. Optimistic locally, queued if offline, LWW on the server. */
  const setScore = useCallback(
    (matchId: string, scoreA: number | null, scoreB: number | null, penaltyWinner?: string | null) => {
      const draft: ScoreDraft = {
        matchId, scoreA, scoreB, penaltyWinner: penaltyWinner ?? null,
        editedAt: new Date().toISOString(), device: me,
      };
      // optimistic patch so the phone feels instant
      const s = stateRef.current;
      if (s) {
        const apply = (m: Match): Match => {
          if (m.id !== matchId) return m;
          const played = scoreA != null && scoreB != null;
          const next: Match = { ...m, scoreA, scoreB, played, editedAt: draft.editedAt, editedBy: me };
          if (KO_STAGES.includes(m.stage)) next.penaltyWinner = played && scoreA === scoreB ? penaltyWinner ?? null : null;
          return next;
        };
        adopt({
          ...s,
          league: s.league.map(apply),
          knockout: s.knockout.map(apply),
        });
      }
      queueRef.current[matchId] = draft;
      saveQueue(queueRef.current);
      setQueued(Object.keys(queueRef.current).length);
      flush();
    },
    [adopt, flush, me]
  );

  // ---- derived values every site reuses ----
  const derived = useMemo(() => {
    const s = state;
    if (!s) return null;
    const resolved = propagateWinners([...s.league, ...s.knockout]);
    const league = resolved.filter((m) => m.stage === "league");
    const knockout = resolved.filter((m) => KO_STAGES.includes(m.stage));
    const table: TableRow[] = computeTable(s.players, s.league);
    const ties = cutoffTies(table, s.qualifiers);
    const tiedPool = ties.length > 0 ? ties[0] : [];
    const tieSlots = ties.length > 0 ? slotsForTie(table, tiedPool, s.qualifiers) : 0;
    const tieSig = ties.length > 0
      ? [...tiedPool.map((r) => r.playerId).sort(), `slots:${tieSlots}`, `q:${s.qualifiers}`].join("|")
      : "";
    const externalIds = tieSig && s.externalQualifiers?.sig === tieSig ? s.externalQualifiers.ids : [];
    const final = knockout.find((m) => m.stage === "final");
    const champ = final ? matchWinner(final) : null;
    const matchdays = [...new Set(league.map((m) => m.matchday ?? 1))].sort((a, b) => a - b);
    const leagueDone = league.length > 0 && league.every((m) => m.played);
    const thirdPlaceEnabled = THIRD_PLACE;
    const tournamentFinished = stats.tournamentFinished(knockout, thirdPlaceEnabled);
    return {
      resolved, league, knockout, table, ties, tiedPool, tieSlots, tieSig, externalIds,
      champion: champ && !isPlaceholder(champ) ? champ : null,
      matchdays, leagueDone, thirdPlaceEnabled, tournamentFinished,
      resultsVisible: tournamentFinished && !s.resultsSuppressed,
      stats: stats.tournamentStats(s.players, s.league, knockout),
      tieActive: ties.length > 0,
      names: new Map(s.players.map((p) => [p.id, p.name])),
    };
  }, [state]);

  // app/layout.tsx bakes <title> in at build time, so the browser tab would keep
  // showing the compiled-in name. Every page already polls state, so sync it here.
  const tabName = state?.tournamentName;
  useEffect(() => {
    if (typeof document === "undefined" || !tabName) return;
    document.title = `${tabName} — Tournament Hub`;
  }, [tabName]);

  return { state, derived, loading, online, queued, conflict, setConflict, setScore, refresh, device: deviceLabel };
}

/** Resolve a player id to a display name, marking undecided bracket slots. */
export function useNameOf(players: { id: string; name: string }[]) {
  return useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.name]));
    return (id: string) => (typeof id === "string" && id.startsWith("W(") ? `⏳ ${id}` : m.get(id) ?? id);
  }, [players]);
}
