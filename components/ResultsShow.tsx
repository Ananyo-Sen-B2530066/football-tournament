"use client";
// ============================================================
// Results — the closing screen.
//
// Two kinds of page, rotated through like the rest of the projector:
//   1. the podium  — top 3 (champion, runner-up, 3rd), with a one-shot
//                     confetti burst the first time it appears
//   2. the credits — a top-5 leaderboard per statistic, competition-ranked
//
// Every page shows FULL identity (photo, name, gamer_id). That is the point:
// the group stage withholds the name, so the knockout reveals it and the
// results confirm it.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { CREDIT_KEYS, creditBoard, podium } from "@/lib/stats";
import type { TournamentStats } from "@/lib/stats";
import type { Match, Player } from "@/lib/types";
import Avatar from "./Avatar";

const ROTATE_MS = 14000;
const COLOURS = ["#f43f5e", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#fb923c", "#22d3ee", "#e879f9"];

/** CSS-only confetti: a burst of pieces that fall once, then unmount.
 *  Deterministic (index-seeded) so it looks the same on every device. */
function Confetti({ fire }: { fire: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!fire) return;
    setGone(false);
    const t = setTimeout(() => setGone(true), 7000);
    return () => clearTimeout(t);
  }, [fire]);
  if (!fire || gone) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {Array.from({ length: 90 }, (_, i) => {
        const c = COLOURS[i % COLOURS.length];
        const left = (i * 37) % 100;
        const delay = ((i * 53) % 90) / 100;
        const dur = 3.4 + ((i * 17) % 26) / 10;
        const size = 7 + ((i * 11) % 9);
        return (
          <span
            key={i}
            className="tf-confetti absolute rounded-sm"
            style={{
              left: `${left}vw`, top: "-6vh", background: c,
              width: `${size}px`, height: `${size * 1.7}px`,
              animationDelay: `${delay}s`, animationDuration: `${dur}s`,
            }}
          />
        );
      })}
      <style>{`
        .tf-confetti{animation:tfc fall linear forwards}
        @keyframes tfc{
          0%{transform:translate3d(0,0,0) rotate(0deg);opacity:1}
          100%{transform:translate3d(18vw,112vh,0) rotate(760deg);opacity:.9}
        }
        .tf-rise{animation:tfr .7s cubic-bezier(.2,1.4,.4,1) both}
        @keyframes tfr{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}
      `}</style>
    </div>
  );
}

