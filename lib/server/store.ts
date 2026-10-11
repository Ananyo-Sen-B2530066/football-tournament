// ============================================================
// SERVER-AUTHORITATIVE TOURNAMENT STORE
// ------------------------------------------------------------
// Single source of truth for /owner, /editor and /screen.
// Lives in the host laptop's memory + a JSON file on disk.
//
// Why this exists: state used to live in each browser's localStorage,
// so every phone had a private copy and only Google Sheets bridged
// them. Now every site reads/writes THIS store, so one score entry
// shows up on all devices within POLL_INTERVAL_MS.
//
// Key invariants:
//  - `revision` increases on every mutation -> clients poll ?since=rev
//    and get 204 (zero bytes) when nothing changed.
//  - Score merges are per-match last-write-wins ordered by `editedAt`
//    (the DEVICE's edit time), so a stale offline edit is rejected
//    rather than clobbering a fresh score from another phone.
//  - `pendingDraw` lives here (not in the owner's React state) so the
//    projector replays the identical ceremony in sync.
//  - 3rd-place creation lives here, not in a client useEffect, so all
//    devices agree on when THIRD-01 appears.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { DRAW_STEP_MS, STATE_FILE, THIRD_PLACE, TOURNAMENT_NAME } from "@/config/tournament.config";
import { isPlaceholder, matchWinner, propagateWinners } from "../draw";
import { cleanTournamentName } from "../nameRules";
import { cutoffTies, computeTable, slotsForTie } from "../table";
import { tournamentFinished } from "../stats";
import {
  DrawKind, Match, PendingDraw, Player, Projection, TournamentState, isKoStage,
} from "../types";

