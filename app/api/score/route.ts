// POST /api/score — record one match's result. Open to editors (that is the
// point: volunteers type scores from their phones) and to the owner page.
// LWW merge + 3rd-place maintenance happen server-side.

import { applyScore, ScorePatch } from "@/lib/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: ScorePatch;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Bad JSON." }), { status: 400 });
  }
  if (!body?.matchId) {
    return new Response(JSON.stringify({ ok: false, error: "matchId required." }), { status: 400 });
  }
  const res = applyScore(body);
  const status = res.ok ? 200 : res.stale ? 409 : 400;
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
