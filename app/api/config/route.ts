// GET /api/config — non-secret capability flags so the UI knows whether a PIN
// gate is actually configured (and can skip the prompt when it isn't), plus
// whether config/tournament.config.ts has been edited since the running build.
//
// /api/config is UNAUTHENTICATED, so this response must never carry a secret:
// the per-key diffs are gated behind the owner PIN and the PINs themselves are
// reported as "set"/"empty" only.

import * as CFG from "@/config/tournament.config";
import { OWNER_PIN, SCREEN_PIN } from "@/config/tournament.config";
import { ownerAllowed } from "@/lib/server/auth";
import { configStaleness } from "@/lib/server/configStaleness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const stale = configStaleness(CFG as unknown as Record<string, unknown>);
  const body: Record<string, unknown> = {
    ownerPinSet: !!OWNER_PIN,
    screenPinSet: !!SCREEN_PIN,
    // Safe to expose: "your config is out of date" leaks nothing.
    configStale: stale.stale,
  };

  if (ownerAllowed(req)) {
    body.configReadable = stale.readable;
    body.configDiffs = stale.diffs;
    body.configUnreadable = stale.unreadable;
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
