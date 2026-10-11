// Server-side "is config/tournament.config.ts newer than the running build?".
//
// WHY THIS EXISTS
// Every value in config/tournament.config.ts is compiled into the bundle by
// `next build` — client components AND server route handlers alike (the PINs are
// in .next/server too; there is no runtime file read anywhere in the app). So
// editing the file after a build has NO effect until you rebuild. That is
// correct, just silent, and it burns people.
//
// HOW THE COMPARISON WORKS, WITHOUT A BUILD-TIME FINGERPRINT
// Inside a server module, `import`ing the config yields the values BAKED INTO
// THE RUNNING BUILD. `readFileSync` yields what the file says NOW. Comparing the
// two needs no generated file, no next.config.ts and no extra build step, and it
// tells us *which* keys moved rather than just "something changed".
//
// In `npm run dev` the module is recompiled on demand, so the two agree and this
// reports "fresh" — which is the correct answer for dev.
//
// NEVER FALSE-ALARMS
// A key we cannot parse is skipped, not reported. A missing file is
// `readable: false`, not stale. Silence beats a spurious rebuild warning during
// an event.
//
// SECRETS
// OWNER_PIN / SCREEN_PIN are never included — not their values, not their
// lengths. They are reported only as "set"/"empty", so this module can be called
// from an endpoint whose response is owner-gated without any risk of leaking.

import fs from "node:fs";
import path from "node:path";

// No import of the config itself, on purpose: the caller passes the compiled-in
// values in. That keeps this module free of the "@/" path alias, which Node's
// type-stripping loader (used by scripts/verify.mjs) cannot resolve, and it
// makes diffConfig trivially testable with a fake "built" object.

export interface ConfigDiff {
  key: string;
  built: string;
  onDisk: string;
}

export interface ConfigStaleness {
  /** True when at least one key provably differs between build and disk. */
  stale: boolean;
  /** False when the file could not be read (standalone deploy, missing file). */
  readable: boolean;
  /** Keys we could not parse. Never counted as a difference. */
  unreadable: string[];
  diffs: ConfigDiff[];
}

const CONFIG_REL = path.join("config", "tournament.config.ts");

/** Keys whose value is a secret or a capability URL: report presence only. */
const MASKED = new Set<string>(["OWNER_PIN", "SCREEN_PIN", "SHEET_CSV_URL_PLAYERS", "SHEET_CSV_URL_RESULTS"]);

/** Keys compared as a whole-string literal. */
const SCALARS = [
  "TOURNAMENT_NAME",
  "POTS",
  "LEAGUE_MATCHES_PER_PLAYER",
  "FLEXIBLE_LEAGUE",
  "QUALIFIERS_COUNT",
  "THIRD_PLACE",
  "POINTS_WIN",
  "POINTS_DRAW",
  "TIEBREAK_MODE",
  "STATE_FILE",
  "POLL_INTERVAL_MS",
  "DRAW_STEP_MS",
  "AVATAR_DIR",
] as const;

/**
 * Pull the raw initialiser for one `export const KEY` out of the source.
 *
 * Tolerates everything the real file does:
 *   export const POTS: number = 4;
 *   export const QUALIFIERS_COUNT: 8 | 16 = 8;      <- union type, no '=' in it
 *   export const PLAYERS: string[] = [ ... ];
 *   export const TIEBREAK_MODE = "golden_goal" as const;
 *   export const OWNER_PIN = "6827";   // <-- trailing comment
 * `export function` helpers and docblock comments are naturally skipped.
 *
 * Comments are stripped first, so a commented-out entry (a very common way to
 * park a PLAYER_IMAGES mapping) cannot be mistaken for a live one. A `//`
 * inside a string literal such as "https://…" must survive, so this tracks
 * quote state instead of pattern-matching naively.
 */
export function stripComments(src: string): string {
  let out = "";
  let quote = "";
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inBlock) {
      if (c === "*" && n === "/") { inBlock = false; i++; }
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    out += c;
  }
  return out;
}

