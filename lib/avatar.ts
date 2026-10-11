// Player image resolution for the projection showoff.
// Order: explicit URL (config map or sheet) -> local file probe -> monogram.
// A missing image must NEVER break the show, so the monogram is a real fallback
// with a stable per-player colour rather than a broken image icon.

import { AVATAR_DIR, PLAYER_IMAGES } from "@/config/tournament.config";
import { Player } from "./types";

export const AVATAR_EXTS = ["jpg", "png", "webp", "svg"] as const;

/** Candidate image URLs, most specific first:
 *   1. explicit URL (PLAYER_IMAGES config map, or the sheet's photo column)
 *   2. a photo extracted from the spreadsheet and stored on the host
 *   3. a file the owner dropped into public/players/
 *  A broken candidate falls through to the next, and finally to the monogram. */
export function avatarCandidates(p: Player): string[] {
  const out: string[] = [];
  const key = p.name?.trim() ?? "";
  const explicit = p.avatar || PLAYER_IMAGES[key] || PLAYER_IMAGES[key.toLowerCase()];
  if (explicit) out.push(explicit);
  if (p.id) out.push(`/api/avatar/${encodeURIComponent(p.id)}`);
  for (const ext of AVATAR_EXTS) out.push(`${AVATAR_DIR}/${p.id}.${ext}`);
  return out;
}

/** First non-probe candidate, i.e. the only one worth a network check. */
export function explicitAvatar(p: Player): string | null {
  const key = p.name?.trim() ?? "";
  return p.avatar || PLAYER_IMAGES[key] || PLAYER_IMAGES[key.toLowerCase()] || null;
}

/** Local-file candidates only (offline-safe, no internet needed). */
export function localAvatarCandidates(p: Player): string[] {
  return AVATAR_EXTS.map((ext) => `${AVATAR_DIR}/${p.id}.${ext}`);
}

export function initials(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable hue per gamer-tag so each player keeps the same colour all event. */
export function hueOf(name: string): number {
  let h = 0;
  const s = name ?? "";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
