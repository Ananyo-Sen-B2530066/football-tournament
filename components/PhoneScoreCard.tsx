"use client";
// ============================================================
// Score entry with an explicit confirmation step.
//
// The steppers only ever touch a LOCAL DRAFT — nothing is sent to the
// server until Confirm. A draft shows as amber "not saved yet" with a
// review strip, so a half-entered score can never be mistaken for a
// recorded result (or leak into the table / bracket / projector).
//
// Same behaviour on phones and on the owner laptop.
// ============================================================

import Avatar from "./Avatar";
import { Match, Player } from "@/lib/types";
import { ScoreDraft } from "@/lib/drafts";
import { commitBlocker, isLocked, isResolved, needsAction, needsWinner } from "@/lib/scoreFlow";

function Stepper({
  value, onChange, label,
}: { value: number | null; onChange: (v: number) => void; label: string }) {
  const bump = (d: number) => onChange(Math.max(0, Math.min(99, (value ?? 0) + d)));
  return (
    <div className="flex items-center gap-1">
      <button
        type="button" aria-label={`decrease ${label}`} onClick={() => bump(-1)}
        className="h-11 w-11 shrink-0 rounded-2xl bg-white/10 text-2xl font-black ring-1 ring-white/15 active:scale-95 active:bg-white/20"
      >−</button>
      <div className="w-9 shrink-0 text-center text-2xl font-black tabular-nums">
        {value ?? <span className="text-white/25">–</span>}
      </div>
      <button
        type="button" aria-label={`increase ${label}`} onClick={() => bump(1)}
        className="h-11 w-11 shrink-0 rounded-2xl bg-white/10 text-2xl font-black ring-1 ring-white/15 active:scale-95 active:bg-white/20"
      >+</button>
    </div>
  );
}

export default function PhoneScoreCard({
  m, players, onScore, draft, onDraft, highlight,
}: {
  m: Match;
  players: Player[];
  onScore: (id: string, a: number | null, b: number | null, w?: string | null) => void;
  draft?: ScoreDraft | null;
  onDraft: (id: string, d: ScoreDraft | null) => void;
  highlight?: boolean;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const pa = byId.get(m.playerA);
  const pb = byId.get(m.playerB);
  const ko = m.stage !== "league";

  // what's on screen: the draft if there is one, otherwise the recorded result
  const a = draft ? draft.a : m.scoreA;
  const b = draft ? draft.b : m.scoreB;
  const winner = draft ? draft.winner : m.penaltyWinner ?? null;

  const pending = !!draft;
  const recorded = isResolved(m);
  const level = a != null && b != null && a === b;
  const blocker = commitBlocker(m, a, b, winner);

  const set = (patch: Partial<ScoreDraft>) =>
    onDraft(m.id, { a, b, winner, ...patch });

  const commit = () => {
    if (blocker) return;
    onScore(m.id, a, b, winner);
    onDraft(m.id, null);
  };

  if (isLocked(m) || !pa || !pb)
    return (
      <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/5 opacity-70">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/50">⏳ {m.id}</span>
          <span className="text-xs text-amber-300/80">awaiting earlier winner</span>
        </div>
      </div>
    );

  const shell = pending
    ? "bg-amber-300/[0.07] ring-2 ring-amber-300/60"
    : highlight
      ? "bg-cyan-400/10 ring-1 ring-cyan-300/50"
      : "bg-white/5 ring-1 ring-white/10";

  return (
    <div className={`rounded-2xl p-3 ring-1 transition-colors ${shell}`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[11px] font-bold tracking-widest text-cyan-300/80">
          {m.stage === "league" ? `MD${m.matchday ?? 1}` : m.stage.toUpperCase()} · {m.id}
        </span>
        {pending ? (
          <span className="rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-black text-black">NOT SAVED YET</span>
        ) : recorded ? (
          <span className="text-[11px] font-bold text-emerald-300">● FT</span>
        ) : needsWinner(m) ? (
          <span className="rounded bg-amber-300/25 px-1.5 py-0.5 text-[10px] font-black text-amber-200">PICK A WINNER</span>
        ) : null}
        {!pending && m.editedBy && <span className="truncate text-[10px] text-white/30">via {m.editedBy}</span>}
      </div>

      {/* minmax(0,1fr) — a bare 1fr track refuses to shrink below its content
          width, which pushed the + buttons off the right edge on narrow phones */}
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0 space-y-1.5">
          <SideRow p={pa} score={a} win={!pending && a != null && b != null && a > b} />
          <SideRow p={pb} score={b} win={!pending && a != null && b != null && b > a} />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Stepper value={a} onChange={(v) => set({ a: v })} label={pa.name} />
          <Stepper value={b} onChange={(v) => set({ b: v })} label={pb.name} />
        </div>
      </div>

      {/* Level knockout tie: the winner is chosen BEFORE the confirm, so a
          mis-tap on the wrong player is still recoverable. */}
      {level && ko && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[pa, pb].map((p) => (
            <button
              key={p.id} type="button"
              onClick={() => set({ winner: winner === p.id ? null : p.id })}
              className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-black ring-1 active:scale-[0.98] sm:text-sm ${winner === p.id ? "bg-amber-300 text-black ring-amber-200" : "bg-amber-300/15 text-amber-200 ring-amber-300/40"}`}
            >
              <Avatar player={p} size={22} />
              <span className="truncate">{p.name} wins</span>
            </button>
          ))}
        </div>
      )}
      {level && !ko && (
        <div className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-center text-xs text-white/50">
          Level — a league draw stands as a draw.
        </div>
      )}

      {/* review + confirm */}
      <div className="mt-2">
        {pending && (
          <div className="mb-2 rounded-xl bg-black/30 px-3 py-2 text-center text-sm">
            <span className="text-white/50">Check: </span>
            <span className="font-black">
              {pa.name} {a ?? "–"} – {b ?? "–"} {pb.name}
            </span>
            {level && ko && winner && (
              <span className="ml-1 font-black text-amber-300">
                ({winner === pa.id ? pa.name : pb.name} on pens)
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {pending ? (
            <button
              type="button" onClick={() => onDraft(m.id, null)}
              className="shrink-0 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-bold ring-1 ring-white/15"
            >↺</button>
          ) : null}
          <button
            type="button" onClick={commit} disabled={!pending || !!blocker}
            className={`flex-1 rounded-xl py-2.5 text-sm font-black active:scale-[0.98] ${
              pending && !blocker
                ? "bg-emerald-400 text-black"
                : pending
                  ? "bg-white/10 text-white/40 ring-1 ring-white/10"
                  : "bg-white/5 text-white/35 ring-1 ring-white/5"
            }`}
          >
            {pending ? (recorded ? "Update result" : "✓ Confirm FT") : recorded ? "✓ Recorded" : "Confirm FT"}
          </button>
        </div>
        {blocker && pending && (
          <div className="mt-1 text-center text-[11px] font-bold text-amber-300">⏳ {blocker}</div>
        )}
      </div>
    </div>
  );
}

function SideRow({ p, score, win }: { p: Player; score: number | null; win: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${win ? "bg-emerald-400/15" : ""}`}>
      <Avatar player={p} size={26} />
      <span className={`truncate text-sm ${win ? "font-black text-emerald-200" : "font-semibold"}`}>{p.name}</span>
      <span className="ml-auto text-sm font-black tabular-nums">{score ?? "–"}</span>
    </div>
  );
}
