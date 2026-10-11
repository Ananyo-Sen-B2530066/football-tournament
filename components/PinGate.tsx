"use client";
import { FormEvent, useEffect, useState } from "react";

/**
 * Code entry form for /owner and /screen.
 *
 * Deliberately does NOT take `children`: whether the protected page should be
 * shown depends on whether a code is stored, which only the page knows (it owns
 * the usePin hook). The page decides, this just asks and reports.
 */
export default function PinGate({
  kind, title, subtitle, onUnlock,
}: {
  kind: "owner" | "screen";
  title: string;
  subtitle?: string;
  onUnlock: (pin: string) => Promise<boolean>;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!val.trim() || busy) return;
    setBusy(true);
    setErr("");
    const ok = await onUnlock(val.trim());
    // on success the page re-renders into the real UI, so leave it alone
    if (!ok) setErr("Wrong code.");
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060b26] p-6">
      <form onSubmit={submit} className="w-full max-w-xs rounded-3xl bg-white/5 p-7 text-center ring-1 ring-white/10">
        <div className="text-4xl">{kind === "owner" ? "🎛" : "📺"}</div>
        <h1 className="mt-3 text-xl font-black">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-white/50">{subtitle}</p>}
        <input
          autoFocus type="password" inputMode="numeric" value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Enter code"
          className="mt-5 w-full rounded-2xl bg-black/40 p-4 text-center text-2xl tracking-[0.5em] outline-none ring-1 ring-white/10 focus:ring-cyan-400"
        />
        {err && <div className="mt-2 text-sm font-bold text-red-300">{err}</div>}
        <button
          type="submit" disabled={busy || !val.trim()}
          className="mt-4 w-full rounded-2xl bg-cyan-400 py-3 font-black text-black disabled:opacity-40"
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

/** Neutral state while we find out whether a code is required at all. */
export function CheckingAccess() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060b26] p-10 text-white/50">
      Checking access…
    </div>
  );
}

/** Tells the UI which codes are configured, so it can skip the form entirely. */
export function usePinConfigured() {
  const [flags, setFlags] = useState<{ ownerPinSet: boolean; screenPinSet: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive) setFlags(j); })
      .catch(() => { if (alive) setFlags({ ownerPinSet: true, screenPinSet: true }); });
    return () => { alive = false; };
  }, []);
  return flags;
}
