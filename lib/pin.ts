"use client";
// Owner/screen PIN handling. The value lives in sessionStorage (cleared when
// the tab closes) and is sent as a header — the SERVER is what enforces it,
// so a wrong or missing PIN fails every privileged call regardless of the UI.

import { useCallback, useEffect, useState } from "react";

export type PinKind = "owner" | "screen";

export function usePin(kind: PinKind) {
  const key = `techfest2027-pin-${kind}`;
  const [pin, setPin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { setPin(sessionStorage.getItem(key)); } catch {}
    setReady(true);
  }, [key]);

  const save = useCallback((v: string) => {
    try { sessionStorage.setItem(key, v); } catch {}
    setPin(v);
  }, [key]);

  const clear = useCallback(() => {
    try { sessionStorage.removeItem(key); } catch {}
    setPin(null);
  }, [key]);

  return { pin, save, clear, unlocked: pin !== null, ready };
}

/** POST to /api/control with the owner PIN attached. */
export async function control(pin: string | null, body: any) {
  try {
    const res = await fetch("/api/control", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(pin ? { "x-owner-pin": pin } : {}),
      },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}) as any);
    return { ok: res.ok && j.ok !== false, error: j.error as string | undefined, state: j.state, status: res.status };
  } catch (e: any) {
    return { ok: false, error: `Network error: ${e.message}`, state: undefined, status: 0 };
  }
}