export function extractInitialiser(src: string, key: string): string | null {
  const re = new RegExp(`export\\s+const\\s+${key}\\b[^=;]*=\\s*([\\s\\S]*?)\\s*;`);
  const m = src.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  return raw.length ? raw : null;
}

/** Reduce a raw initialiser to a comparable, human-readable string. */
function normalise(raw: string): string {
  let s = raw
    .replace(/\bas\s+const\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (s.startsWith("[") && s.endsWith("]")) {
    const names = [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    return `${names.length} players: ${names.join(", ")}`;
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    const keys = [...s.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map((m) => m[1]);
    return keys.length ? `${keys.length} entries: ${keys.join(", ")}` : "0 entries";
  }
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
}

/** Present/absent only, so a secret can be compared without being disclosed. */
const presence = (v: unknown) => (v ? "set" : "empty");

/**
 * PURE comparison: given the config SOURCE TEXT and the values COMPILED INTO
 * the running build, work out what differs. Exported separately from
 * configStaleness() so the parsing is unit-testable without touching the disk.
 */
export function diffConfig(src: string, built: Record<string, unknown>): ConfigStaleness {
  const diffs: ConfigDiff[] = [];
  const unreadable: string[] = [];
  const code = stripComments(src);

  for (const key of SCALARS) {
    const raw = extractInitialiser(code, key);
    if (raw === null) {
      unreadable.push(key); // never a false alarm on something we can't read
      continue;
    }
    const onDisk = normalise(raw);
    const builtValue = built[key];
    if (String(builtValue) !== onDisk) diffs.push({ key, built: String(builtValue), onDisk });
  }

  // PLAYERS / PLAYER_IMAGES are composite, so compare the built objects directly.
  const playersRaw = extractInitialiser(code, "PLAYERS");
  if (playersRaw === null) {
    unreadable.push("PLAYERS");
  } else {
    const list = (built.PLAYERS as string[]) ?? [];
    const onDisk = normalise(playersRaw);
    const was = `${list.length} players: ${list.join(", ")}`;
    if (was !== onDisk) diffs.push({ key: "PLAYERS", built: was, onDisk });
  }

  const imagesRaw = extractInitialiser(code, "PLAYER_IMAGES");
  if (imagesRaw === null) {
    unreadable.push("PLAYER_IMAGES");
  } else {
    const ids = Object.keys((built.PLAYER_IMAGES as Record<string, string>) ?? {});
    const was = ids.length ? `${ids.length} entries: ${ids.join(", ")}` : "0 entries";
    const onDisk = normalise(imagesRaw);
    if (was !== onDisk) diffs.push({ key: "PLAYER_IMAGES", built: was, onDisk });
  }

  // Secrets and capability URLs: presence only, never the value.
  for (const key of MASKED) {
    const raw = extractInitialiser(code, key);
    if (raw === null) {
      unreadable.push(key);
      continue;
    }
    const diskSet = normalise(raw).length > 0;
    const builtSet = Boolean(built[key]);
    if (diskSet !== builtSet) diffs.push({ key, built: presence(builtSet), onDisk: presence(diskSet) });
  }

  return { stale: diffs.length > 0, readable: true, unreadable, diffs };
}

let cached: { mtimeMs: number; result: ConfigStaleness } | null = null;

/**
 * Compare the config baked into this build against the file on disk.
 * Memoised on the file's mtime so a 1.5s poll from three devices cannot turn
 * into three reads + parses per tick.
 */
export function configStaleness(built: Record<string, unknown>): ConfigStaleness {
  const file = path.join(process.cwd(), CONFIG_REL);
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (cached && cached.mtimeMs === mtimeMs) return cached.result;
    const result = diffConfig(fs.readFileSync(file, "utf8"), built);
    cached = { mtimeMs, result };
    return result;
  } catch {
    // No file (e.g. a standalone export). Report "can't check", not "stale".
    return { stale: false, readable: false, unreadable: [], diffs: [] };
  }
}
