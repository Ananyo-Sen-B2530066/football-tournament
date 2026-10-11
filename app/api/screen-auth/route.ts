// POST /api/screen-auth — validates the SCREEN code WITHOUT granting any
// control. The screen code must never be able to draw, reset or edit scores,
// so it cannot be accepted by /api/control.

import { screenAllowed } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return new Response(JSON.stringify({ ok: screenAllowed(req) }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
