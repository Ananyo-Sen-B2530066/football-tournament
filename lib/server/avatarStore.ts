// Photos pulled out of the roster spreadsheet are stored on the HOST under
// data/avatars/ and served by /api/avatar/[id]. That means the projector and
// every phone work with no internet at the venue, and nothing depends on
// Next's public/ asset manifest being rebuilt at runtime.

import fs from "node:fs";
import path from "node:path";
import { STATE_FILE } from "@/config/tournament.config";

const EXTS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
const MAX_BYTES = 4 * 1024 * 1024;

function dir(): string {
  const base = path.isAbsolute(STATE_FILE) ? path.dirname(STATE_FILE) : path.join(process.cwd(), path.dirname(STATE_FILE));
  return path.join(base, "avatars");
}

/** Never let an id escape the avatars directory. Rejects dot runs outright. */
function safeName(id: string): string {
  const s = id.replace(/[^A-Za-z0-9._-]/g, "");
  return s.includes("..") ? "" : s;
}

export function saveAvatar(id: string, ext: string, data: Buffer): string | null {
  const name = safeName(id);
  const e = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!name || !EXTS.includes(e)) return null;
  if (data.length > MAX_BYTES) return null;
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), `${name}.${e}`), data);
    return `${name}.${e}`;
  } catch {
    return null;
  }
}

export function readAvatar(id: string): { data: Buffer; ext: string } | null {
  const name = safeName(id);
  if (!name) return null;
  for (const e of EXTS) {
    const p = path.join(dir(), `${name}.${e}`);
    try {
      if (fs.existsSync(p)) return { data: fs.readFileSync(p), ext: e };
    } catch {}
  }
  return null;
}

export function clearAvatars() {
  try {
    fs.rmSync(dir(), { recursive: true, force: true });
  } catch {}
}
