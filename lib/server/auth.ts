// Server-side PIN checks. The UI hides things, but THIS is the real gate:
// knowing a URL (or the forwarded tunnel address) grants nothing without the code.

import { OWNER_PIN, SCREEN_PIN } from "@/config/tournament.config";

function check(provided: string | null, expected: string): boolean {
  if (!expected) return true; // PIN disabled
  if (!provided) return false;
  return provided.trim() === expected.trim();
}

export const ownerAllowed = (req: Request) => check(req.headers.get("x-owner-pin"), OWNER_PIN);
export const screenAllowed = (req: Request) => check(req.headers.get("x-screen-pin"), SCREEN_PIN);

/** JSON 403 helper. */
export const denied = (what: string) =>
  new Response(JSON.stringify({ ok: false, error: `${what} PIN required.` }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
