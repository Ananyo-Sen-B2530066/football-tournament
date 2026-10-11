import { Match, Player } from "./types";

const K = "techfest2027-tournament-v1";

export interface SavedState {
  players: Player[];
  matches: Match[];
  qualifiers: 8 | 16;
  sfDrawDone: boolean;
  externalQualifiers: { ids: string[]; at: string; sig: string } | null;
  /** flexible single-pool: manager-set matches per player (K). */
  matchesPerPlayer?: number;
  updatedAt: string;
  /** legacy (pre-external-resolver saves) — ignored on load */
  playoffMatches?: Match[];
}

export function save(s: SavedState) {
  try { localStorage.setItem(K, JSON.stringify(s)); } catch {}
}
export function load(): SavedState | null {
  try {
    const raw = localStorage.getItem(K);
    return raw ? (JSON.parse(raw) as SavedState) : null;
  } catch { return null; }
}
export function clear() {
  try { localStorage.removeItem(K); } catch {}
}
export function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
