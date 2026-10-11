// GET /api/state — the single source of truth every site reads.
// ?since=<revision> returns 204 when the client is already up to date,
// so a 1.5s poll costs ~0 bytes when nothing changed.

import { getState } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // NB: must check presence — Number(null) is 0, which would wrongly 304/204
  // a fresh client whose revision is also 0.
  const has = url.searchParams.has("since");
  const since = Number(url.searchParams.get("since"));
  const s = getState();
  if (has && Number.isFinite(since) && since === s.revision) {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  return new Response(JSON.stringify(s), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
