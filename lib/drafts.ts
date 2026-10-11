"use client";
// ============================================================
// Unconfirmed scores, kept on the phone.
// ------------------------------------------------------------
// Scoring happens on volunteers' personal devices at a live event,
// where the OS will happily evict a backgrounded tab. So a score that
// has been tapped in but not yet confirmed is written to localStorage
// and restored on return — it is shown as PENDING, never applied
// silently.
//
// A draft is removed the moment its score is confirmed, so a recorded
// result can never be re-edited behind the user's back.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Match } from "./types";
import { pruneDrafts } from "./scoreFlow";
import type { ScoreDraftValue } from "./scoreFlow";

export { pruneDrafts };
export type ScoreDraft = ScoreDraftValue;

const KEY = "techfest2027-drafts-v1";

export type DraftMap = Record<string, ScoreDraft>;

function readStorage(): DraftMap {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as DraftMap) : {};
  } catch {
    return {};
  }
}

function writeStorage(d: DraftMap) {
  try {
    if (Object.keys(d).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}

/**
 * Owns the draft map for a page. Persist on every change; re-prune on mount
 * and whenever the SET OF MATCHES changes (a redraw or reset) — deliberately
 * not on every poll, which would wipe the draft you are editing right now.
 *
 * `ready` must only be true once the tournament state has actually loaded.
 * Pruning against an empty match list would throw away every stored draft, so
 * the first load is deferred until the fixtures are known.
 */
export function useDrafts(matches: Match[], ready: boolean) {
  const [drafts, setDrafts] = useState<DraftMap>({});
  const loaded = useRef(false);
  const sig = useMemo(() => matches.map((m) => m.id).sort().join(","), [matches]);

  // initial load + prune — only once the fixtures are known
  useEffect(() => {
    if (!ready || loaded.current) return;
    loaded.current = true;
    setDrafts(pruneDrafts(readStorage(), matches));
  }, [ready, matches]);

  // re-prune when the fixture set itself changes (redraw / reset)
  useEffect(() => {
    if (!ready) return;
    setDrafts((prev) => pruneDrafts(prev, matches));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sig]);

  // persist
  useEffect(() => {
    if (!loaded.current) return;
    writeStorage(drafts);
  }, [drafts]);

  const setDraft = useCallback((id: string, d: ScoreDraft | null) => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (d === null) delete next[id];
      else next[id] = d;
      return next;
    });
  }, []);

  return { drafts, setDraft };
}
