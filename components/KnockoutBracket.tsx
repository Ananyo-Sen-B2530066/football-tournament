"use client";
import { Match, Player } from "@/lib/types";
import { isPlaceholder, matchWinner } from "@/lib/draw";
import Avatar from "./Avatar";

const STAGE_LABEL: Record<string, string> = {
  r16: "R16", qf: "QF", sf: "SF", final: "FINAL", third: "3RD PLACE",
};
const STAGE_ORDER = ["r16", "qf", "sf", "final"];

export default function KnockoutBracket({
  matches, players, showAvatars = false, big = false,
}: { matches: Match[]; players: Player[]; showAvatars?: boolean; big?: boolean }) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const name = (id: string) => {
    if (!id) return "TBD";
    // "⏳ W(R16-03)" leaked the raw placeholder onto the projector. Say
    // "Winner R16-03" instead: still obviously undecided, but readable, and it
    // makes the drawn QF feeding legible (e.g. Winner R16-06 vs Winner R16-02).
    if (isPlaceholder(id)) return `⏳ Winner ${id.replace(/^W\((.*)\)$/, "$1")}`;
    return byId.get(id)?.name ?? id;
  };
  const byStage = (s: string) => matches.filter((m) => m.stage === s).sort((a, b) => a.id.localeCompare(b.id));
  const columns = STAGE_ORDER.map((s) => ({ s, list: byStage(s) })).filter((c) => c.list.length > 0);
  const third = byStage("third");

  const final = byStage("final")[0];
  const finalWinner = final ? matchWinner(final) : null;
  const championName = finalWinner && !isPlaceholder(finalWinner) ? name(finalWinner) : null;
  const champion = championName ? byId.get(finalWinner!) : undefined;
  const runnerName = final && finalWinner && !isPlaceholder(finalWinner)
    ? name(finalWinner === final.playerA ? final.playerB : final.playerA)
    : null;
  const thirdWinner = third[0] && matchWinner(third[0]) && !isPlaceholder(matchWinner(third[0])!)
    ? name(matchWinner(third[0])!) : null;

  if (columns.length === 0 && third.length === 0)
    return <div className="rounded-2xl bg-white/5 p-5 text-sm text-white/50 ring-1 ring-white/10">Knockout not drawn yet.</div>;

  const av = big ? 56 : 30;

  return (
    <div>
      {championName && final && (
        <div className="mb-4 rounded-2xl bg-gradient-to-r from-amber-300/20 to-emerald-400/20 p-5 text-center ring-1 ring-amber-300/40">
          <div className="text-xs tracking-[0.3em] text-amber-300">★ CHAMPION ★</div>
          {champion && showAvatars && (
            <div className="mt-3 flex justify-center"><Avatar player={champion} size={big ? 120 : 72} ring /></div>
          )}
          <div className={`mt-2 font-black ${big ? "text-5xl md:text-7xl" : "text-2xl"}`}>{championName}</div>
          {champion && (
            <div className="font-mono tracking-[0.2em] text-cyan-300/80">{champion.id}</div>
          )}
          <div className="mt-1 text-sm text-white/70">
            Final {final.scoreA ?? "–"} : {final.scoreB ?? "–"}
            {runnerName ? ` vs ${runnerName}` : ""}
            {thirdWinner ? ` · 3rd: ${thirdWinner}` : ""}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-0">
        {columns.map((col, ci) => (
          <div key={col.s} className="relative flex flex-1 flex-col gap-4 lg:px-5 lg:first:pl-0 lg:last:pr-0">
            {ci > 0 && (
              <div aria-hidden className="absolute top-0 bottom-0 left-0 hidden w-5 lg:block">
                <div className="absolute top-1/2 left-0 h-px w-full bg-white/15" />
              </div>
            )}
            <h3 className={`text-center font-black tracking-[0.25em] text-amber-300 ${big ? "text-sm" : "text-xs"}`}>
              {STAGE_LABEL[col.s] ?? col.s.toUpperCase()}
            </h3>
            <div className="flex flex-1 flex-col justify-around gap-4">
              {col.list.map((m) => (
                <TieCard key={m.id} m={m} name={name} isLast={col.s === "final"} showAvatars={showAvatars} av={av} byId={byId} big={big} />
              ))}
            </div>
          </div>
        ))}
        {third.length > 0 && (
          <div className="relative flex flex-1 flex-col gap-4 lg:px-5">
            <h3 className="text-center text-xs font-black tracking-[0.25em] text-white/50">3RD PLACE</h3>
            <div className="flex flex-1 flex-col justify-around gap-4">
              {third.map((m) => (
                <TieCard key={m.id} m={m} name={name} isLast={false} showAvatars={showAvatars} av={av} byId={byId} big={big} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TieCard({
  m, name, isLast, showAvatars, av, byId, big,
}: { m: Match; name: (id: string) => string; isLast: boolean; showAvatars: boolean; av: number; byId: Map<string, Player>; big?: boolean }) {
  const w = matchWinner(m);
  const decided = !!w && !isPlaceholder(w);
  const pa = showAvatars && !isPlaceholder(m.playerA) ? byId.get(m.playerA) : undefined;
  const pb = showAvatars && !isPlaceholder(m.playerB) ? byId.get(m.playerB) : undefined;
  return (
    <div className={`relative rounded-xl bg-black/30 p-3 ring-1 ${decided ? "ring-emerald-300/40" : "ring-white/10"}`}>
      {!isLast && (
        <div aria-hidden className="absolute top-1/2 -right-5 hidden h-px w-5 bg-white/15 lg:block" />
      )}
      <div className="text-[11px] text-white/40">{m.id}{m.feedsFrom ? ` · from ${m.feedsFrom.join(" + ")}` : ""}</div>
      <TieLine label={name(m.playerA)} score={m.scoreA} win={decided && w === m.playerA} player={pa} av={av} big={big} />
      <TieLine label={name(m.playerB)} score={m.scoreB} win={decided && w === m.playerB} player={pb} av={av} big={big} />
      <div className={`mt-1 ${big ? "text-base" : "text-xs"}`}>
        {decided ? <span className="font-bold text-emerald-300">→ {name(w!)}</span>
          : m.played ? <span className="text-red-300">unresolved — set pens winner</span>
          : <span className="text-white/40">upcoming</span>}
      </div>
    </div>
  );
}

function TieLine({
  label, score, win, player, av, big,
}: { label: string; score: number | null; win: boolean; player?: Player; av: number; big?: boolean }) {
  // KNOCKOUT identity: photo + name + gamer_id. The name is the reveal — the
  // group stage deliberately withholds it — so the id is always shown too.
  const locked = label.startsWith("⏳") || label.startsWith("W(");
  return (
    <div className={`mt-1 flex items-center gap-2 rounded-lg px-2 py-1 ${win ? "bg-emerald-400/20 font-bold text-emerald-100" : "bg-white/5"} ${big ? "py-2" : ""}`}>
      {player && <Avatar player={player} size={av} ring={win} neutral={locked} />}
      <span className="min-w-0">
        <span className={`block truncate ${big ? "text-lg" : "text-sm"}`}>{label}{win ? " →" : ""}</span>
        {player && !locked && (
          <span className={`block truncate font-mono tracking-wider text-cyan-300/70 ${big ? "text-xs" : "text-[10px]"}`}>
            {player.id}
          </span>
        )}
      </span>
      <span className={`ml-auto font-bold ${big ? "text-2xl" : ""}`}>{score ?? "–"}</span>
    </div>
  );
}
