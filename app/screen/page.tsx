"use client";
// /screen — the projection site. Separate SCREEN_PIN so you can hand the
// projector its own code without exposing draw/reset control.

import { usePin } from "@/lib/pin";
import PinGate, { CheckingAccess, usePinConfigured } from "@/components/PinGate";
import ScreenPlaylist from "@/components/ScreenPlaylist";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function ScreenPage() {
  const flags = usePinConfigured();
  const { pin, save, ready } = usePin("screen");

  // Checked against a dedicated endpoint — the screen code must never be able
  // to authorise control actions (no draws, no resets).
  const verify = async (v: string) => {
    try {
      const res = await fetch("/api/screen-auth", {
        method: "POST",
        headers: { "x-screen-pin": v },
      });
      const j = await res.json();
      if (j?.ok) { save(v); return true; }
      return false;
    } catch {
      return false;
    }
  };

  if (!flags || !ready) return <CheckingAccess />;

  if (flags.screenPinSet && pin === null)
    return <PinGate kind="screen" title="Projection" subtitle="Projector display" onUnlock={verify} />;

  return (
    <ErrorBoundary>
      <ScreenPlaylist />
    </ErrorBoundary>
  );
}
