// ============================================================
// ★ EDIT THIS FILE, THEN REBUILD — `npm run build` ★
// ------------------------------------------------------------
// Every value below is COMPILED INTO THE APP by `next build` —
// there is no runtime read of this file, on the client or the
// server. Edit it, then:
//
//     npm run build && npm start        (or: npm run serve-lan)
//
// Under `npm run dev` edits are picked up automatically, which is
// why this bites in production only. If you forget to rebuild, /owner
// shows a red banner naming exactly which values are out of date.
//
// The ONE exception: TOURNAMENT_NAME is only the initial default.
// The real name lives in the store and can be changed live from
// /owner → Projector → Tournament name, with no rebuild.
// ============================================================

export const TOURNAMENT_NAME = "KICKSTREAM NEXUS";

// --- 1. PLAYERS ------------------------------------------------
// Add every registered player/gamer-tag here (any count).
// Pots are assigned by index below, or via Setup screen in the app.
export const PLAYERS: string[] = [
  "Player A1", "Player A2", "Player A3", "Player A4",
  "Player B1", "Player B2", "Player B3", "Player B4",
  "Player C1", "Player C2", "Player C3", "Player C4",
  "Player D1", "Player D2", "Player D3", "Player D4",
  "Player E1", "Player E2", "Player E3", "Player E4",
  "Player F1", "Player F2", "Player F3", "Player F4",
  "Player G1", "Player G2", "Player G3", "Player G4",
  "Player H1", "Player H2", "Player H3", "Player H4",
];

// --- 2. POTS ---------------------------------------------------
// Group stage format is chosen by pot count:
//   1 pot  => single-pool flexible league: manager sets LEAGUE_MATCHES_PER_PLAYER
//   2 pots => each player plays exactly 2, both vs the OTHER pot (N must be even, ≥4)
//   ≥3     => UCL-style: 1 opponent per OTHER pot (needs equal pots, i.e. N % POTS == 0)
export const POTS: number = 4;

// --- 2b. FLEXIBLE LEAGUE (only when POTS == 1) ----------------
// How many distinct opponents each player faces in a single-pool league.
// The wizard exposes this when you pick 1 pot. Even N => exactly K each.
// Odd N => rotating byes, so players get K or K-1 (K must be even when N is odd).
export const LEAGUE_MATCHES_PER_PLAYER = 4;
export const FLEXIBLE_LEAGUE = true;

// --- 3. KNOCKOUT -----------------------------------------------
// 8  => single QF draw fixes full bracket (SF + Final locked)
// 16 => two draws: R16 draw fixes QF, then fresh SF draw after QFs
export const QUALIFIERS_COUNT: 8 | 16 = 16;

// Optional 3rd-place playoff (auto-created once both SFs are decided)
export const THIRD_PLACE = true;

// --- 4. SCORING -------------------------------------------------
export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
export const TIEBREAK_MODE = "golden_goal" as const; // league cut-off ties -> golden-goal playoff

// --- 5. ACCESS CONTROL --------------------------------------------
// Two SEPARATE codes so you can hand the projector its own code without
// exposing draw/reset control. Leave "" to disable that PIN.
// Checked SERVER-SIDE on /api/control — knowing a URL grants nothing.
export const OWNER_PIN = "6827";   // <-- SET THIS before the event
export const SCREEN_PIN = "30266";  // <-- SET THIS before the event

// --- 6. STATE + SYNC ---------------------------------------------
// Server-authoritative state lives on the HOST laptop in this file.
// Every device (owner / editor phones / projector) polls it, so one
// score update shows up everywhere within POLL_INTERVAL_MS.
export const STATE_FILE = "data/state.json";
export const POLL_INTERVAL_MS = 1500;
/** Autoplay cadence for the draw ceremony on the projector. */
export const DRAW_STEP_MS = 1400;

