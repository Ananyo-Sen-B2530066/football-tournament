"use client";
// ============================================================
// /editor — the score-entry site volunteers use on their phones.
// Deliberately the DEFAULT route (app/page.tsx redirects here), so
// the bare LAN link goes straight to the thing the team needs.
// Empty until the owner runs the group draw; fills in automatically
// the moment the draw is confirmed (polling handles it).
// ============================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/lib/useTournament";
import { useConfigHealth } from "@/lib/useConfigHealth";
import { useDrafts } from "@/lib/drafts";
import { isResolved, needsAction } from "@/lib/scoreFlow";
import PhoneScoreCard from "@/components/PhoneScoreCard";
import Avatar from "@/components/Avatar";
import { Match } from "@/lib/types";

type Filter = "todo" | "all" | "done";

export default function EditorPage() {
  const { state, derived, loading, online, queued, conflict, setConflict, setScore } = useTournament();
  const [filter, setFilter] = useState<Filter>("todo");
  const config = useConfigHealth(null, 30000);
  const eventName = state?.tournamentName ?? "…";
  const { drafts, setDraft } = useDrafts(
    useMemo(() => (state && derived ? [...derived.league, ...derived.knockout] : []), [state, derived]),
    !!state && !!derived
  );

  const groups = useMemo(() => {
    if (!state || !derived) return [];
    const out: { key: string; title: string; list: Match[] }[] = [];
    const stageTitle: Record<string, string> = { qf: "QUARTER-FINALS", sf: "SEMI-FINALS", final: "FINAL", third: "3RD PLACE", r16: "ROUND OF 16" };
    for (const d of derived.matchdays) {
      out.push({ key: `md${d}`, title: `MATCHDAY ${d}`, list: derived.league.filter((m) => (m.matchday ?? 1) === d) });
    }
    for (const st of ["r16", "qf", "sf", "final", "third"]) {
      const list = derived.knockout.filter((m) => m.stage === st);
      if (list.length) out.push({ key: st, title: stageTitle[st], list });
    }
    return out;
  }, [state, derived]);

  const visible = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          list: g.list.filter((m) => {
            // A knockout tie that is level but still has no winner stays in
            // To score — otherwise it would sit in Completed, unresolved,
            // where nobody would look for it.
            if (filter === "todo") return needsAction(m);
            if (filter === "done") return isResolved(m);
            return true;
          }),
        }))
        .filter((g) => g.list.length > 0),
    [groups, filter]
  );

  const todoCount = useMemo(() => {
    if (!derived) return 0;
    return [...derived.league, ...derived.knockout].filter(needsAction).length;
  }, [derived]);

  if (loading)
    return <Shell online={online} queued={queued} configStale={config.stale} name={eventName}><Centered>Connecting to the tournament server…</Centered></Shell>;

  if (!state)
    return <Shell online={online} queued={queued} configStale={config.stale} name={eventName}><Centered>Can't reach the server. Retrying…</Centered></Shell>;

  const drawn = state.league.length > 0 || state.knockout.length > 0;

  return (
    <Shell online={online} queued={queued} configStale={config.stale} name={eventName}>
      {conflict && (
        <div className="sticky top-0 z-20 bg-amber-300 px-4 py-2 text-center text-xs font-bold text-black" onClick={() => setConflict(null)}>
          {conflict} (tap to dismiss)
        </div>
      )}

      {!drawn ? (
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="mx-auto mb-6 h-16 w-16 animate-pulse rounded-full bg-cyan-400/20 ring-1 ring-cyan-300/40" />
          <h2 className="text-2xl font-black">Waiting for the group draw</h2>
          <p className="mt-3 text-sm text-white/60">
            The owner runs the draw on the master laptop. This page fills in automatically the moment it happens — keep it open.
          </p>
          <p className="mt-6 text-xs text-white/30">You don't need to refresh.</p>
        </div>
      ) : (
        <>
          <div className="sticky top-0 z-10 flex gap-2 border-b border-white/10 bg-[#060b26]/95 px-3 py-2 backdrop-blur">
            {(["todo", "all", "done"] as Filter[]).map((f) => (
              <button
                key={f} onClick={() => setFilter(f)}
                className={`flex-1 rounded-xl py-2 text-xs font-black uppercase tracking-wider ${filter === f ? "bg-cyan-400 text-black" : "bg-white/10 text-white/60 ring-1 ring-white/10"}`}
              >
                {f === "todo" ? `To score${todoCount ? ` (${todoCount})` : ""}` : f}
              </button>
            ))}
          </div>

          <div className="space-y-5 px-3 py-4">
            {visible.length === 0 && (
              <div className="py-16 text-center text-sm text-white/50">
                {filter === "todo" ? "✓ All caught up — nothing left to score." : "Nothing here."}
              </div>
            )}
            {visible.map((g) => (
              <section key={g.key}>
                <h2 className="mb-2 px-1 text-xs font-black tracking-[0.25em] text-cyan-300">{g.title}</h2>
                <div className="space-y-2">
                  {g.list
                    .slice()
                    .sort((x, y) => x.id.localeCompare(y.id))
                    .map((m) => (
                      <PhoneScoreCard
                        key={m.id} m={m} players={state.players}
                        onScore={setScore}
                        draft={drafts[m.id] ?? null}
                        onDraft={setDraft}
                      />
                    ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, online, queued, configStale, name }: {
  children: React.ReactNode; online: boolean; queued: number; configStale: boolean; name: string;
}) {
  const [hideConfigNote, setHideConfigNote] = useState(false);
  return (
    <div className="min-h-screen bg-[#060b26] text-white antialiased">
      <header className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-black">{name}</div>
          <div className="text-[10px] text-white/40">Score entry</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {queued > 0 && <span className="rounded-lg bg-amber-300/20 px-2 py-1 text-[10px] font-bold text-amber-200">{queued} queued</span>}
          <span className={`flex items-center gap-1 text-[10px] font-bold ${online ? "text-emerald-300" : "text-red-300"}`}>
            <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"}`} />
            {online ? "live" : "offline"}
          </span>
        </div>
      </header>
      {configStale && !hideConfigNote && (
        <div
          onClick={() => setHideConfigNote(true)}
          className="bg-amber-300/10 px-4 py-1.5 text-center text-[10px] text-amber-200/80"
        >
          Settings changed on the host but not yet rebuilt — ask the organiser. (tap to dismiss)
        </div>
      )}
      {children}
      <footer className="px-4 py-8 text-center text-[10px] text-white/25">
        Every score updates the projector for everyone.
        <Link href="/screen" className="ml-2 underline">Projection site</Link>
      </footer>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="px-6 py-24 text-center text-sm text-white/50">{children}</div>;
}
