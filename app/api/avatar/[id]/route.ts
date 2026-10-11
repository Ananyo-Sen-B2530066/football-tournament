// Serves photos extracted from the roster spreadsheet (data/avatars/).
// This is what makes the projector work with no internet at the venue.

import { readAvatar } from "@/lib/server/avatarStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const hit = readAvatar(decodeURIComponent(id ?? ""));
  if (!hit) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(hit.data), {
    status: 200,
    headers: {
      "content-type": MIME[hit.ext] ?? "application/octet-stream",
      // immutable: content is keyed by gamer_id and only re-uploaded on re-import
      "cache-control": "public, max-age=3600",
    },
  });
}
