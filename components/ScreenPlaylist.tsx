"use client";
// ============================================================
// Projection playlist — the state machine for /screen.
// Priority order (first match wins):
//   1. a draw is in progress   -> full-screen ceremony
//   2. nothing drawn at all    -> "FIXTURES NOT PREPARED"
//   3. group running / KO pending -> status card
//   4. normal                  -> rotate MATCHDAY <chosen> <-> POINT TABLE
//                                (+ KNOCKOUT once the bracket exists)
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useTournament } from "@/lib/useTournament";
import { isPlaceholder } from "@/lib/draw";
import { ScreenPlan, planScreen, screenInput } from "@/lib/screenPlaylist";
import ResultsShow from "@/components/ResultsShow";
import Avatar from "@/components/Avatar";
import DrawShow from "@/components/DrawShow";
import KnockoutBracket from "@/components/KnockoutBracket";
import PointsTable from "@/components/PointsTable";
import StatusPage from "@/components/StatusPage";

type Page = { key: string; title: string; render: () => React.ReactNode };

const ROTATE_MS = 12000;

export default function ScreenPlaylist() {
  const { state, derived } = useTournament();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  const [peekBracket, setPeekBracket] = useState(false);

  const plan = useMemo<ScreenPlan | null>(() => {
    if (!state || !derived) return null;
    return planScreen(screenInput(state, derived));
  }, [state, derived]);

  // "◀ show bracket" is a LOCAL override for this projector session only.
  // The projector holds the screen code, not the owner code, so it must not
  // (and cannot) change the owner's durable setting — that stays theirs.
  const planWithoutResults = useMemo<ScreenPlan | null>(() => {
    if (!state || !derived || plan?.kind !== "results") return plan;
    return planScreen(screenInput(state, derived, { ignoreResults: true }));
  }, [state, derived, plan]);

  const shownPlan = peekBracket && plan?.kind === "results" ? planWithoutResults : plan;

  const pages = useMemo<Page[] | null>(() => {
    if (!state || !derived || !shownPlan || shownPlan.kind !== "rotate") return null;
    const out: Page[] = [];
    for (const p of shownPlan.pages) {
      if (p === "table")
        out.push({ key: "table", title: "POINT TABLE", render: () => <PointsTable table={derived.table} qualifiers={state.qualifiers} players={state.players} showAvatars identity="id" /> });
      else if (p === "knockout")
        out.push({ key: "ko", title: "KNOCKOUT", render: () => <KnockoutBracket matches={derived.knockout} players={state.players} showAvatars big /> });
      else {
        const day = Number(p.replace(/^md/, ""));
        if (!Number.isFinite(day)) continue;
        out.push({ key: p, title: `MATCHDAY ${day}`, render: () => <MatchdayPage day={day} /> });
      }
    }
    return out;
  }, [state, derived, shownPlan]);

  // single page (e.g. bracket only) -> no dots, nothing to rotate to
  const single = (pages?.length ?? 0) <= 1;

  // clamp + auto-rotate
  useEffect(() => {
    if (!pages || shownPlan?.kind !== "rotate" || !state?.projection.rotate || paused) return;
    if (pages.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % pages.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [pages, state?.projection.rotate, shownPlan, paused]);

  useEffect(() => {
    if (pages && idx >= pages.length) setIdx(0);
  }, [pages, idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pages || pages.length === 0) return;
      if (e.key === "ArrowRight" || e.key === " ") setIdx((i) => (i + 1) % pages.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + pages.length) % pages.length);
      if (e.key === "p") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages]);

  if (!state || !derived || !shownPlan) return <div className="min-h-screen bg-[#060b26] p-10 text-white/50">Connecting…</div>;

  // 1. ceremony owns the screen while a draw is staged
  if (shownPlan.kind === "ceremony" && state.pendingDraw) return <DrawShow pd={state.pendingDraw} players={state.players} />;

  // 2. the tournament is over -> podium + credits (unless the projector peeked back)
  if (shownPlan.kind === "results")
    return (
      <ResultsShow
        stats={derived.stats} players={state.players}
        league={derived.league} knockout={derived.knockout}
        onBack={() => setPeekBracket(true)}
        tournamentName={state.tournamentName}
      />
    );

  // 3. nothing prepared yet
  if (shownPlan.kind === "not-prepared") return <Frame tournamentName={state.tournamentName}><StatusPage kind="not-prepared" /></Frame>;

  // 4. nothing renderable at all (last resort)
  if (shownPlan.kind === "status")
    return (
      <Frame tournamentName={state.tournamentName}>
        <StatusPage kind={shownPlan.status} />
        {derived.league.length > 0 && (
          <div className="px-[6vmin] pb-[6vmin]">
            <PointsTable table={derived.table} qualifiers={state.qualifiers} players={state.players} showAvatars identity="id" />
          </div>
        )}
      </Frame>
    );

  // 4. the chosen pages (or a single page, e.g. bracket only)
  const list = pages ?? [];
  const page = list[Math.min(idx, list.length - 1)];
  return (
    <Frame
      tournamentName={state.tournamentName}
      pages={single ? [] : list.map((p, i) => ({ title: p.title, active: i === (page ? list.indexOf(page) : 0) }))}
      title={single ? page?.title : undefined}
      onPick={setIdx}
      paused={paused}
      onTogglePause={() => setPaused((p) => !p)}
    >
      {page ? page.render() : <StatusPage kind="not-prepared" />}
    </Frame>
  );

  function MatchdayPage({ day }: { day: number }) {
    const list = derived!.league
      .filter((m) => (m.matchday ?? 1) === day)
      .sort((a, b) => a.id.localeCompare(b.id));
    const byId = new Map(state!.players.map((p) => [p.id, p]));
    return (
      <div className="px-[5vmin] pb-[5vmin]">
        <div className="grid gap-[2vmin] md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => {
            const a = byId.get(m.playerA);
            const b = byId.get(m.playerB);
            return (
              <div key={m.id} className="rounded-2xl bg-white/5 p-[2.5vmin] ring-1 ring-white/10">
                <div className="text-[clamp(.55rem,.9vw,.85rem)] tracking-widest text-cyan-300/70">{m.id}</div>
                <SideRow p={a} label={m.playerA} score={m.scoreA} />
                <div className="my-[1vmin] h-px bg-white/10" />
                <SideRow p={b} label={m.playerB} score={m.scoreB} />              </div>
            );
          })}
        </div>
        {list.length === 0 && <div className="text-white/50">No ties in this matchday.</div>}
      </div>
    );
  }
}

