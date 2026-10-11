"use client";
// ============================================================
// /owner — MASTER CONTROL (owner PIN, enforced server-side)
// Setup, draws, the live ceremony, cut-tie resolution, what the
// projector shows, and exports. Runs on the host laptop.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PLAYERS as CFG_PLAYERS, POTS as CFG_POTS, LEAGUE_MATCHES_PER_PLAYER as CFG_K,
  QUALIFIERS_COUNT as CFG_Q, configWarnings,
} from "@/config/tournament.config";
import { control, usePin } from "@/lib/pin";
import { useTournament } from "@/lib/useTournament";
import { useConfigHealth } from "@/lib/useConfigHealth";
import { cleanTournamentName, NAME_MAX } from "@/lib/nameRules";
import { useDrafts } from "@/lib/drafts";
import { pageLabel, planScreen, screenInput } from "@/lib/screenPlaylist";
import {
  assignPots, buildFixedNextRound, drawFlexLeague, drawKnockoutRound, drawLeague, drawTwoPot,
  hasUnresolvedPlaceholders, isPlaceholder, leagueModeOf, matchWinner,
  verifyFlexLeague, verifyLeague, verifyMatchdays, verifyTwoPot,
} from "@/lib/draw";
import { buildPlayersTemplate, buildSheetsTemplate } from "@/lib/sheets";
import { download, load as loadLegacy } from "@/lib/storage";
import { localAvatarCandidates } from "@/lib/avatar";
import { DrawKind, KO_STAGES, Match, Player } from "@/lib/types";
import SetupWizard from "@/components/SetupWizard";
import DrawControlPanel from "@/components/DrawControlPanel";
import KnockoutBracket from "@/components/KnockoutBracket";
import PointsTable from "@/components/PointsTable";
import PhoneScoreCard from "@/components/PhoneScoreCard";
import PinGate, { CheckingAccess, usePinConfigured } from "@/components/PinGate";
import ErrorBoundary from "@/components/ErrorBoundary";
import Avatar from "@/components/Avatar";

type Tab = "setup" | "draw" | "table" | "knockout" | "projector" | "export";

/** Shape returned by POST /api/roster?dryRun=1 */
interface RosterPreview {
  players: Player[];
  rows: { name: string; gamerId: string; pot: number; hasImage: boolean }[];
  warnings: string[];
  errors: string[];
  photos: { found: number; willStore: number; unmatched: number };
}

export default function OwnerPage() {
  const flags = usePinConfigured();
  const { pin, save, clear, ready } = usePin("owner");

  // Verified against the SERVER, not just accepted locally.
  const verify = async (v: string) => {
    const r = await control(v, { action: "projection" });
    if (r.ok) { save(v); return true; }
    return false;
  };

  // Wait until we know both whether a code is required and whether one is stored.
  if (!flags || !ready) return <CheckingAccess />;

  if (flags.ownerPinSet && pin === null)
    return <PinGate kind="owner" title="Owner control" subtitle="Master laptop only" onUnlock={verify} />;

  return <OwnerBody pin={pin} clearPin={clear} />;
}

