"use client";
// Owner's draw-ceremony control panel. The reveal counter lives on the SERVER,
// so these buttons drive the projector in real time — everyone sees the same tie
// at the same moment, and a projector that joins late catches up instantly.

import { Match, PendingDraw, Player } from "@/lib/types";
import Avatar from "./Avatar";

const TITLES: Record<string, string> = {
  league: "Group stage draw",
  ko1: "Knockout draw #1",
  ko2: "Knockout draw #2 — semi-finals",
};

export default function DrawControlPanel({
  pd, players, busy, onReveal, onAuto, onRevealAll, onConfirm, onRedraw, onCancel,
}: {
  pd: PendingDraw;
  players: Player[];
  busy?: boolean;
  onReveal: () => void;
  onAuto: (v: boolean) => void;
  onRevealAll: () => void;
  onConfirm: () => void;
  onRedraw: () => void;
  onCancel: () => void;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const total = pd.matches.length;
  const shown = pd.matches.slice(0, pd.revealed);
  const all = pd.revealed >= total;

  return (
    <div className="rounded-3xl bg-white/5 p-5 ring-1 ring-cyan-300/30">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-black">{TITLES[pd.kind] ?? "Draw"}</h2>
        <span className="rounded-lg bg-black/40 px-2 py-1 text-xs font-bold tabular-nums text-cyan-200">
          {pd.revealed}/{total} revealed
        </span>
        {pd.auto && <span className="animate-pulse rounded-lg bg-amber-300 px-2 py-1 text-xs font-black text-black">AUTO</span>}
        {all && <span className="rounded-lg bg-emerald-400/20 px-2 py-1 text-xs font-bold text-emerald-200">all revealed</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onReveal} disabled={all || busy}
          className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold ring-1 ring-white/15 disabled:opacity-40">
          ▶ Reveal next
        </button>
        <button onClick={() => onAuto(!pd.auto)} disabled={all || busy}
          className={`rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-40 ${pd.auto ? "bg-white/10 ring-1 ring-white/15" : "bg-amber-300 text-black"}`}>
          {pd.auto ? "⏸ Pause" : "⚡ Auto-draw"}
        </button>
        <button onClick={onRevealAll} disabled={all || busy}
          className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold ring-1 ring-white/15 disabled:opacity-40">
          Reveal all
        </button>
        <button onClick={onRedraw} disabled={busy}
          className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold ring-1 ring-white/15 disabled:opacity-40">
          ↻ Redraw
        </button>
        <button onClick={onCancel} disabled={busy}
          className="rounded-xl bg-red-500/20 px-4 py-2.5 text-sm font-bold ring-1 ring-red-400/30 disabled:opacity-40">
          Cancel
        </button>
        <button onClick={onConfirm} disabled={!all || busy}
          className="ml-auto rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-black text-black disabled:opacity-40">
          {all ? "✓ Confirm draw" : `Confirm (${pd.revealed}/${total})`}
        </button>
      </div>
      <p className="mt-2 text-xs text-white/45">
        The projector is showing this live. Everyone — owner, phones, screen — sees the same reveal.
      </p>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {shown.map((m, i) => (
          <RevealRow key={m.id} m={m} n={i + 1} byId={byId} />
        ))}
      </div>
      {pd.revealed === 0 && (
        <div className="mt-4 rounded-2xl bg-black/30 p-6 text-center text-sm text-white/50">
          Nothing revealed yet — the projector is showing the "get ready" screen.
        </div>
      )}
    </div>
  );
}

function RevealRow({ m, n, byId }: { m: Match; n: number; byId: Map<string, Player> }) {
  const a = byId.get(m.playerA);
  const b = byId.get(m.playerB);
  const ph = (id: string) => id.startsWith("W(");
  return (
    <div
      key={m.id}
      className="tf-pop flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#0a1445] to-[#131c5e] p-3 ring-1 ring-cyan-400/30"
    >
      <span className="w-6 text-sm font-black text-white/40">{n}.</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] tracking-widest text-cyan-300">{m.id} · {m.stage.toUpperCase()}</div>
        <div className="flex items-center gap-2 font-bold">
          {a ? <Avatar player={a} size={22} /> : null}
          <span className="truncate">{a?.name ?? (ph(m.playerA) ? m.playerA : m.playerA)}</span>
          <span className="text-white/30">vs</span>
          {b ? <Avatar player={b} size={22} /> : null}
          <span className="truncate">{b?.name ?? (ph(m.playerB) ? m.playerB : m.playerB)}</span>
        </div>
      </div>
    </div>
  );
}
