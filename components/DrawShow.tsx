"use client";
// ============================================================
// Big-screen draw ceremony. Driven entirely by server state
// (`pendingDraw.revealed`), so the owner laptop, every phone and
// the projector are showing the identical reveal at all times.
// A projector that connects mid-draw simply snaps to the current tie.
// ============================================================

import { Match, PendingDraw, Player } from "@/lib/types";
import Avatar from "./Avatar";

const TITLES: Record<string, { t: string; s: string }> = {
  league: { t: "GROUP STAGE DRAW", s: "Who plays whom" },
  ko1: { t: "KNOCKOUT DRAW", s: "Road to the final" },
  ko2: { t: "SEMI-FINAL DRAW", s: "Who meets in the final" },
};

export default function DrawShow({ pd, players }: { pd: PendingDraw; players: Player[] }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const total = pd.matches.length;
  const shown = pd.matches.slice(0, pd.revealed);
  const meta = TITLES[pd.kind] ?? { t: "DRAW", s: "" };
  const done = pd.revealed >= total;

  // group revealed ties by round so a 4-matchday draw reads cleanly
  const buckets = new Map<string, Match[]>();
  for (const m of shown) {
    const k = m.stage === "league" ? `MATCHDAY ${m.matchday ?? 1}` : m.stage.toUpperCase();
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(m);
  }

  return (
    <div className="min-h-screen bg-[#060b26] p-[4vmin]">
      <div className="flex flex-wrap items-end gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-[clamp(.7rem,1.2vw,1rem)] tracking-[0.4em] text-cyan-300">★ {meta.s.toUpperCase()}</div>
          <h1 className="text-[clamp(1.8rem,5.5vw,4.5rem)] font-black leading-none">{meta.t}</h1>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[clamp(2rem,6vw,5rem)] font-black tabular-nums text-cyan-300">
            {pd.revealed}<span className="text-white/30">/{total}</span>
          </div>
          {pd.auto && <div className="animate-pulse text-xs font-black tracking-widest text-amber-300">AUTO</div>}
          {done && <div className="text-xs font-black tracking-widest text-emerald-300">ALL REVEALED</div>}
        </div>
      </div>

      {/* the "ball" that pulses between reveals */}
      {!done && (
        <div className="mt-[3vmin] flex items-center gap-4">
          <div className="tf-ball h-[clamp(2rem,5vw,4rem)] w-[clamp(2rem,5vw,4rem)] rounded-full bg-white/90 shadow-[0_0_40px_rgba(103,232,249,.6)]" />
          <div className="text-[clamp(1rem,2.4vw,2rem)] font-bold text-white/70">
            Drawing tie {Math.min(pd.revealed + 1, total)} of {total}…
          </div>
        </div>
      )}

      <div className="mt-[3vmin] space-y-[2.5vmin]">
        {shown.length === 0 && (
          <div className="py-[10vmin] text-center text-[clamp(1.2rem,3vw,2.5rem)] text-white/50">
            Get ready…
          </div>
        )}
        {[...buckets.entries()].map(([g, list]) => (
          <section key={g}>
            <h2 className="mb-[1.2vmin] text-[clamp(.7rem,1.3vw,1.1rem)] font-black tracking-[0.3em] text-amber-300">{g}</h2>
            <div className="grid gap-[1.5vmin] sm:grid-cols-2 xl:grid-cols-3">
              {list.map((m) => (
                <Tie key={m.id} m={m} byId={byId} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {done && (
        <div className="mt-[3vmin] text-center text-[clamp(1rem,2.4vw,2rem)] font-bold text-white/50">
          Waiting for the organiser to confirm…
        </div>
      )}

      <style>{`
        .tf-pop{animation:tfpop .6s cubic-bezier(.2,1.5,.4,1) both}
        @keyframes tfpop{from{transform:scale(.82) rotateX(40deg);opacity:0}to{transform:scale(1) rotateX(0);opacity:1}}
        .tf-ball{animation:tfball 1.4s ease-in-out infinite}
        @keyframes tfball{0%,100%{transform:translateX(0) scale(1)}50%{transform:translateX([calc(100vw-8rem)]) scale(1.08)}}
        .tf-glow{animation:tfglow 2.4s ease-in-out infinite}
        @keyframes tfglow{0%,100%{box-shadow:0 0 0 0 rgba(34,211,238,.35)}50%{box-shadow:0 0 28px 6px rgba(34,211,238,.18)}}
      `}</style>
    </div>
  );
}

function Tie({ m, byId }: { m: Match; byId: Map<string, Player> }) {
  const a = byId.get(m.playerA);
  const b = byId.get(m.playerB);
  const ph = (id: string) => id.startsWith("W(");
  return (
    <div className="tf-pop tf-glow rounded-2xl bg-gradient-to-br from-[#0a1445] to-[#131c5e] p-[2.2vmin] ring-1 ring-cyan-300/30">
      <div className="mb-[1.2vmin] text-[clamp(.55rem,.9vw,.85rem)] font-bold tracking-[0.2em] text-cyan-300/70">{m.id}</div>
      {/* stacked, so long gamer-tags get the full card width on a projector */}
      <div className="space-y-[1vmin]">
        <Side p={a} label={m.playerA} ph={ph} />
        <div className="flex items-center gap-[1.2vmin]">
          <span className="text-[clamp(.6rem,1vw,.9rem)] font-black tracking-[0.2em] text-white/30">VS</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
        <Side p={b} label={m.playerB} ph={ph} />
      </div>
    </div>
  );
}

function Side({ p, label, ph }: { p?: Player; label: string; ph: (id: string) => boolean }) {
  if (!p)
    return (
      <div className="flex items-center gap-[1.4vmin]">
        <span className="truncate text-[clamp(1rem,2.4vw,2.2rem)] font-bold text-white/50">
          {ph(label) ? label : label}
        </span>
      </div>
    );
  return (
    <div className="flex items-center gap-[1.4vmin]">
      <Avatar player={p} size={72} />
      <span className="truncate text-[clamp(1rem,2.4vw,2.2rem)] font-black leading-tight">{p.name}</span>
    </div>
  );
}