export function emptyState(): TournamentState {
  return {
    revision: 0,
    players: [],
    league: [],
    knockout: [],
    qualifiers: 8,
    matchesPerPlayer: 4,
    externalQualifiers: null,
    sfDrawDone: false,
    pendingDraw: null,
    projection: { pages: ["table"], rotate: true },
    resultsSuppressed: false,
    tournamentName: TOURNAMENT_NAME,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- persistence ----------

function statePath(): string {
  return path.isAbsolute(STATE_FILE) ? STATE_FILE : path.join(process.cwd(), STATE_FILE);
}

function normalize(raw: any): TournamentState {
  const b = emptyState();
  if (!raw || typeof raw !== "object") return b;
  return {
    ...b,
    ...raw,
    revision: Number(raw.revision) || 0,
    players: Array.isArray(raw.players) ? raw.players : b.players,
    league: Array.isArray(raw.league) ? raw.league : [],
    knockout: Array.isArray(raw.knockout) ? raw.knockout : [],
    qualifiers: raw.qualifiers === 16 ? 16 : 8,
    matchesPerPlayer: Number(raw.matchesPerPlayer) || b.matchesPerPlayer,
    externalQualifiers: raw.externalQualifiers ?? null,
    sfDrawDone: !!raw.sfDrawDone,
    pendingDraw: raw.pendingDraw ?? null,
    projection: normalizeProjection(raw.projection),
    resultsSuppressed: raw.resultsSuppressed === true,
    // Pre-existing state files have no name: seed from config so an old
    // data/state.json upgrades itself without a hand edit.
    tournamentName:
      typeof raw.tournamentName === "string" && raw.tournamentName.trim()
        ? raw.tournamentName.trim()
        : b.tournamentName,
  };
}

/** Accepts the new { pages, rotate } shape and migrates the older
 *  { matchday, rotate } one, so a tournament saved before this change keeps
 *  projecting exactly what it was projecting. */
function normalizeProjection(raw: any): Projection {
  const rotate = raw?.rotate !== false;
  if (Array.isArray(raw?.pages))
    return { pages: raw.pages.filter((p: unknown) => typeof p === "string"), rotate };
  if (raw && Number.isFinite(Number(raw.matchday)))
    return { pages: [`md${Number(raw.matchday)}`, "table"], rotate };
  return { pages: ["table"], rotate };
}

function readDisk(): TournamentState | null {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) return null;
    return normalize(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}

function writeDisk(s: TournamentState) {
  try {
    const p = statePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // atomic: write temp then rename, so a crash can't truncate the state file
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
    fs.renameSync(tmp, p);
  } catch {
    /* disk problems must never break the live show; state stays in memory */
  }
}

// ---------- singleton (survives Next dev HMR) ----------

type Holder = {
  state: TournamentState;
  writeTimer: NodeJS.Timeout | null;
  loaded: boolean;
};
const G = globalThis as any;
if (!G.__techfestStore) {
  G.__techfestStore = { state: readDisk() ?? emptyState(), writeTimer: null, loaded: true } as Holder;
}
const S: Holder = G.__techfestStore;

function schedulePersist() {
  if (S.writeTimer) return;
  S.writeTimer = setTimeout(() => {
    S.writeTimer = null;
    writeDisk(S.state);
  }, 200);
}

function persistNow() {
  if (S.writeTimer) { clearTimeout(S.writeTimer); S.writeTimer = null; }
  writeDisk(S.state);
}

// ---------- read / mutate ----------

export function getState(): TournamentState {
  return S.state;
}

/** Mutation helper: runs `fn`, bumps revision, schedules a disk write. */
function mutate<T>(fn: (s: TournamentState) => T): T {
  const out = fn(S.state);
  S.state.revision += 1;
  S.state.updatedAt = new Date().toISOString();
  schedulePersist();
  return out;
}

export function resetAll(): TournamentState {
  return mutate((s) => {
    const keep = {
      players: s.players,
      qualifiers: s.qualifiers,
      matchesPerPlayer: s.matchesPerPlayer,
      // Resetting the tournament must not rename the event. The name is a
      // display setting the owner controls live, not tournament progress, so
      // it survives a reset (it used to snap back to TOURNAMENT_NAME).
      tournamentName: s.tournamentName,
    };
    const fresh = { ...emptyState(), ...keep, revision: s.revision };
    Object.assign(s, fresh);
    persistNow();
    return s;
  });
}

/** The roster is only replaceable BEFORE the first draw. Once fixtures exist
 *  they reference player ids, so swapping the roster could orphan scores. */
export function rosterLocked(s: TournamentState = S.state): string | null {
  if (s.knockout.length > 0) return "The knockout bracket exists — reset the tournament to change the roster.";
  if (s.league.length > 0) return "The group stage is already drawn — reset the tournament to change the roster.";
  if (s.pendingDraw) return "A draw is in progress — confirm or cancel it before changing the roster.";
  return null;
}

/** The store trusts nobody. /api/control is owner-gated, but a malformed
 *  roster would poison every downstream draw, so the shape is checked here
 *  rather than assumed from the client. */
export function validateRoster(input: unknown): Player[] {
  if (!Array.isArray(input)) throw new Error("Players must be a list.");
  if (input.length < 2) throw new Error("Add at least 2 players.");
  if (input.length > 512) throw new Error("That is more than 512 players.");
  const seen = new Set<string>();
  return input.map((raw, i) => {
    const p = raw as Partial<Player>;
    const id = typeof p?.id === "string" ? p.id.trim() : "";
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!id) throw new Error(`Player ${i + 1} has no id.`);
    if (!name) throw new Error(`Player ${i + 1} ("${id}") has no name.`);
    if (id.length > 64) throw new Error(`Player ${i + 1} has an id longer than 64 characters.`);
    if (name.length > 64) throw new Error(`Player ${i + 1} has a name longer than 64 characters.`);
    if (seen.has(id)) throw new Error(`Duplicate player id "${id}".`);
    seen.add(id);
    const pot = Number(p?.pot);
    return {
      id,
      name,
      pot: Number.isFinite(pot) && pot >= 1 ? Math.floor(pot) : 1,
      avatar: typeof p?.avatar === "string" && p.avatar.trim() ? p.avatar.trim() : undefined,
    } satisfies Player;
  });
}

export class RosterLocked extends Error {}

export function setRoster(players: Player[], matchesPerPlayer?: number): TournamentState {
  const locked = rosterLocked();
  if (locked) throw new RosterLocked(locked);
  const clean = validateRoster(players);
  return mutate((s) => {
    s.players = clean;
    if (matchesPerPlayer != null) s.matchesPerPlayer = matchesPerPlayer;
    // ids changed -> any photo the owner uploaded by id is stale
    s.projection.pages = s.projection.pages.filter((p) => p === "table" || p.startsWith("md"));
    return s;
  });
}

export function setSettings(p: { qualifiers?: 8 | 16; matchesPerPlayer?: number }): TournamentState {
  return mutate((s) => {
    if (p.qualifiers) s.qualifiers = p.qualifiers;
    if (p.matchesPerPlayer != null) s.matchesPerPlayer = p.matchesPerPlayer;
    return s;
  });
}

/** Cosmetic, so deliberately NOT gated on rosterLocked — you may rename
 *  mid-event. Validated here so the projector can never receive junk. */
export function setTournamentName(raw: unknown): TournamentState {
  const name = cleanTournamentName(raw);
  return mutate((s) => {
    s.tournamentName = name;
    return s;
  });
}

export function setProjection(patch: { pages?: string[]; rotate?: boolean }): TournamentState {
  return mutate((s) => {
    // whitelisted here too: junk keys must never reach the projector
    if (Array.isArray(patch.pages)) s.projection.pages = patch.pages.filter(isPageId);
    if (patch.rotate != null) s.projection.rotate = !!patch.rotate;
    return s;
  });
}

const PAGE_ID = /^(md\d+|table)$/;
export const isPageId = (v: unknown): v is string => typeof v === "string" && PAGE_ID.test(v);

/** The results screen is only unlocked once the tournament is actually over. */
export function resultsBlocked(s: TournamentState = S.state): string | null {
  if (!tournamentFinished(s.knockout, THIRD_PLACE)) {
    const final = s.knockout.find((m) => m.stage === "final");
    if (!final || !final.played) return "Waiting for the final to be decided.";
    if (THIRD_PLACE) return "Waiting for the 3rd-place match.";
    return "Waiting for the final to be decided.";
  }
  return null;
}

export function setResultsSuppressed(suppressed: boolean): TournamentState {
  const blocked = resultsBlocked();
  if (blocked) throw new RosterLocked(blocked);
  return mutate((s) => {
    s.resultsSuppressed = !!suppressed;
    return s;
  });
}

export function setExternalQualifiers(v: TournamentState["externalQualifiers"]): TournamentState {
  return mutate((s) => { s.externalQualifiers = v; return s; });
}

// ---------- derived helpers (shared by store validation) ----------

/** Winners substituted into fixed-bracket placeholders, in dependency order. */
export function resolvedMatches(s: TournamentState = S.state): Match[] {
  return propagateWinners([...s.league, ...s.knockout]);
}

export function tieSignature(s: TournamentState): string {
  const table = computeTable(s.players, s.league);
  const ties = cutoffTies(table, s.qualifiers);
  if (ties.length === 0) return "";
  const pool = ties[0];
  const slots = slotsForTie(table, pool, s.qualifiers);
  return [...pool.map((r) => r.playerId).sort(), `slots:${slots}`, `q:${s.qualifiers}`].join("|");
}

/** Qualifier ids: clean top rows, or the externally-confirmed tie outcome.
 *  Shared by the store guards and the owner UI so both agree. */
export function qualifiedIds(s: TournamentState = S.state): string[] {
  const table = computeTable(s.players, s.league);
  const ties = cutoffTies(table, s.qualifiers);
  if (ties.length === 0) return table.slice(0, s.qualifiers).map((r) => r.playerId);
  const pool = ties[0];
  const sig = [...pool.map((r) => r.playerId).sort(), `slots:${slotsForTie(table, pool, s.qualifiers)}`, `q:${s.qualifiers}`].join("|");
  const rec = s.externalQualifiers;
  return rec && rec.sig === sig ? rec.ids : [];
}

// ---------- 3rd place (moved off the client) ----------
/** Create/repair THIRD-01 from the two SF losers. Idempotent. */
function ensureThirdPlace(s: TournamentState): boolean {
  if (!THIRD_PLACE) return false;
  if (s.knockout.length === 0) return false;
  const resolved = propagateWinners(s.knockout);
  const sf = resolved.filter((m) => m.stage === "sf");
  if (sf.length !== 2) return false;
  const winners = sf.map(matchWinner);
  if (winners.some((w) => !w || isPlaceholder(w))) return false;
  const losers = sf.map((m, i) => {
    const w = winners[i]!;
    if (m.playerA === w) return m.playerB;
    if (m.playerB === w) return m.playerA;
    return null;
  });
  if (losers.some((l) => !l || isPlaceholder(l!))) return false;
  const [l1, l2] = losers as [string, string];
  const existing = s.knockout.find((m) => m.stage === "third");
  if (!existing) {
    s.knockout = [
      ...s.knockout,
      { id: "THIRD-01", stage: "third", playerA: l1, playerB: l2, scoreA: null, scoreB: null, played: false },
    ];
    return true;
  }
  // unplayed 3rd-place re-syncs if an SF was rescored; played stays frozen
  if (!existing.played && (existing.playerA !== l1 || existing.playerB !== l2)) {
    s.knockout = s.knockout.map((m) => (m.id === existing.id ? { ...m, playerA: l1, playerB: l2 } : m));
    return true;
  }
  return false;
}

// ---------- score writes (last-write-wins) ----------

export interface ScorePatch {
  matchId: string;
  scoreA: number | null;
  scoreB: number | null;
  penaltyWinner?: string | null;
  /** ISO time of the edit on the device — drives LWW ordering. */
  editedAt?: string | null;
  editedBy?: string | null;
}

export interface ScoreResult {
  ok: boolean;
  error?: string;
  stale?: boolean;
  state: TournamentState;
}

const isPlaceholderId = (v: unknown) => typeof v === "string" && v.startsWith("W(");

function sanitizeScore(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(99, Math.floor(n));
}

export function applyScore(p: ScorePatch): ScoreResult {
  const now = new Date().toISOString();
  const editedAt = p.editedAt && !Number.isNaN(Date.parse(p.editedAt)) ? p.editedAt : now;
  const a = sanitizeScore(p.scoreA);
  const b = sanitizeScore(p.scoreB);

  return mutate((s) => {
    const inLeague = s.league.some((m) => m.id === p.matchId);
    const list = inLeague ? s.league : s.knockout;
    const m = list.find((x) => x.id === p.matchId);
    if (!m) return { ok: false, error: `Unknown match ${p.matchId}.`, state: s };

    // Fixed-bracket rows permanently store W(...) sides — the real names live
    // in the RESOLVED copy. So resolve before checking, otherwise this guard
    // would block every SF/Final that still has placeholder sides.
    const resolved = propagateWinners(list).find((x) => x.id === p.matchId)!;
    if (isPlaceholderId(resolved.playerA) || isPlaceholderId(resolved.playerB))
      return { ok: false, error: `${m.id} is waiting for an earlier tie's winner.`, state: s };

    // LWW: reject an edit older than what's stored.
    const stored = m.editedAt ?? m.updatedAt ?? null;
    if (stored && Date.parse(editedAt) < Date.parse(stored))
      return { ok: false, stale: true, error: `${m.id} was already updated by someone else.`, state: s };

    const played = a != null && b != null;
    const nm: Match = {
      ...m,
      scoreA: a,
      scoreB: b,
      played,
      updatedAt: now,
      editedAt,
      editedBy: p.editedBy ?? (p as any).device ?? null,
    };
    // Knockout ties: a level score is not a valid result on its own — the
    // winner must be chosen as part of the SAME confirmation, so a KO tie can
    // never sit in the state "recorded but unresolved". A winner that isn't
    // one of the two sides is corrupt data and must be refused: a phantom
    // winner would fake a champion and break 3rd-place creation.
    if (isKoStage(m.stage) && played && a === b) {
      if (!p.penaltyWinner)
        return { ok: false, error: `${m.id} is level — a knockout tie needs a winner.`, state: s };
      if (p.penaltyWinner !== resolved.playerA && p.penaltyWinner !== resolved.playerB)
        return { ok: false, error: `${m.id}: that player is not in this tie.`, state: s };
      nm.penaltyWinner = p.penaltyWinner;
    } else if (isKoStage(m.stage)) {
      nm.penaltyWinner = null;
    }

    const next = list.map((x) => (x.id === nm.id ? nm : x));
    if (inLeague) s.league = next; else s.knockout = next;
    ensureThirdPlace(s);
    return { ok: true, state: s };
  }) as ScoreResult;
}

// ---------- pending draw (staged + revealed on the server) ----------

export function stageDraw(kind: DrawKind, matches: Match[]): TournamentState {
  return mutate((s) => {
    const now = new Date().toISOString();
    s.pendingDraw = { kind, matches, revealed: 0, auto: false, at: now, startedAt: now };
    return s;
  });
}

export function drawControl(action: "reveal" | "revealAll" | "auto" | "pause", value?: boolean): TournamentState {
  return mutate((s) => {
    const pd = s.pendingDraw;
    if (!pd) return s;
    const total = pd.matches.length;
    switch (action) {
      case "reveal": pd.revealed = Math.min(total, pd.revealed + 1); break;
      case "revealAll": pd.revealed = total; break;
      case "auto":
        pd.auto = value ?? !pd.auto;
        // re-base the timer so resume continues smoothly instead of jumping
        pd.startedAt = new Date(Date.now() - pd.revealed * DRAW_STEP_MS).toISOString();
        break;
      case "pause": pd.auto = false; break;
    }
    if (pd.revealed >= total) pd.auto = false;
    return s;
  });
}

export function cancelDraw(): TournamentState {
  return mutate((s) => { s.pendingDraw = null; return s; });
}

/** Commit the staged draw into real state. */
export function confirmDraw(): { ok: boolean; error?: string; state: TournamentState } {
  return mutate((s) => {
    const pd = s.pendingDraw;
    if (!pd) return { ok: false, error: "No pending draw.", state: s };
    if (pd.kind === "league") {
      s.league = pd.matches;
      s.knockout = [];
      s.sfDrawDone = false;
      s.projection.pages = ["md1", "table"]; // start on the first matchday + table
    } else if (pd.kind === "ko1") {
      s.knockout = pd.matches;
      s.sfDrawDone = pd.matches.some((m) => m.stage === "sf");
      // knockout = bracket only; the table has to be opted back in
      s.projection.pages = [];
    } else {
      // ko2 replaces SF + Final with a fresh random SF draw
      s.knockout = [...s.knockout.filter((m) => m.stage !== "sf" && m.stage !== "final"), ...pd.matches];
      s.sfDrawDone = true;
    }
    s.pendingDraw = null;
    ensureThirdPlace(s);
    return { ok: true, state: s };
  }) as { ok: boolean; error?: string; state: TournamentState };
}

// ---------- autoplay timer (server advances `revealed`) ----------

// Idempotent + time-based so a projector joining late simply renders the
// current reveal index instead of replaying from zero.
function tick() {
  const pd = S.state.pendingDraw;
  if (!pd || !pd.auto) return;
  const total = pd.matches.length;
  if (pd.revealed >= total) { pd.auto = false; return; }
  const elapsed = Date.now() - Date.parse(pd.startedAt);
  const target = Math.min(total, Math.floor(elapsed / DRAW_STEP_MS) + 1);
  if (target > pd.revealed) {
    pd.revealed = target;
    S.state.revision += 1;
    S.state.updatedAt = new Date().toISOString();
    schedulePersist();
  }
  if (pd.revealed >= total) pd.auto = false;
}
const G2 = globalThis as any;
if (!G2.__techfestStoreTimer) {
  G2.__techfestStoreTimer = setInterval(tick, 250);
  // don't hold the process open just for the draw timer
  (G2.__techfestStoreTimer as any).unref?.();
}

// ---------- import / export ----------

export function importState(s: TournamentState): TournamentState {
  return mutate((cur) => {
    Object.assign(cur, normalize({ ...s, revision: cur.revision + 1 }));
    ensureThirdPlace(cur);
    persistNow();
    return cur;
  });
}

export function getStateForBackup() {
  const s = getState();
  return { players: s.players, league: s.league, knockout: s.knockout, externalQualifiers: s.externalQualifiers, qualifiers: s.qualifiers, matchesPerPlayer: s.matchesPerPlayer };
}
