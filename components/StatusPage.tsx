"use client";
// Full-screen status cards for the projection site. These are the states where
// there is nothing to show yet, so the projector never displays a stale or
// half-built bracket.

export default function StatusPage({
  kind, big = true,
}: { kind: "not-prepared" | "group-running" | "group-complete" | "awaiting-sf"; big?: boolean }) {
  const map = {
    "not-prepared": {
      icon: "🎲",
      title: "FIXTURES NOT PREPARED",
      sub: "The group stage draw has not been run yet.",
      tone: "text-cyan-300",
      ring: "ring-cyan-300/30",
    },
    "group-running": {
      icon: "⚽",
      title: "GROUP STAGE RUNNING",
      sub: "Knockout bracket opens once every group tie is decided.",
      tone: "text-amber-300",
      ring: "ring-amber-300/30",
    },
    "group-complete": {
      icon: "✅",
      title: "GROUP STAGE COMPLETE",
      sub: "Waiting for the knockout draw.",
      tone: "text-emerald-300",
      ring: "ring-emerald-300/30",
    },
    "awaiting-sf": {
      icon: "⏳",
      title: "AWAITING SEMI-FINAL DRAW",
      sub: "Quarter-finals done — the SF draw comes next.",
      tone: "text-amber-300",
      ring: "ring-amber-300/30",
    },
  } as const;
  const c = map[kind];
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className={`text-[clamp(4rem,14vw,9rem)] ${c.tone} tf-breathe`}>{c.icon}</div>
      <h1 className={`mt-4 font-black tracking-[0.12em] ${c.tone} ${big ? "text-[clamp(1.6rem,5vw,4rem)]" : "text-3xl"}`}>
        {c.title}
      </h1>
      <p className="mt-3 max-w-xl text-[clamp(.9rem,1.6vw,1.4rem)] text-white/60">{c.sub}</p>
      <style>{`.tf-breathe{animation:tfb 3.2s ease-in-out infinite}@keyframes tfb{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}`}</style>
    </div>
  );
}