function SideRow({ p, label, score }: { p?: any; label: string; score: number | null }) {
  // GROUP STAGE identity: photo + gamer_id, name withheld (the knockout reveals it).
  // A missing photo falls back to a neutral disc so the initials can't leak it.
  const locked = typeof label === "string" && label.startsWith("W(");
  return (
    <div className="flex items-center gap-[1.5vmin]">
      {p && <Avatar player={p} size={60} neutral={locked} />}
      <span className="truncate text-[clamp(1rem,2.3vw,2.1rem)] font-black">
        {locked
          ? `⏳ ${label}`
          : p
            ? <span className="font-mono tracking-wider text-cyan-200">{p.id}</span>
            : label}
      </span>
      <span className="ml-auto text-[clamp(1.2rem,3vw,2.8rem)] font-black tabular-nums text-amber-300">{score ?? "–"}</span>
    </div>
  );
}

function Frame({
  children, pages, title, onPick, paused, onTogglePause, tournamentName,
}: {
  children: React.ReactNode;
  /** live from the store, so a rename on /owner lands without a rebuild */
  tournamentName: string;
  pages?: { title: string; active: boolean }[];
  /** used when there is a single page and so no dots to show */
  title?: string;
  onPick?: (i: number) => void;
  paused?: boolean;
  onTogglePause?: () => void;
}) {
  const showHeader = (pages && pages.length > 0) || !!title;
  return (
    <div className="min-h-screen bg-[#060b26] p-[3vmin] text-white antialiased">
      {showHeader && (
        <div className="mb-[2vmin] flex items-center gap-3">
          <h1 className="text-[clamp(1.2rem,3.2vw,2.6rem)] font-black tracking-wider">
            {pages && pages.length > 0 ? pages.find((p) => p.active)?.title ?? "" : title}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {paused && <span className="text-xs font-black text-amber-300">PAUSED</span>}
            <button onClick={onTogglePause}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">
              {paused ? "▶ Resume" : "⏸ Pause"}
            </button>
            {(pages ?? []).map((p, i) => (
              <button key={p.title} onClick={() => onPick?.(i)}
                className={`h-2.5 w-8 rounded-full ${p.active ? "bg-amber-300" : "bg-white/20"}`} />
            ))}
          </div>
        </div>
      )}
      {children}
      <div className="mt-[3vmin] text-center text-[clamp(.6rem,1vw,1rem)] text-white/25">
        {tournamentName}
      </div>
    </div>
  );
}
