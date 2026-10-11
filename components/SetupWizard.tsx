"use client";
import { useState } from "react";
import { LEAGUE_MATCHES_PER_PLAYER as DEFAULT_K, PLAYERS as DEFAULT_PLAYERS, POTS as DEFAULT_POTS } from "@/config/tournament.config";
import { assignPots, shuffle } from "@/lib/draw";
import { Player } from "@/lib/types";

export default function SetupWizard({
  players, setPlayers,
  matchesPerPlayer, setMatchesPerPlayer,
  lockedReason,
}: {
  players: Player[]; setPlayers: (p: Player[]) => void;
  matchesPerPlayer: number; setMatchesPerPlayer: (k: number) => void;
  /** Why the roster can no longer be replaced, or null when it can. Shown AT
   *  the button: a control that silently refuses reads as a frozen app. */
  lockedReason?: string | null;
}) {
  const [names, setNames] = useState(DEFAULT_PLAYERS.join("\n"));
  const [pots, setPots] = useState(DEFAULT_POTS);

  const listSize = names.split("\n").map((s) => s.trim()).filter(Boolean).length;
  const hint = (() => {
    if (pots === 1) return `Single pool — manager sets K below. Any player count works${listSize > 0 ? ` (K·N even needed; odd N requires K even).` : "."}`;
    if (pots === 2) {
      if (listSize % 2 !== 0) return `${listSize} is odd — 2 pots needs even count. Use 1 pot (flexible) or add/remove one player.`;
      if (listSize < 4) return "2 pots needs at least 4 players (2 per pot).";
      return "Each player: 2 games, both vs the OTHER pot (Matchday 1 + Matchday 2 crossing).";
    }
    if (listSize % pots !== 0) return `${listSize} not divisible by ${pots} — use 1 pot (flexible), 2 pots (even count), or pick a divisible pot count.`;
    return `UCL-style: 1 opponent per other pot → ${pots - 1} games each (equal pots).`;
  })();

  const apply = () => {
    const list = names.split("\n").map((s) => s.trim()).filter(Boolean);
    if (pots === 1) {
      if (list.length > 0 && list.length % 2 !== 0 && matchesPerPlayer % 2 !== 0) {
        alert(`Odd player count (${list.length}) with 1-pot needs K even (currently ${matchesPerPlayer}). Change K first.`);
        return;
      }
      if (matchesPerPlayer > list.length - 1) {
        alert(`K=${matchesPerPlayer} > players-1 (${list.length - 1}).`);
        return;
      }
      setPlayers(assignPots(list, 1));
      return;
    }
    if (pots === 2) {
      if (list.length % 2 !== 0) { alert(`2 pots needs even count (got ${list.length}) — use 1 pot (flexible) instead.`); return; }
      if (list.length < 4) { alert("2 pots needs at least 4 players."); return; }
      setPlayers(assignPots(list, 2));
      return;
    }
    if (list.length % pots !== 0) {
      alert(`Players (${list.length}) must be divisible by pots (${pots}) for UCL mode. Use 1 pot (flexible), 2 pots (even count), or a divisible pot count.`);
      return;
    }
    setPlayers(assignPots(list, pots));
  };
  const reshufflePots = () => {
    const list = players.map((p) => p.name);
    if (list.length === 0) return;
    const potCount = new Set(players.map((p) => p.pot)).size || pots;
    if (potCount === 1) {
      const s = shuffle(list);
      setPlayers(s.map((name, i) => ({ id: `p-${i + 1}`, name, pot: 1 })));
      return;
    }
    const per = Math.floor(list.length / potCount);
    const s = shuffle(list);
    setPlayers(s.map((name, i) => ({ id: `p-${i + 1}`, name, pot: Math.floor(i / per) + 1 })));
  };

  const modePots = new Set(players.map((p) => p.pot)).size;
  const modeLabel = modePots === 1 ? "SINGLE POOL" : modePots === 2 ? "2-POT FLEX" : modePots > 2 ? "UCL" : "—";
  const modeGames = modePots === 1 ? `${matchesPerPlayer} each` : modePots === 2 ? "2 each (both cross-pot)" : modePots > 2 ? `${modePots - 1} each` : "—";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
        <h2 className="font-bold text-lg">1 · Registrations → Pots</h2>
        <p className="text-sm text-white/60 mt-1">
          Paste gamer-tags (one per line). <code>1 pot</code> = flexible single-pool (manager sets K). <code>2 pots</code> = 2 games each, both vs other pot. <code>≥3 pots</code> = UCL (needs equal pots). Or edit <code>config/tournament.config.ts</code> → PLAYERS / POTS / LEAGUE_MATCHES_PER_PLAYER.
        </p>
        <textarea
          value={names}
          onChange={(e) => setNames(e.target.value)}
          rows={10}
          className="mt-3 w-full rounded-xl bg-black/40 p-3 text-sm ring-1 ring-white/10 outline-none focus:ring-cyan-400"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-sm text-white/70">Pots</label>
          <input type="number" min={1} max={8} value={pots} onChange={(e) => setPots(Number(e.target.value))}
            className="w-20 rounded-lg bg-black/40 p-2 text-center ring-1 ring-white/10" />
          <button onClick={apply} disabled={!!lockedReason}
            title={lockedReason ?? undefined}
            className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-black hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
            Apply players
          </button>
          <button onClick={reshufflePots} disabled={!!lockedReason}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm ring-1 ring-white/15 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40">
            Shuffle pots
          </button>
        </div>
        {lockedReason && (
          <div className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-300/30">
            🔒 <b>Roster locked.</b> {lockedReason} The names below are a scratch pad until
            then — nothing here is applied to the tournament.
          </div>
        )}
        {pots === 1 && (
          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm text-white/70">Matches / player (K)</label>
            <input type="number" min={1} max={Math.max(1, listSize - 1)} value={matchesPerPlayer}
              onChange={(e) => setMatchesPerPlayer(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-lg bg-black/40 p-2 text-center ring-1 ring-white/10" />
            <span className="text-xs text-white/50">N={listSize} · total ties {listSize % 2 === 0 ? (listSize * matchesPerPlayer) / 2 : (matchesPerPlayer * (listSize - 1)) / 2} · {listSize % 2 !== 0 && matchesPerPlayer % 2 !== 0 ? "⚠ odd N needs even K" : ""}</span>
          </div>
        )}
        <div className={`mt-2 text-xs ${pots === 1 || (pots === 2 && listSize % 2 === 0 && listSize >= 4) || (pots >= 3 && listSize % pots === 0) ? "text-white/50" : "text-amber-300"}`}>{hint}</div>
      </div>
      <div className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
        <h2 className="font-bold text-lg">Pots preview ({players.length} players) · <span className="text-amber-300">{modeLabel}</span> · {modeGames}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[...new Set(players.map((p) => p.pot))].sort().map((pot) => (
            <div key={pot} className="rounded-xl bg-black/30 p-3 ring-1 ring-white/10">
              <div className="text-xs font-bold tracking-widest text-amber-300">POT {pot}</div>
              <ul className="mt-2 space-y-1 text-sm">
                {players.filter((p) => p.pot === pot).map((p) => (
                  <li key={p.id} className="rounded-lg bg-white/5 px-2 py-1">{p.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
