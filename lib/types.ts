export type Stage = "league" | "playoff" | "r16" | "qf" | "sf" | "final" | "third";
export type LeagueMode = "single" | "twoPot" | "ucl";

export interface Player {
  id: string;
  name: string;
  pot: number; // 1-based
  /** Optional image URL. When empty the app probes AVATAR_DIR/{id}.{jpg,png,webp}. */
  avatar?: string | null;
}

export interface Match {
  id: string;
  stage: Stage;
  round?: string;
  playerA: string; // player id
  playerB: string; // player id
  scoreA: number | null;
  scoreB: number | null;
  penaltyWinner?: string | null; // player id — required if knockout level
  goldenGoalWinner?: string | null; // playoff tiebreak
  played: boolean;
  feedsFrom?: [string, string] | null; // fixed-bracket path
  matchday?: number;
  updatedAt?: string | null; // ISO timestamp of last edit (for last-write-wins sync)
  /** ISO time the score was entered ON THE DEVICE. Drives last-write-wins ordering
   *  across phones; `updatedAt` is the server receipt time. Clock-skew tolerant
   *  because a stale offline edit is rejected instead of overwriting a fresh score. */
  editedAt?: string | null;
  /** Which device produced the current value (shown in the editor's conflict hint). */
  editedBy?: string | null;
}

export interface TableRow {
  playerId: string;
  name: string;
  pot: number;
  p: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
  form: ("W" | "D" | "L")[];
}

export interface SheetsResultRow {
  match_id: string;
  stage: string;
  round?: string;
  player_a: string;
  player_b: string;
  score_a: string;
  score_b: string;
  played: string;
  winner?: string;
  updated_at?: string;
}

export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// ============================================================
// Server-authoritative tournament state (single source of truth)
// ============================================================

export type DrawKind = "league" | "ko1" | "ko2";

/** A draw being staged/played. Lives on the SERVER so the projection site can
 *  replay the exact same ceremony on every device, in sync. */
export interface PendingDraw {
  kind: DrawKind;
  matches: Match[];
  /** How many ties have been revealed. Server-authoritative. */
  revealed: number;
  /** Owner-controlled autoplay. Server timer advances `revealed`. */
  auto: boolean;
  at: string;
  /** Anchor for autoplay timing; re-based on pause/resume so it never jumps. */
  startedAt: string;
}

/** What the projector shows. The owner ticks a set of pages during the group
 *  stage; once the bracket exists it shows the bracket (and the table if
 *  ticked). Draw ceremonies always take over regardless. */
export interface Projection {
  /** "md1".."mdN" (a matchday's fixtures) and/or "table". Empty = bracket only. */
  pages: string[];
  rotate: boolean;
}

export interface TournamentState {
  /** Bumped on every mutation. Clients poll with ?since=revision -> 204 when equal. */
  revision: number;
  players: Player[];
  league: Match[];
  knockout: Match[];
  qualifiers: 8 | 16;
  /** K for the 1-pot flexible league. */
  matchesPerPlayer: number;
  /** Qualifiers decided by an EXTERNAL tie-breaker and recorded here. */
  externalQualifiers: { ids: string[]; at: string; sig: string } | null;
  sfDrawDone: boolean;
  pendingDraw: PendingDraw | null;
  projection: Projection;
  /** Owner's "hide the results" switch. Default false = results show
   *  automatically once the tournament is finished. */
  resultsSuppressed: boolean;
  /** Event name shown on every screen. Seeded from TOURNAMENT_NAME but owned
   *  by the store so /owner can rename it live, without a rebuild. */
  tournamentName: string;
  updatedAt: string;
}

export const KO_STAGES: Stage[] = ["r16", "qf", "sf", "final", "third"];
export const isKoStage = (s: Stage) => KO_STAGES.includes(s);