function OwnerBody({ pin, clearPin }: { pin: string | null; clearPin: () => void }) {
  const { state, derived, loading, online, refresh, setScore, device } = useTournament();
  const { drafts, setDraft } = useDrafts(
    useMemo(() => (state && derived ? [...derived.league, ...derived.knockout] : []), [state, derived]),
    !!state && !!derived
  );
  const [tab, setTab] = useState<Tab>("setup");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tiePicks, setTiePicks] = useState<string[]>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [rosterPreview, setRosterPreview] = useState<RosterPreview | null>(null);
  const [migrated, setMigrated] = useState(false);

  // ---- config staleness (compiled-in values vs the file on disk) ----
  const config = useConfigHealth(pin);
  const [bannerOpen, setBannerOpen] = useState(true);

  // ---- live tournament name ----
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameField = nameDraft ?? state?.tournamentName ?? "";
  const nameDirty = nameDraft !== null && nameDraft !== (state?.tournamentName ?? "");
  const saveName = async () => {
    let clean: string;
    try {
      clean = cleanTournamentName(nameField);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Bad name." });
      return;
    }
    if (clean === state?.tournamentName) { setNameDraft(null); return; }
    const r = await act({ action: "name", name: clean });
    if (r) setNameDraft(null);
  };

  const players = state?.players ?? [];
  const leagueMode = useMemo(() => (players.length ? leagueModeOf(players) : "ucl"), [players]);

  // ---- projector page selection ----
  const ticked = state?.projection.pages ?? [];
  const setPages = (pages: string[]) => act({ action: "projection", pages });
  const togglePage = (p: string) =>
    setPages(ticked.includes(p) ? ticked.filter((x) => x !== p) : [...ticked, p]);
  const hasKnockout = (state?.knockout.length ?? 0) > 0;
  // why the results screen isn't available yet, in the owner's words
  const resultsReason = (() => {
    if (!state) return null;
    if (derived?.tournamentFinished) return null;
    const final = state.knockout.find((m) => m.stage === "final");
    if (!final || !final.played) return "Waiting for the final to be decided.";
    if (derived?.thirdPlaceEnabled) return "Final done — waiting for the 3rd-place match.";
    return "Waiting for the final to be decided.";
  })();
  // the roster can only be replaced before the first draw — show why, not just why not
  const rosterLockedReason =
    state && (state.knockout.length > 0
      ? "The knockout bracket exists — reset the tournament to change the roster."
      : state.league.length > 0
        ? "The group stage is already drawn — reset the tournament to change the roster."
        : state.pendingDraw
          ? "A draw is in progress — confirm or cancel it before changing the roster."
          : null);
  // exactly what the projector will do, so the preview cannot lie
  const planPreview = useMemo(() => {
    if (!state || !derived) return null;
    return planScreen(screenInput(state, derived));
  }, [state, derived]);

  // one-time migration from the old localStorage save so no tournament is lost
  useEffect(() => {
    if (migrated || !state) return;
    if (state.players.length > 0 || state.league.length > 0) { setMigrated(true); return; }
    const legacy = loadLegacy();
    if (legacy?.players?.length) {
      control(pin, { action: "roster", players: legacy.players, matchesPerPlayer: legacy.matchesPerPlayer })
        .then((r) => { if (r.ok) setMsg({ ok: true, text: `Imported ${legacy.players!.length} players from this browser's old save.` }); })
        .finally(() => setMigrated(true));
    } else setMigrated(true);
  }, [state, migrated, pin]);

  const act = async (body: any, okText?: string) => {
    setBusy(true);
    const r = await control(pin, body);
    setBusy(false);
    if (r.error) setMsg({ ok: false, text: r.error });
    else if (okText) setMsg({ ok: true, text: okText });
    if (r.state) await refresh();
    return r;
  };

  if (loading || !state || !derived)
    return <div className="min-h-screen bg-[#060b26] p-10 text-white/50">Loading tournament…</div>;

  // ---------- draw engines (pure, run here; the server re-validates) ----------
  const runLeagueDraw = async () => {
    // re-drawing replaces the whole group stage (and clears the bracket)
    if (state.league.length > 0) {
      const played = state.league.filter((m) => m.played).length;
      const what = state.knockout.length > 0 ? "\n\nThis also wipes the knockout bracket." : "";
      if (!confirm(`This replaces the existing group stage — ${played} of ${state.league.length} ties already scored will be lost.${what}\n\nContinue?`)) return;
    }
    let m: Match[] = [], errs: string[] = [];
    if (leagueMode === "single") { m = drawFlexLeague(players, state.matchesPerPlayer); errs = verifyFlexLeague(players, m, state.matchesPerPlayer); }
    else if (leagueMode === "twoPot") { m = drawTwoPot(players); errs = verifyTwoPot(players, m); }
    else { m = drawLeague(players); errs = [...verifyLeague(players, m), ...verifyMatchdays(players, m)]; }
    if (errs.length) { setMsg({ ok: false, text: errs.join(" · ") }); return; }
    setTab("draw");
    await act({ action: "stageDraw", kind: "league", matches: m }, "Group draw staged — reveal it, then confirm.");
  };

  const runKoDraw1 = async () => {
    const base = derived.tieActive ? derived.externalIds : derived.table.slice(0, state.qualifiers).map((r) => r.playerId);
    if (base.length !== state.qualifiers) {
      setMsg({ ok: false, text: `Need exactly ${state.qualifiers} qualified, have ${base.length}. Resolve the cut tie first.` });
      return;
    }
    let m: Match[];
    if (state.qualifiers === 8) {
      const qf = drawKnockoutRound(base, "qf");
      // Build the SF ONCE. The feeding into each round is now drawn at random,
      // so calling buildFixedNextRound twice for the same feeders would return
      // two DIFFERENT pairings and wire the Final to the wrong SF.
      const sf = buildFixedNextRound(qf.map((x) => x.id), "sf");
      const fin = buildFixedNextRound(sf.map((x) => x.id), "final");
      m = [...qf, ...sf, ...fin];
    } else {
      const r16 = drawKnockoutRound(base, "r16");
      // 105 possible R16 -> QF feeding schemes; one is drawn.
      const qf = buildFixedNextRound(r16.map((x) => x.id), "qf");
      m = [...r16, ...qf];
    }
    setTab("draw");
    await act({ action: "stageDraw", kind: "ko1", matches: m }, "Knockout draw staged.");
  };

  const runKoDraw2 = async () => {
    const qf = derived.knockout.filter((m) => m.stage === "qf");
    if (qf.length === 0) { setMsg({ ok: false, text: "No QFs yet." }); return; }
    if (hasUnresolvedPlaceholders(qf)) { setMsg({ ok: false, text: "QF ties still await R16 winners." }); return; }
    const winners = qf.map(matchWinner).filter((w): w is string => !!w && !isPlaceholder(w));
    if (winners.length !== qf.length) { setMsg({ ok: false, text: "Finish all QFs first." }); return; }
    const sf = drawKnockoutRound(winners, "sf");
    setTab("draw");
    await act({ action: "stageDraw", kind: "ko2", matches: [...sf, ...buildFixedNextRound(sf.map((x) => x.id), "final")] }, "Semi-final draw staged.");
  };

  const redraw = async () => {
    const k = state.pendingDraw?.kind;
    if (k === "league") return runLeagueDraw();
    if (k === "ko1") return runKoDraw1();
    if (k === "ko2") return runKoDraw2();
  };

  /** Roster import: preview first, then commit. Both call /api/roster. */
  const fetchPreview = async (init: RequestInit & { query?: string }) => {
    const r = await fetch(`/api/roster${init.query ?? "?dryRun=1"}`, {
      ...init,
      headers: { "x-owner-pin": pin ?? "", ...(init.headers ?? {}) },
    });
    const j = await r.json().catch(() => ({ ok: false, error: "Unreadable response." }));
    if (!j.ok) { setMsg({ ok: false, text: j.error ?? "Import failed." }); return null; }
    return j;
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const j = await fetchPreview({ method: "POST", body: await file.arrayBuffer() });
      if (j) setRosterPreview(j);
    } catch (e: any) {
      setMsg({ ok: false, text: `Could not read that file: ${e.message}` });
    } finally { setBusy(false); }
  };

  const importFromUrl = async () => {
    setBusy(true);
    try {
      const j = await fetchPreview({ method: "POST", query: `?dryRun=1&url=${encodeURIComponent(sheetUrl)}` });
      if (j) setRosterPreview(j);
    } finally { setBusy(false); }
  };

  const applyRoster = async () => {
    if (!rosterPreview) return;
    setBusy(true);
    try {
      const r = await control(pin, { action: "roster", players: rosterPreview.players });
      if (r.ok) {
        setRosterPreview(null);
        setMsg({ ok: true, text: `Roster applied — ${rosterPreview.players.length} players, ids are now their gamer_id.` });
      } else setMsg({ ok: false, text: r.error ?? "Could not apply." });
    } finally { setBusy(false); }
  };

  const warnings = configWarnings();

  return (
    <ErrorBoundary>
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-xs tracking-[0.3em] text-cyan-300">
              ★ {leagueMode === "single" ? "SINGLE-POOL FLEX" : leagueMode === "twoPot" ? "2-POT CROSS" : "UCL-STYLE · NEUTRAL VENUE"}
            </div>
            <h1 className="text-2xl md:text-4xl font-black">{state?.tournamentName ?? "…"}</h1>
            <div className="text-sm text-white/50">
              Top {state.qualifiers} · {players.length} players · {state.pendingDraw ? "DRAW IN PROGRESS" : online ? "live" : "offline"} · this device {device}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Link href="/editor" className="rounded-xl bg-cyan-400/20 px-4 py-2 text-sm font-bold ring-1 ring-cyan-300/40">📱 Editor</Link>
            <Link href="/screen" className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-black text-black">📺 Projection</Link>
            <button onClick={clearPin} className="rounded-xl bg-white/10 px-4 py-2 text-sm ring-1 ring-white/15">Lock</button>
          </div>
        </header>

        {config.stale && (
          <div className="mt-4 rounded-2xl bg-red-500/10 p-4 text-sm ring-1 ring-red-400/40">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg leading-none">🚨</span>
              <b className="text-red-200">config/tournament.config.ts was edited after the last build</b>
              <button
                onClick={() => setBannerOpen((v) => !v)}
                className="ml-auto rounded-lg bg-white/10 px-2 py-1 text-xs ring-1 ring-white/15"
              >
                {bannerOpen ? "hide" : `show ${config.diffs.length || ""}`.trim()}
              </button>
            </div>
            {bannerOpen && (
              <>
                <p className="mt-2 text-red-200/80">
                  The app is still running the values that were compiled in. Editing the file does
                  nothing until you rebuild — that is why your change didn&apos;t show up.
                </p>
                {config.diffs.length > 0 ? (
                  <ul className="mt-3 space-y-1 font-mono text-xs">
                    {config.diffs.map((d) => (
                      <li key={d.key} className="rounded-lg bg-black/30 px-3 py-2">
                        <span className="text-red-300">{d.key}</span>
                        <div className="text-white/50 line-through">{d.built}</div>
                        <div className="text-emerald-300">{d.onDisk}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-red-200/70">Rebuild to pick up the change.</p>
                )}
                <p className="mt-3 text-xs text-white/50">
                  Fix: <code className="rounded bg-black/40 px-1.5 py-0.5">npm run build</code> then restart
                  the server (<code className="rounded bg-black/40 px-1.5 py-0.5">npm start</code>), or just{" "}
                  <code className="rounded bg-black/40 px-1.5 py-0.5">npm run serve-lan</code>. State and
                  scores are kept, so this is safe to do during a break.
                </p>
              </>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mt-4 rounded-2xl bg-amber-300/10 p-4 text-sm ring-1 ring-amber-300/40">
            {warnings.map((w, i) => <div key={i}>⚠ {w} — set them in <code>config/tournament.config.ts</code>.</div>)}
          </div>
        )}
        {msg && (
          <div onClick={() => setMsg(null)}
            className={`sticky top-2 z-30 mt-4 cursor-pointer rounded-2xl p-4 text-sm shadow-lg ring-1 backdrop-blur ${msg.ok ? "bg-emerald-400/10 text-emerald-200 ring-emerald-300/30" : "bg-red-500/15 text-red-200 ring-red-400/40"}`}>
            {msg.ok ? "✓" : "⚠"} {msg.text} <span className="text-xs text-white/40">(tap to dismiss)</span>
          </div>
        )}

        <nav className="mt-6 flex flex-wrap gap-2">
          {(["setup", "draw", "table", "knockout", "projector", "export"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-xl px-4 py-2 text-sm font-bold uppercase tracking-wider ${tab === t ? "bg-cyan-400 text-black" : "bg-white/10 ring-1 ring-white/15"}`}>
              {t}{t === "draw" && state.pendingDraw ? " ●" : ""}
            </button>
          ))}
        </nav>

        <main className="mt-6 space-y-4">
          {tab === "setup" && (
            <>
              <SetupWizard
                players={players}
                setPlayers={(p: Player[]) =>
                  act({ action: "roster", players: p },
                      `Roster applied — ${p.length} player${p.length === 1 ? "" : "s"} across ${new Set(p.map((x) => x.pot)).size} pot${new Set(p.map((x) => x.pot)).size === 1 ? "" : "s"}.`)}
                matchesPerPlayer={state.matchesPerPlayer}
                setMatchesPerPlayer={(k: number) => act({ action: "settings", matchesPerPlayer: k })}
                lockedReason={rosterLockedReason}
              />
              <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <label className="text-sm text-white/60">Qualifiers</label>
                <select value={state.qualifiers}
                  onChange={(e) => act({ action: "settings", qualifiers: Number(e.target.value) as 8 | 16 })}
                  className="ml-3 rounded-lg bg-black/40 p-2 ring-1 ring-white/10">
                  <option value={8}>Top 8 (QF fixes SF+Final)</option>
                  <option value={16}>Top 16 (R16→QF fixed, fresh SF)</option>
                </select>
              </div>

              {derived.tieActive && derived.externalIds.length === 0 && (
                <div className="rounded-2xl bg-amber-300/10 p-4 text-sm ring-1 ring-amber-300/40">
                  <b>Cut tie at Top {state.qualifiers}</b>: {derived.tiedPool.map((r) => r.name).join(", ")} level · {derived.tieSlots} slot(s).
                  <span className="text-white/60"> Arrange it in your separate tie-breaker UI, then tick the qualifier(s) here.</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {derived.tiedPool.map((r) => (
                      <label key={r.playerId}
                        className={`cursor-pointer rounded-xl px-3 py-1.5 ring-1 ${tiePicks.includes(r.playerId) ? "bg-amber-300 font-bold text-black" : "bg-white/10 ring-white/15"}`}>
                        <input type="checkbox" className="mr-2" checked={tiePicks.includes(r.playerId)}
                          onChange={() => setTiePicks((p) => p.includes(r.playerId) ? p.filter((x) => x !== r.playerId) : [...p, r.playerId])} />
                        {r.name}
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => act({ action: "tieResolve", picks: tiePicks }, "Cut tie resolved — KO draw unlocked.")}
                      className="rounded-lg bg-amber-300 px-4 py-1.5 font-bold text-black">
                      Confirm {derived.tieSlots} qualifier(s) ({tiePicks.length}/{derived.tieSlots})
                    </button>
                    {derived.tiedPool.length > 0 && state.externalQualifiers && (
                      <button onClick={() => act({ action: "clearTie" })} className="rounded-lg bg-white/10 px-3 py-1.5 ring-1 ring-white/15">Clear</button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button onClick={runLeagueDraw} disabled={busy || !!state.pendingDraw}
                  className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-black disabled:opacity-40">
                  🎲 Run group draw
                </button>
                <button onClick={runKoDraw1} disabled={busy || !!state.pendingDraw || !derived.leagueDone}
                  className="rounded-xl bg-white/10 px-5 py-3 ring-1 ring-white/15 disabled:opacity-40">
                  🎲 Knockout draw #1
                </button>
                {state.qualifiers === 16 && !state.sfDrawDone && (
                  <button onClick={runKoDraw2} disabled={busy || !!state.pendingDraw}
                    className="rounded-xl bg-white/10 px-5 py-3 ring-1 ring-white/15 disabled:opacity-40">
                    🎲 Knockout draw #2 (SF)
                  </button>
                )}
                <button onClick={() => { if (confirm("Reset all draws and scores?")) act({ action: "reset" }, "Tournament reset."); }}
                  className="rounded-xl bg-red-500/20 px-5 py-3 ring-1 ring-red-400/30">Reset</button>
              </div>
              {!derived.leagueDone && state.league.length > 0 && (
                <div className="text-xs text-white/40">Knockout draw unlocks when every group tie has a score.</div>
              )}
            </>
          )}

          {tab === "draw" && (
            state.pendingDraw ? (
              <DrawControlPanel
                pd={state.pendingDraw} players={players} busy={busy}
                onReveal={() => act({ action: "drawControl", which: "reveal" })}
                onAuto={(v) => act({ action: "drawControl", which: "auto", value: v })}
                onRevealAll={() => act({ action: "drawControl", which: "revealAll" })}
                onConfirm={async () => { setTiePicks([]); await act({ action: "confirmDraw" }, "Draw confirmed."); }}
                onRedraw={redraw}
                onCancel={() => act({ action: "cancelDraw" }, "Draw cancelled.")}
              />
            ) : (
              <div className="rounded-2xl bg-white/5 p-6 text-sm text-white/60 ring-1 ring-white/10">
                No draw in progress. Start one from Setup — it appears on the projector instantly.
              </div>
            )
          )}

          {tab === "table" && <PointsTable table={derived.table} qualifiers={state.qualifiers} players={players} showAvatars />}

          {tab === "knockout" && (
            <>
              <KnockoutBracket matches={derived.knockout} players={players} showAvatars />
              {derived.knockout.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {derived.knockout
                    .filter((m) => !isPlaceholder(m.playerA) && !isPlaceholder(m.playerB))
                    .map((m) => (
                      <PhoneScoreCard
                        key={m.id} m={m} players={players}
                        onScore={setScore}
                        draft={drafts[m.id] ?? null}
                        onDraft={setDraft}
                      />
                    ))}
                </div>
              )}
            </>
          )}

          {tab === "projector" && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <h2 className="font-bold">What the projector shows</h2>
                <p className="mt-1 text-sm text-white/60">
                  Tick the pages to rotate through. A draw ceremony always takes over the screen while one is running.
                </p>

                {/* live preview — computed from the same planScreen the projector uses */}
                {planPreview && (
                  <div className="mt-4 rounded-xl bg-black/30 p-3 text-sm">
                    <span className="text-white/50">Projector is showing: </span>
                    {planPreview.kind === "ceremony" ? (
                      <span className="font-bold text-cyan-300">the draw ceremony</span>
                    ) : planPreview.kind === "results" ? (
                      <span className="font-bold text-emerald-300">the results (podium + credits)</span>
                    ) : planPreview.kind === "not-prepared" ? (
                      <span className="font-bold">“fixtures not prepared”</span>
                    ) : planPreview.kind === "status" ? (
                      <span className="font-bold">a status card</span>
                    ) : planPreview.pages.length === 0 ? (
                      <span className="font-bold text-amber-300">nothing selected</span>
                    ) : (
                      <span className="font-bold">
                        {planPreview.pages.map(pageLabel).join(" → ")}
                        {planPreview.fallback && <span className="ml-1 text-amber-300">(table as fallback)</span>}
                      </span>
                    )}
                  </div>
                )}

                {hasKnockout ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-bold text-amber-300">Knockout stage</p>
                    <p className="text-xs text-white/55">The bracket is always shown. Tick the table to add it.</p>
                    <label className="flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" checked={ticked.includes("table")}
                        onChange={() => togglePage("table")} className="h-5 w-5 accent-cyan-400" />
                      Point Table
                    </label>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm font-bold text-cyan-300">Group stage</p>
                    {derived.matchdays.length === 0 && <p className="text-xs text-white/50">Run the group draw first.</p>}
                    {derived.matchdays.map((d) => {
                      const ties = derived.league.filter((m) => (m.matchday ?? 1) === d).length;
                      return (
                        <label key={d} className="flex items-center gap-2 text-sm font-semibold">
                          <input type="checkbox" checked={ticked.includes(`md${d}`)}
                            onChange={() => togglePage(`md${d}`)} className="h-5 w-5 accent-cyan-400" />
                          Matchday {d}
                          <span className="text-xs font-normal text-white/40">{ties} ties</span>
                        </label>
                      );
                    })}
                    <label className="flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" checked={ticked.includes("table")}
                        onChange={() => togglePage("table")} className="h-5 w-5 accent-cyan-400" />
                      Point Table
                    </label>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button onClick={() => setPages([...derived.matchdays.map((d) => `md${d}`), "table"])}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">All</button>
                      <button onClick={() => setPages(["table"])}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">Table only</button>
                      <button onClick={() => setPages([])}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">None</button>
                      <label className="ml-2 flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={state.projection.rotate}
                          onChange={(e) => act({ action: "projection", rotate: e.target.checked })} />
                        Auto-rotate
                      </label>
                    </div>
                  </div>
                )}

                {planPreview?.kind === "rotate" && planPreview.fallback && (
                  <p className="mt-3 rounded-lg bg-amber-300/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-300/30">
                    Nothing is ticked — the Point Table is shown so the projector is never blank.
                  </p>
                )}
              </div>

              <div className="rounded-2xl bg-white/5 p-5 text-sm ring-1 ring-white/10">
                <h2 className="font-bold">Projector checklist</h2>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-white/70">
                  <li>Open <code>/screen</code> on the projector (or this laptop fullscreen) and enter the screen code.</li>
                  <li>Keep this laptop awake — a sleeping host kills the show: <code>caffeinate -dimsu</code>.</li>
                  <li>Any tie you reveal here appears on the projector within ~1.5s.</li>
                </ol>
                <Link href="/screen" target="_blank" className="mt-3 inline-block rounded-xl bg-amber-300 px-4 py-2 text-sm font-black text-black">
                  Open projection ↗
                </Link>
              </div>

              {/* rename — the one display setting that is live, not compiled in */}
              <div className="rounded-2xl bg-white/5 p-5 text-sm ring-1 ring-white/10">
                <h2 className="font-bold">Tournament name</h2>
                <p className="mt-1 text-xs text-white/50">
                  Shown on the home page, the phones, the projector footer and the results. Saves
                  instantly — no rebuild, unlike everything else in{" "}
                  <code className="text-white/70">config/tournament.config.ts</code>.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={nameField}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
                    maxLength={NAME_MAX}
                    placeholder="Tournament name"
                    className="min-w-[14rem] flex-1 rounded-xl bg-black/40 px-3 py-2 font-bold ring-1 ring-white/15 focus:outline-none focus:ring-cyan-300/60"
                  />
                  <button
                    onClick={saveName}
                    disabled={!nameDirty || busy}
                    className="rounded-xl bg-cyan-400 px-4 py-2 font-black text-black disabled:opacity-30"
                  >
                    Save
                  </button>
                  {nameDirty && (
                    <button
                      onClick={() => setNameDraft(null)}
                      className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/15"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className="mt-2 text-xs text-white/40">
                  {nameField.length}/{NAME_MAX}
                </p>
              </div>

              {/* results switch — available only once the tournament is really over */}
              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <h2 className="font-bold">Results screen</h2>
                {derived.tournamentFinished ? (
                  <>
                    <p className="mt-1 text-sm text-white/60">
                      The tournament is over. The projector switches to the podium and the credits automatically.
                    </p>
                    <label className="mt-3 flex items-center gap-3 text-sm font-bold">
                      <input type="checkbox" checked={!state.resultsSuppressed}
                        onChange={(e) => act({ action: "results", suppressed: !e.target.checked })}
                        className="h-6 w-6 accent-emerald-400" />
                      Show results on the projector
                    </label>
                    <p className="mt-2 text-xs text-white/45">
                      {state.resultsSuppressed
                        ? "Held back — the projector stays on the bracket. Tick to show the results."
                        : "Showing the podium and credits. Untick to hold the bracket instead (e.g. while the 3rd-place match is still to come)."}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-amber-300/90">
                    🔒 {resultsReason ?? "Not available yet."}
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === "export" && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <h2 className="font-bold">Export / import</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => download("techfest-results.csv",
                    buildSheetsTemplate([...derived.league, ...derived.knockout], new Map(players.map((p) => [p.id, p.name]))))}
                    className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-black">Results CSV</button>
                  <button onClick={() => download("techfest-players.csv", buildPlayersTemplate(players))}
                    className="rounded-xl bg-emerald-400/20 px-4 py-2 text-sm ring-1 ring-emerald-300/40">Players CSV</button>
                  <button onClick={() => download("techfest-backup.json", JSON.stringify(
                    { players, league: state.league, knockout: state.knockout, externalQualifiers: state.externalQualifiers, qualifiers: state.qualifiers, matchesPerPlayer: state.matchesPerPlayer }, null, 2))}
                    className="rounded-xl bg-white/10 px-4 py-2 text-sm ring-1 ring-white/15">Backup JSON</button>
                  <label className="cursor-pointer rounded-xl bg-white/10 px-4 py-2 text-sm ring-1 ring-white/15">
                    Import JSON<input type="file" accept="application/json" className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]; if (!f) return;
                        try { act({ action: "import", state: JSON.parse(await f.text()) }, "Backup imported."); }
                        catch (err: any) { setMsg({ ok: false, text: `Bad file: ${err.message}` }); }
                      }} />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <h2 className="font-bold">Roster from a spreadsheet</h2>
                <p className="mt-1 text-sm text-white/60">
                  Columns <code>photo · name · gamer_id · pot</code> (order and header wording flexible). Photos may be
                  embedded in the cells (upload the <code>.xlsx</code>) or be URLs in a <code>.csv</code>.
                  <b> Only possible before the first draw.</b>
                </p>

                {rosterLockedReason ? (
                  <div className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-300/30">
                    🔒 {rosterLockedReason}
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer rounded-xl bg-cyan-400 px-4 py-2 text-sm font-black text-black">
                        Choose .xlsx or .csv
                        <input type="file" accept=".xlsx,.csv,text/csv" className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) await importFile(f);
                            e.target.value = "";
                          }} />
                      </label>
                      <input
                        value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="…or a published Sheets CSV URL"
                        className="min-w-0 flex-1 rounded-xl bg-black/40 p-2.5 text-sm ring-1 ring-white/10 outline-none focus:ring-cyan-400" />
                      <button onClick={importFromUrl} disabled={busy || !sheetUrl}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-bold ring-1 ring-white/15 disabled:opacity-40">
                        Fetch &amp; preview
                      </button>
                    </div>

                    {rosterPreview && (
                      <div className="mt-4 rounded-xl bg-black/30 p-3">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <b>{rosterPreview.players.length} players found</b>
                          <span className="text-white/50">
                            {rosterPreview.photos.found} photo{rosterPreview.photos.found === 1 ? "" : "s"} embedded
                            {rosterPreview.photos.willStore > 0 && ` · ${rosterPreview.photos.willStore} will be stored on the host`}
                          </span>
                          <div className="ml-auto flex gap-2">
                            <button onClick={() => setRosterPreview(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">Discard</button>
                            <button onClick={applyRoster} disabled={busy || rosterPreview.players.length === 0}
                              className="rounded-lg bg-emerald-400 px-4 py-1.5 text-xs font-black text-black disabled:opacity-40">
                              Apply roster
                            </button>
                          </div>
                        </div>

                        {rosterPreview.warnings.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-[11px] text-amber-200/90">
                            {rosterPreview.warnings.slice(0, 8).map((w, i) => <li key={i}>⚠ {w}</li>)}
                            {rosterPreview.warnings.length > 8 && <li>…and {rosterPreview.warnings.length - 8} more.</li>}
                          </ul>
                        )}

                        <div className="mt-3 max-h-64 overflow-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="text-left text-white/40">
                              <th className="p-1">photo</th><th className="p-1">name</th>
                              <th className="p-1">gamer_id</th><th className="p-1">pot</th>
                            </tr></thead>
                            <tbody>
                              {rosterPreview.rows.map((r) => {
                                const p = rosterPreview.players.find((x) => x.id === r.gamerId);
                                return (
                                  <tr key={r.gamerId} className="border-t border-white/5">
                                    <td className="p-1">{p ? <Avatar player={p} size={22} /> : null}</td>
                                    <td className="p-1 font-semibold">{r.name}</td>
                                    <td className="p-1 font-mono text-white/50">{r.gamerId}</td>
                                    <td className="p-1">{r.pot}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <h2 className="font-bold">Player images</h2>
                <p className="mt-1 text-sm text-white/60">
                  Order: a URL from the roster sheet or <code>PLAYER_IMAGES</code> → a photo extracted from the
                  spreadsheet and stored on this host → a file in <code>public/players/</code> → coloured initials.
                  Anything missing falls back to initials, so nothing breaks.
                </p>
                <AvatarChecklist players={players} />
              </div>
            </div>
          )}
        </main>

        <footer className="mt-10 text-center text-xs text-white/30">
          {state?.tournamentName ?? "…"} · one server, three sites · scores sync to every device
        </footer>
        <style>{`.tf-pop{animation:tfpop .45s cubic-bezier(.2,1.4,.4,1)}@keyframes tfpop{from{transform:scale(.9) translateY(8px);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
      </div>
    </ErrorBoundary>
  );
}

/** Probes each player's avatar candidates once and lists the gaps.
 *  Must mirror lib/avatar.ts resolution order, or it will claim a player has no
 *  image when one is already being served from /api/avatar or a sheet URL. */
function AvatarChecklist({ players }: { players: Player[] }) {
  const [found, setFound] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, boolean> = {};
      for (const p of players) {
        // an explicit URL counts as having an image; probing it is pointless here
        if (p.avatar) { out[p.id] = true; continue; }
        let ok = false;
        const candidates = [`/api/avatar/${encodeURIComponent(p.id)}`, ...localAvatarCandidates(p)];
        for (const c of candidates) {
          try { const r = await fetch(c, { method: "HEAD" }); if (r.ok) { ok = true; break; } } catch {}
        }
        out[p.id] = ok;
      }
      if (alive) setFound(out);
    })();
    return () => { alive = false; };
  }, [players]);
  if (players.length === 0) return null;
  const missing = players.filter((p) => found[p.id] === false);
  const pending = players.filter((p) => found[p.id] === undefined);
  return (
    <div className="mt-4">
      {pending.length > 0 && <div className="text-xs text-white/40">Checking images…</div>}
      {pending.length === 0 && missing.length === 0 && (
        <div className="text-sm font-bold text-emerald-300">✓ Every player has an image.</div>
      )}
      {missing.length > 0 && (
        <>
          <div className="text-sm font-bold text-amber-300">{missing.length} player(s) will show initials:</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-xs ring-1 ring-white/10">
                <Avatar player={p} size={20} /> {p.name}
                <code className="text-[10px] text-white/30">players/{p.id}.jpg</code>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