// --- 7. PLAYER IMAGES (projection showoff) -----------------------
// Resolution order per player:
//   1. PLAYER_IMAGES map below (explicit URL)
//   2. AVATAR_DIR + "/" + playerId + ".jpg" | ".png" | ".webp"  (auto-probed)
//   3. monogram fallback (initials) — a missing image never breaks the show
// Drop files as public/players/p-1.jpg, p-2.jpg, ... (ids match PLAYERS order).
export const AVATAR_DIR = "/players";
/** Optional explicit image URL per gamer-tag. Needs internet on the projector. */
export const PLAYER_IMAGES: Record<string, string> = {
  // "Player A1": "https://…/p1.png",
};

// --- 8. SHEETS (snapshot / archival only — NOT the live transport) ---
// The app is the source of truth on event day; no internet required.
// Sheets is used for: roster + avatar import, and archival CSV export.
// 1. Players CSV: columns name,pot,avatar  (e.g. ...&sheet=Players)
// 2. Results CSV: published from the Results tab for the archive.
export const SHEET_CSV_URL_PLAYERS = ""; // e.g. https://docs.google.com/spreadsheets/d/XXX/gviz/tq?tqx=out:csv&sheet=Players
export const SHEET_CSV_URL_RESULTS = ""; // e.g. https://docs.google.com/spreadsheets/d/XXX/gviz/tq?tqx=out:csv&sheet=Results

// --- helpers (do not edit) --------------------------------------
export function playersPerPot(): number {
  return Math.floor(PLAYERS.length / POTS);
}

/** Non-blocking advisories shown on the owner page. */
export function configWarnings(): string[] {
  const w: string[] = [];
  if (!OWNER_PIN) w.push("OWNER_PIN is empty — /owner and /api/control are open to anyone on the network/tunnel.");
  if (!SCREEN_PIN) w.push("SCREEN_PIN is empty — the projection site opens without a code.");
  return w;
}

export function validateConfig(): string[] {
  const errs: string[] = [];
  if (PLAYERS.length < 4) errs.push("Add at least 4 players.");
  if (POTS === 1) {
    if (LEAGUE_MATCHES_PER_PLAYER < 1) errs.push("LEAGUE_MATCHES_PER_PLAYER must be ≥ 1 for 1-pot flexible league.");
    if (LEAGUE_MATCHES_PER_PLAYER > PLAYERS.length - 1) errs.push(`LEAGUE_MATCHES_PER_PLAYER (${LEAGUE_MATCHES_PER_PLAYER}) > players-1 (${PLAYERS.length - 1}).`);
    if (PLAYERS.length % 2 !== 0 && LEAGUE_MATCHES_PER_PLAYER % 2 !== 0)
      errs.push(`Odd player count (${PLAYERS.length}) with 1-pot league needs LEAGUE_MATCHES_PER_PLAYER even (got ${LEAGUE_MATCHES_PER_PLAYER}).`);
  } else if (POTS === 2) {
    if (PLAYERS.length < 4) errs.push("2-pot league needs at least 4 players.");
    else if (PLAYERS.length % 2 !== 0) errs.push(`POTS=2 needs even player count (got ${PLAYERS.length}) — use 1 pot (flexible) instead.`);
  } else {
    if (PLAYERS.length % POTS !== 0)
      errs.push(`POTS=${POTS} (≥3) needs equal pots: PLAYERS (${PLAYERS.length}) must be divisible by ${POTS}. Pick 1 pot (flexible), 2 pots (even count), or a divisible pot count.`);
  }
  if (![8, 16].includes(QUALIFIERS_COUNT)) errs.push("QUALIFIERS_COUNT must be 8 or 16.");
  if (QUALIFIERS_COUNT > PLAYERS.length)
    errs.push(`QUALIFIERS_COUNT (${QUALIFIERS_COUNT}) exceeds players (${PLAYERS.length}).`);
  if (new Set(PLAYERS.map((p) => p.trim().toLowerCase())).size !== PLAYERS.length)
    errs.push("Duplicate player names — names must match Sheets exactly.");
  return errs;
}
