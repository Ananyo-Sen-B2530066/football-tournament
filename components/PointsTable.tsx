"use client";
import { Player, TableRow } from "@/lib/types";
import Avatar from "./Avatar";

/** How a player is identified on screen.
 *  - "name+id": photo, name and gamer_id — used by /owner and the knockout.
 *  - "id":      photo and gamer_id, NAME WITHHELD — the group stage on the
 *               projector, so the knockout reveal of the name lands.
 *  A missing photo in "id" mode must not fall back to initials, or the
 *  withheld name leaks straight back through "AR". */
export type Identity = "name+id" | "id";

export default function PointsTable({
  table, qualifiers, players, showAvatars = false, identity = "name+id",
}: {
  table: TableRow[];
  qualifiers: number;
  players?: Player[];
  showAvatars?: boolean;
  identity?: Identity;
}) {
  const byId = new Map((players ?? []).map((p) => [p.id, p]));
  const idOnly = identity === "id";
  return (
    <div className="overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
      <div className="flex items-center gap-3 p-4">
        <h2 className="font-bold text-lg">Point Table</h2>
        <span className="text-xs text-white/50">Pts › GD › GF · cut at Top {qualifiers}</span>
        <span className="ml-auto text-xs text-emerald-300">■ qualification</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-white/50 text-xs">
              <th className="p-3">#</th><th className="p-3">Player</th>
              <th className="p-3">P</th><th className="p-3">W</th><th className="p-3">D</th><th className="p-3">L</th>
              <th className="p-3">GF</th><th className="p-3">GA</th><th className="p-3">GD</th><th className="p-3">Pts</th><th className="p-3">Form</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => {
              const p = byId.get(r.playerId);
              return (
              <tr key={r.playerId}
                className={`${i < qualifiers ? "bg-emerald-400/[0.07]" : ""} border-t border-white/5 ${i === qualifiers - 1 ? "border-b-2 border-b-emerald-400/60" : ""}`}>
                <td className="p-3 font-bold">{i + 1}</td>
                <td className="p-3 font-semibold">
                  <span className="flex items-center gap-2">
                    {p && showAvatars && <Avatar player={p} size={idOnly ? 34 : 26} />}
                    {idOnly ? (
                      <span className="truncate font-mono text-xs font-bold tracking-wider text-cyan-200">{r.playerId}</span>
                    ) : (
                      <span className="truncate">{r.name}</span>
                    )}
                  </span>
                </td>
                <td className="p-3">{r.p}</td><td className="p-3">{r.w}</td><td className="p-3">{r.d}</td><td className="p-3">{r.l}</td>
                <td className="p-3">{r.gf}</td><td className="p-3">{r.ga}</td>
                <td className="p-3 font-bold">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                <td className="p-3 font-bold text-amber-300">{r.pts}</td>
                <td className="p-3">
                  <span className="flex gap-1">
                    {r.form.map((f, k) => (
                      <span key={k} className={`inline-block h-5 w-5 rounded-full text-center text-[11px] leading-5 font-bold ${f === "W" ? "bg-emerald-400 text-black" : f === "D" ? "bg-white/25" : "bg-red-400/80 text-black"}`}>{f}</span>
                    ))}
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {table.length === 0 && <div className="p-4 text-sm text-white/50">No players yet.</div>}
    </div>
  );
}