export default function ResultsShow({
  stats, players, league, knockout, onBack, tournamentName,
}: {
  stats: TournamentStats[];
  players: Player[];
  league: Match[];
  knockout: Match[];
  onBack: () => void;
  /** Live from the store so a rename on /owner lands without a rebuild. */
  tournamentName: string;
}) {
  const boards = useMemo(
    () => CREDIT_KEYS.map((k) => creditBoard(stats, k)).filter((b): b is NonNullable<typeof b> => !!b),
    [stats]
  );
  const pod = useMemo(() => podium(stats, league, knockout), [stats, league, knockout]);
  const pages = useMemo(() => ["podium", ...boards.map((b) => b.key)], [boards]);

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // NOTE: this must be state, not a ref — a ref mutation doesn't re-render, so
  // the confetti would never actually fire.
  const [confettiFired, setConfettiFired] = useState(false);
  const safe = Math.min(idx, Math.max(pages.length - 1, 0));
  const current = pages[safe];
  const onPodium = current === "podium";

  // fire the confetti the first time the podium is actually shown
  useEffect(() => {
    if (onPodium && !confettiFired) setConfettiFired(true);
  }, [onPodium, confettiFired]);

  useEffect(() => {
    if (paused || pages.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % pages.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, pages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onBack(); return; }
      if (pages.length < 2) return;
      if (e.key === "ArrowRight" || e.key === " ") setIdx((i) => (i + 1) % pages.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + pages.length) % pages.length);
      if (e.key === "p") setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length, onBack]);

  const board = boards.find((b) => b.key === current);
  const title = onPodium ? "FINAL STANDINGS" : board?.title ?? "";
  const hint = onPodium ? "champion, runner-up and third place" : board?.hint ?? "";

  return (
    <div className="min-h-screen bg-[#060b26] p-[3vmin] text-white antialiased">
      <Confetti fire={onPodium && confettiFired} />

      <div className="mb-[2vmin] flex items-center gap-3">
        <div>
          <h1 className="text-[clamp(1.4rem,3.6vw,3rem)] font-black tracking-wider">{title}</h1>
          <div className="text-[clamp(.65rem,1.1vw,1.1rem)] tracking-[0.25em] text-cyan-300/80">{hint.toUpperCase()}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {paused && <span className="text-xs font-black text-amber-300">PAUSED</span>}
          <button onClick={() => setPaused((p) => !p)}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15">
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button onClick={onBack}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold ring-1 ring-white/15"
            title="Back to the bracket (Esc)">
            ◀ show bracket
          </button>
          {pages.length > 1 && pages.map((p, i) => (
            <button key={p} onClick={() => setIdx(i)}
              className={`h-2.5 w-8 rounded-full ${i === safe ? "bg-amber-300" : "bg-white/20"}`} />
          ))}
        </div>
      </div>

      {onPodium ? (
        <Podium pod={pod} players={players} />
      ) : board ? (
        <Board board={board} players={players} />
      ) : (
        <div className="text-white/50">No results yet.</div>
      )}

      <div className="mt-[3vmin] text-center text-[clamp(.6rem,1vw,1rem)] text-white/25">
        {tournamentName} · Space next · ← back · P pause · Esc show bracket
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- podium

function Podium({ pod, players }: { pod: ReturnType<typeof podium>; players: Player[] }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const of = (s: TournamentStats) => byId.get(s.playerId) ?? { id: s.playerId, name: s.name, pot: 1 };

  if (!pod.champion)
    return <div className="text-center text-white/50">The final has not been decided yet.</div>;

  // a real podium shape: each step is a block, all bottoms aligned, heights differ
  const step = (
    s: TournamentStats | null | undefined,
    label: string,
    avatar: number,
    block: string,
    tint: string,
    delay: number
  ) => {
    if (!s)
      return (
        <div className="flex flex-1 flex-col items-center justify-end text-center" style={{ animationDelay: `${delay}s` }}>
          <div className="text-[clamp(.7rem,1.2vw,1.2rem)] font-black tracking-[0.3em] text-white/30">{label}</div>
          <div className="mt-3 text-[clamp(.7rem,1.1vw,1.1rem)] text-white/25">not played</div>
          <div className="mt-3 w-full rounded-t-2xl bg-white/[0.03] ring-1 ring-white/5" style={{ height: block }} />
        </div>
      );
    return (
      <div className="tf-rise flex flex-1 flex-col items-center justify-end text-center" style={{ animationDelay: `${delay}s` }}>
        <div className={`text-[clamp(.65rem,1.1vw,1.1rem)] font-black tracking-[0.3em] ${tint}`}>{label}</div>
        <div className={`mt-2 rounded-full p-1 ring-4 ${tint.replace("text-", "ring-")}`}>
          <Avatar player={of(s)} size={avatar} />
        </div>
        <div className={`mt-3 font-black leading-tight ${avatar > 100 ? "text-[clamp(1.2rem,2.8vw,2.8rem)]" : "text-[clamp(.95rem,2vw,2rem)]"}`}>
          {s.name}
        </div>
        <div className="font-mono tracking-[0.2em] text-cyan-300/80">{s.gamerId}</div>
        <div className="mt-3 w-full rounded-t-2xl bg-white/[0.07] ring-1 ring-white/10" style={{ height: block }} />
      </div>
    );
  };

  return (
    <div className="flex min-h-[56vh] items-end justify-center gap-[2.5vmin] pb-[3vmin]">
      {step(pod.runnerUp, "RUNNER-UP", 84, "13vmin", "text-white/50", 0.25)}
      {step(pod.champion, "★ CHAMPION", 112, "20vmin", "text-amber-300", 0)}
      {step(pod.third, "THIRD PLACE", 72, "8vmin", "text-amber-200/70", 0.5)}
      {pod.thirdNote && (
        <div className="absolute self-end text-center text-xs text-white/30" style={{ marginBottom: "-2vmin" }}>
          {pod.thirdNote}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- board

function Board({ board, players }: { board: NonNullable<ReturnType<typeof creditBoard>>; players: Player[] }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  if (board.entries.length === 0)
    return <div className="text-center text-white/50">Nobody has a completed match yet.</div>;

  const first = board.entries[0];
  return (
    <div className="space-y-[1.2vmin]">
      {board.entries.map((e, i) => {
        const lead = i === 0;
        return (
          <div
            key={e.stats.playerId}
            className={`tf-rise flex items-center gap-[2vmin] rounded-2xl px-[2.5vmin] py-[1.4vmin] ring-1 ${
              lead ? "bg-gradient-to-r from-amber-300/20 to-emerald-400/10 ring-amber-300/50" : "bg-white/5 ring-white/10"
            }`}
            style={{ animationDelay: `${i * 0.07}s` }}
          >
            <span className={`w-[3ch] text-right font-black tabular-nums ${lead ? "text-amber-300" : "text-white/40"} ${lead ? "text-[clamp(1.4rem,3vw,3rem)]" : "text-[clamp(1rem,2vw,2rem)]"}`}>
              {e.rank}
            </span>
            <Avatar player={byId.get(e.stats.playerId) ?? { id: e.stats.playerId, name: e.stats.name, pot: 1 }} size={lead ? 72 : 50} ring={lead} />
            <div className="min-w-0 flex-1">
              <div className={`truncate font-black leading-tight ${lead ? "text-[clamp(1.3rem,2.8vw,2.8rem)]" : "text-[clamp(1rem,2vw,2rem)]"}`}>
                {e.stats.name}
              </div>
              <div className="truncate font-mono tracking-[0.2em] text-cyan-300/70">
                {e.stats.gamerId}
                {lead && e.stats.biggestWinMatchId && e.stats.biggestWin > 0 && e.stats.biggestWinScoreSelf != null && (
                  <span className="ml-3 font-sans tracking-normal text-white/35">
                    {/*
                      Real goals, winner first — NOT the margin with a 0 tacked on,
                      which used to print "4-0" for an actual 6-2. The away flag
                      is what stops a 2-4 away win reading like a home loss.
                      Guarded on biggestWinScoreSelf so a partial caption can
                      never render.
                    */}
                    biggest win {e.stats.biggestWinScoreSelf}–{e.stats.biggestWinScoreAgainst}
                    {e.stats.biggestWinAway ? " (won away)" : ""} vs {e.stats.biggestWinOpponent} ({e.stats.biggestWinMatchId})
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className={`font-black tabular-nums ${lead ? "text-amber-300" : "text-white"} ${lead ? "text-[clamp(1.6rem,3.4vw,3.4rem)]" : "text-[clamp(1.1rem,2.2vw,2.2rem)]"}`}>
                {e.value}
              </div>
              <div className="text-[clamp(.55rem,.9vw,.9rem)] uppercase tracking-widest text-white/35">{board.unit}</div>
            </div>
            <div className="w-[7ch] text-right text-[clamp(.6rem,1vw,1rem)] text-white/35">
              <span className="font-bold text-white/60">P{e.stats.apps}</span> played
            </div>
          </div>
        );
      })}
      {board.moreTied > 0 && (
        <div className="text-center text-xs text-white/35">+{board.moreTied} more tied on this value</div>
      )}
    </div>
  );
}
