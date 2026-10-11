"use client";
// ============================================================
// / — the launcher. Open, no code: it exists so the bare LAN link
// (and a forwarded tunnel) has one obvious front door instead of
// dropping a volunteer straight into a form, or you into a PIN box.
//
// The status line is derived from the SAME planScreen() the
// projector uses, so the two can never disagree about the stage.
// ============================================================

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTournament } from "@/lib/useTournament";
import { useConfigHealth } from "@/lib/useConfigHealth";
import { describePlan, planScreen, screenInput } from "@/lib/screenPlaylist";
import { isPlaceholder } from "@/lib/draw";
import { KO_STAGES } from "@/lib/types";
import Avatar from "@/components/Avatar";
import ErrorBoundary from "@/components/ErrorBoundary";

const TONE: Record<string, string> = {
  idle: "text-white/60",
  live: "text-amber-300",
  draw: "text-cyan-300",
  done: "text-emerald-300",
};

export default function Home() {
  // slower poll than the working sites — this page is mostly static links
  const { state, derived, loading, online } = useTournament(4000);
  const config = useConfigHealth(null);

  // Rendered in the footer, so it must not be read during the first client
  // render or the markup will not match what the server sent.
  const [host, setHost] = useState("");
  useEffect(() => { setHost(window.location.host); }, []);

  const status = (() => {
    if (!state || !derived)
      return { label: "Connecting to the tournament server…", tone: "idle" as const, detail: "" };
    const plan = planScreen(screenInput(state, derived));
    const tiesToScore = [...derived.league, ...derived.knockout].filter(
      (m) => !m.played && !isPlaceholder(m.playerA) && !isPlaceholder(m.playerB)
    ).length;
    const championName = derived.champion ? derived.names.get(derived.champion) ?? null : null;
    return describePlan(plan, {
      pendingKind: state.pendingDraw?.kind ?? null,
      championName,
      tiesToScore,
      matchdays: derived.matchdays,
      rosterSize: state.players.length,
    });
  })();

  const champion = state && derived?.champion ? state.players.find((p) => p.id === derived.champion) : undefined;
  const leader = derived?.table?.[0];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#060b26] text-white antialiased">
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 md:py-14">
          {/* header + live status */}
          <header>
            <div className="text-xs tracking-[0.35em] text-cyan-300">★ TOURNAMENT HUB</div>
            <h1 className="mt-1 text-3xl font-black leading-tight md:text-5xl">{state?.tournamentName ?? "…"}</h1>
            <div className={`mt-3 flex items-center gap-2 text-sm font-bold ${TONE[status.tone]}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"}`} />
              <span>{status.label}</span>
            </div>
            {status.detail && <div className="mt-1 pl-4 text-xs text-white/40">{status.detail}</div>}
            {config.stale && (
              <div className="mt-3 rounded-xl bg-amber-300/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-300/30">
                ⚠ <code>config/tournament.config.ts</code> was edited after the last build — the app
                is still running the old values. Rebuild to apply. (The name above is live and
                correct regardless.)
              </div>
            )}
            {!online && (
              <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200 ring-1 ring-red-400/30">
                Can&apos;t reach the host server. Links below still work — scores won&apos;t save until it&apos;s back.
              </div>
            )}
          </header>

          {/* the three sites — score entry first and biggest, it's what the team needs */}
          <main className="mt-8 space-y-3">
            <Link href="/editor"
              className="block rounded-3xl bg-cyan-400 p-5 text-black ring-2 ring-cyan-300/40 transition active:scale-[0.99] md:p-7">
              <div className="flex items-start gap-4">
                <span className="text-4xl md:text-5xl">📱</span>
                <div className="min-w-0">
                  <div className="text-xl font-black md:text-3xl">Record scores</div>
                  <div className="mt-1 text-sm font-semibold opacity-80">
                    Tap here after your match — no code needed.
                  </div>
                </div>
              </div>
            </Link>

            <div className="grid gap-3 sm:grid-cols-2">
              <SiteCard
                href="/owner" icon="🎛" title="Owner control"
                sub="Draws, settings, cut-tie resolution, what the projector shows."
                lock="owner code"
                accent="bg-white/5 ring-white/10 hover:bg-white/10"
              />
              <SiteCard
                href="/screen" icon="📺" title="Projection"
                sub="Big-type display — ceremony, fixtures, table, bracket."
                lock="screen code"
                accent="bg-amber-300/10 ring-amber-300/30 hover:bg-amber-300/15"
              />
            </div>
          </main>

          {/* at-a-glance */}
          {derived && state && state.players.length > 0 && (
            <section className="mt-6 space-y-2 text-sm">
              {status.tone === "done" && champion && (
                <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-300/15 to-emerald-400/15 p-4 ring-1 ring-amber-300/30">
                  <Avatar player={champion} size={44} ring />
                  <div>
                    <div className="text-xs tracking-[0.3em] text-amber-300">★ CHAMPION</div>
                    <div className="text-lg font-black">{champion.name}</div>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-2xl bg-white/[0.03] p-4 text-white/60 ring-1 ring-white/10">
                <span><b className="text-white">{state.players.length}</b> players</span>
                <span>Top <b className="text-white">{state.qualifiers}</b> qualify</span>
                {leader && leader.p > 0 && (
                  <span>Table leader <b className="text-white">{leader.name}</b> ({leader.pts} pts)</span>
                )}
                {derived.knockout.length > 0 && (
                  <span><b className="text-white">{derived.knockout.filter((m) => m.played).length}</b>/{derived.knockout.length} KO ties played</span>
                )}
              </div>
            </section>
          )}

          <footer className="mt-auto pt-10 text-center text-xs text-white/30">
            {loading ? "loading…" : "One server, three sites — every score updates everywhere."}
            {/*
              window.location.host is only knowable on the client, so reading it
              during render made the first client render differ from the server
              HTML — a guaranteed hydration mismatch on every load. Publish it
              after mount instead (same pattern as useDrafts). Until then nothing
              is rendered, which is exactly what the server sent.
            */}
            {host && (
              <div className="mt-1">
                Share <code className="rounded bg-black/40 px-1.5 py-0.5 text-white/50">http://{host}/editor</code> with your team
              </div>
            )}
          </footer>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function SiteCard({
  href, icon, title, sub, lock, accent,
}: { href: string; icon: string; title: string; sub: string; lock: string; accent: string }) {
  return (
    <Link href={href} className={`block rounded-3xl p-5 ring-1 transition active:scale-[0.99] ${accent}`}>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-3xl">{icon}</span>
        <div className="whitespace-nowrap text-lg font-black">{title}</div>
        <span className="ml-auto shrink-0 rounded-lg bg-black/30 px-2 py-1 text-[10px] font-bold text-white/50">🔒 {lock}</span>
      </div>
      <p className="mt-2 text-sm text-white/55">{sub}</p>
    </Link>
  );
}
