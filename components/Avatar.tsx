"use client";
// Probes avatar candidates in order and falls back to a coloured monogram.
import { useEffect, useState } from "react";
import { Player } from "@/lib/types";
import { avatarCandidates, hueOf, initials } from "@/lib/avatar";

export default function Avatar({
  player, size = 40, ring = false, className = "", neutral = false,
}: {
  player: Player;
  size?: number;
  ring?: boolean;
  className?: string;
  /** Replace the initials fallback with a blank coloured disc. Used wherever
   *  the name is being withheld (group stage), since "AR" gives away Arjun. */
  neutral?: boolean;
}) {
  const cands = avatarCandidates(player);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [player.id, player.avatar]);

  const src = cands[idx];
  const dim = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };

  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src} alt={player.name} onError={() => setIdx((i) => i + 1)}
        style={dim}
        className={`shrink-0 rounded-full object-cover ${ring ? "ring-2 ring-cyan-300/70" : ""} ${className}`}
      />
    );

  const hue = hueOf(player.name);
  return (
    <div
      style={{ ...dim, background: `linear-gradient(140deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 55% 26%))` }}
      className={`flex shrink-0 items-center justify-center rounded-full font-black text-white/90 ${ring ? "ring-2 ring-cyan-300/70" : ""} ${className}`}
      aria-hidden={neutral ? true : undefined}
      title={neutral ? "" : player.name}
    >
      {neutral ? "" : initials(player.name)}
    </div>
  );
}
