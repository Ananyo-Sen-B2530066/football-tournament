// Client side of the config-staleness warning.
//
// /api/config is unauthenticated, so it only ever returns the boolean
// `configStale` to everyone; the per-key diffs come back only with the owner
// code. That split is what lets /owner show "which setting moved" while / and
// the phones show a one-liner to anyone on the LAN.

"use client";

import { useCallback, useEffect, useState } from "react";

export interface ConfigDiff {
  key: string;
  built: string;
  onDisk: string;
}

export interface ConfigHealth {
  stale: boolean;
  readable?: boolean;
  diffs: ConfigDiff[];
}

const EMPTY: ConfigHealth = { stale: false, diffs: [] };

/** Polls slowly — a stale build does not become fresh on its own. */
export function useConfigHealth(pin: string | null, ms = 15000): ConfigHealth {
  const [health, setHealth] = useState<ConfigHealth>(EMPTY);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config", {
        cache: "no-store",
        headers: pin ? { "x-owner-pin": pin } : {},
      });
      if (!res.ok) return;
      const b = await res.json();
      setHealth({
        stale: !!b.configStale,
        readable: b.configReadable,
        diffs: Array.isArray(b.configDiffs) ? b.configDiffs : [],
      });
    } catch {
      /* offline — stay quiet, the next tick retries */
    }
  }, [pin]);

  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);

  return health;
}
