/** Single assertion helper. Defined first so every block below can use it. */
const check = (label, cond, extra = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`); process.exitCode = 1; }
};

// ============================================================
// GROUP DRAW + BRACKET — tested against the REAL lib/draw.ts
// ------------------------------------------------------------
// This block used to be a hand-written "plain JS mirror" of
// draw.ts: a second implementation of shuffle/buildRound/
// drawKnockout/buildNext/propagate living inside the test file. It
// tested a COPY, so the copy could drift from the shipped engine
// and still pass — and the bracket wiring (the thing that decides
// who actually meets whom on the night) was precisely the part
// with no coverage of the real code.
//
// draw.ts now has no runtime imports: `mid` moved into it, so the
// only ./types import is type-only and gets erased by Node's
// type-stripping loader. The real engine is therefore loaded here.
// ============================================================

const D = await import("../lib/draw.ts");
const {
  assignPots, leagueModeOf,
  drawLeague, verifyLeague, verifyMatchdays,
  drawTwoPot, verifyTwoPot,
  drawFlexLeague, verifyFlexLeague,
  drawKnockoutRound, buildFixedNextRound, randomPairing, mid,
  isPlaceholder, hasUnresolvedPlaceholders, matchWinner, propagateWinners,
} = D;

const mkPlayers = (n, pots) => assignPots(Array.from({ length: n }, (_, i) => `P${i + 1}`), pots);
const flat = (errs) => (errs.length ? `\n      ${errs.join("\n      ")}` : "");

// ---- UCL / multi-pot: the real draw, checked by the real validators ----
// Mirrors the dispatch in app/owner/page.tsx exactly: each mode is validated by
// its OWN verifier only. verifyMatchdays assumes the UCL shape (pots-1
// matchdays), so pairing it with a 2-pot draw reports a false "expected 1
// matchdays, got 2" - 2-pot legitimately has 2 matchdays and verifyTwoPot
// already checks that itself.
for (const [n, pots] of [[16, 4], [12, 4], [12, 3], [8, 2], [6, 3], [20, 5], [10, 2]]) {
  const players = mkPlayers(n, pots);
  const mode = leagueModeOf(players);
  let matches, errs;
  if (mode === "single") { matches = drawFlexLeague(players, 2); errs = verifyFlexLeague(players, matches, 2); }
  else if (mode === "twoPot") { matches = drawTwoPot(players); errs = verifyTwoPot(players, matches); }
  else { matches = drawLeague(players); errs = [...verifyLeague(players, matches), ...verifyMatchdays(players, matches)]; }
  check(`${mode} N=${n} P=${pots}: REAL draw passes its own verifier`, errs.length === 0, flat(errs));
}
check("verifyMatchdays is never paired with a 2-pot draw (it would false-alarm)",
  mkPlayers(8, 2) && verifyMatchdays(mkPlayers(8, 2), drawTwoPot(mkPlayers(8, 2))).length > 0);
console.log("[draw] UCL + 2-pot: REAL drawLeague/drawTwoPot pass REAL verifyLeague/verifyTwoPot/verifyMatchdays");

// ---- 1-pot flexible: the real circle-method draw ----
for (const [N, K] of [[16, 4], [7, 4], [8, 3], [9, 2], [6, 2], [12, 3]]) {
  const players = mkPlayers(N, 1);
  const matches = drawFlexLeague(players, K);
  const errs = verifyFlexLeague(players, matches, K);
  check(`flex N=${N} K=${K}: REAL drawFlexLeague passes verifyFlexLeague`, errs.length === 0, flat(errs));
  check(`flex N=${N} K=${K}: reads as single-pot`, leagueModeOf(players) === "single");
}
console.log("[draw] 1-pot flex: REAL drawFlexLeague passes REAL verifyFlexLeague (even and odd N)");

// ---- Top-8 bracket: QF drawn, then SF and FINAL fixed ----
{
  const ids = Array.from({ length: 8 }, (_, i) => `p-${i + 1}`);
  const qf = drawKnockoutRound(ids, "qf");
  const sf = buildFixedNextRound(qf.map((m) => m.id), "sf");
  const fin = buildFixedNextRound(sf.map((m) => m.id), "final");
  check("Top-8: 4 QFs", qf.length === 4);
  check("Top-8: 2 SFs, both feeding from the QFs",
    sf.length === 2 && sf.every((m) => m.feedsFrom[0].startsWith("QF-") && m.feedsFrom[1].startsWith("QF-")));
  // The QF -> SF feeding is drawn too (3 possible schemes), so assert the rule
  // structurally: two DISTINCT QF feeders per SF, all four QFs used exactly once.
  const sfFeeders = sf.flatMap((m) => m.feedsFrom);
  check("Top-8: each SF feeds from two DISTINCT QFs",
    sf.every((m) => m.feedsFrom[0] !== m.feedsFrom[1]));
  check("Top-8: all 4 QFs feed exactly one SF",
    new Set(sfFeeders).size === 4 && sfFeeders.every((f) => qf.some((q) => q.id === f)),
    sfFeeders.join(","));
  check("Top-8: FINAL feeds SF-01 and SF-02", fin[0].feedsFrom[0] === "SF-01" && fin[0].feedsFrom[1] === "SF-02");
  check("Top-8: FINAL sides are W(SF-01)/W(SF-02)", fin[0].playerA === "W(SF-01)" && fin[0].playerB === "W(SF-02)");
  check("Top-8: FINAL never shows W(QF-*)", !fin[0].playerA.includes("QF-") && !fin[0].playerB.includes("QF-"));
  check("Top-8: ids come from the real mid()", mid("qf", 3) === "QF-03" && mid("final", 1) === "FINAL-01");
}
console.log("[bracket] Top-8: QF drawn, SF feeding drawn from the QF winners, Final = W(SF-01) vs W(SF-02)");

// ---- the feeding of one round into the next is DRAWN, not pre-arranged ----
// Pairing 8 R16 ties into 4 QF ties has 7x5x3x1 = 105 possible schemes; the app
// picks ONE at random so the quarter-final pairings are decided live in the same
// ceremony as the R16 draw, instead of the old sequential
// W(R16-01) v W(R16-02), W(R16-03) v W(R16-04), ...
{
  const R16 = Array.from({ length: 8 }, (_, i) => `R16-0${i + 1}`);
  const canon = (pairs) =>
    JSON.stringify(pairs.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]));

  // --- structural rules that must hold for EVERY draw ---
  for (let attempt = 0; attempt < 60; attempt++) {
    const qf = buildFixedNextRound(R16, "qf");
    const feeders = qf.flatMap((m) => [m.playerA, m.playerB]);
    const ids = feeders.map((w) => w.replace(/^W\(|\)$/g, ""));
    if (new Set(ids).size !== 8) { check("each R16 feeds exactly one QF", false, ids.join(",")); break; }
    if (ids.some((x) => !R16.includes(x))) { check("QFs only name R16 feeders", false, ids.join(",")); break; }
    if (qf.some((m) => m.playerA === m.playerB)) { check("no QF ties a feeder to itself", false); break; }
    if (qf.length !== 4) { check("4 QFs", false, String(qf.length)); break; }
    if (attempt === 59) {
      check("every QF names two DISTINCT R16 feeders (60 draws)", true);
      check("all 8 R16 feeders used exactly once (60 draws)", true);
      check("no QF ever ties a feeder to itself (60 draws)", true);
    }
  }

  // --- how many distinct schemes are reachable? ---
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(canon(randomPairing(8)));
  check("n=8 has exactly 105 reachable pairings", seen.size === 105, `saw ${seen.size}`);
  const seen4 = new Set();
  for (let i = 0; i < 2000; i++) seen4.add(canon(randomPairing(4)));
  check("n=4 has exactly 3 reachable pairings", seen4.size === 3, `saw ${seen4.size}`);
  const seen2 = new Set();
  for (let i = 0; i < 200; i++) seen2.add(canon(randomPairing(2)));
  check("n=2 has exactly 1 pairing, so the Final stays fixed", seen2.size === 1, `saw ${seen2.size}`);

  check("randomPairing(8) always returns 4 pairs covering all 8 indices", (() => {
    for (let i = 0; i < 500; i++) {
      const p = randomPairing(8);
      if (p.length !== 4) return false;
      const flat = p.flat();
      if (new Set(flat).size !== 8) return false;
      if (p.some(([a, b]) => a === b)) return false;
      if (p.some(([a, b]) => a >= 8 || b >= 8)) return false;
    }
    return true;
  })());
  check("randomPairing rejects an odd feeder count", (() => {
    try { randomPairing(7); return false; } catch { return true; }
  })());

  // --- inject a rand() to force a specific scheme ---
  // rand() is consumed once per pair, so a constant pins the partner choice:
  // rand=0 always takes the first remaining partner (the sequential scheme),
  // rand~1 always takes the last (a fully crossed scheme).
  const firstPick = randomPairing(8, () => 0);
  check("forced rand=0 picks the first partner -> the sequential scheme",
    JSON.stringify(firstPick) === JSON.stringify([[0, 1], [2, 3], [4, 5], [6, 7]]),
    JSON.stringify(firstPick));
  const lastPick = randomPairing(8, () => 0.999999);
  check("forced rand~1 picks the last partner -> a fully crossed scheme",
    JSON.stringify(lastPick) === JSON.stringify([[0, 7], [1, 6], [2, 5], [3, 4]]),
    JSON.stringify(lastPick));
  const forcedQf = buildFixedNextRound(R16, "qf", [[5, 0], [3, 2], [7, 4], [1, 6]]);
  check("an explicit pairing is honoured exactly (QF-01 = Winner R16-06 v Winner R16-01)",
    forcedQf[0].playerA === "W(R16-06)" && forcedQf[0].playerB === "W(R16-01)",
    `${forcedQf[0].playerA} v ${forcedQf[0].playerB}`);
  check("the explicit pairing is recorded in feedsFrom",
    JSON.stringify(forcedQf[0].feedsFrom) === JSON.stringify(["R16-06", "R16-01"]));
  check("buildFixedNextRound rejects a wrong-sized pairing", (() => {
    try { buildFixedNextRound(R16, "qf", [[0, 1]]); return false; } catch { return true; }
  })());

  // --- and the app is not stuck on the sequential scheme ---
  const schemes = new Set();
  for (let i = 0; i < 400; i++) schemes.add(buildFixedNextRound(R16, "qf").map((m) => m.playerA + m.playerB).join("|"));
  check("the app really produces MANY different QF schemes", schemes.size > 20, `only ${schemes.size}`);
  check("the sequential-only scheme is just one of many",
    schemes.has("W(R16-01)W(R16-02)|W(R16-03)W(R16-04)|W(R16-05)W(R16-06)|W(R16-07)W(R16-08)"));
}
console.log("[bracket] feeding is DRAWN: 105 R16->QF schemes, 3 QF->SF, 1 SF->Final;");
console.log("[bracket] every QF pairs two distinct feeders, all 8 R16 used exactly once");

// ---- Top-16 second draw: SF drawn from QF winners (deliberately live), FINAL fixed ----
{
  const qfWinners = ["p-1", "p-2", "p-3", "p-4"];
  const sf = drawKnockoutRound(qfWinners, "sf");
  const fin = buildFixedNextRound(sf.map((m) => m.id), "final");
  check("Top-16 draw #2: 2 SFs built from the 4 QF winners",
    sf.length === 2 && sf.flatMap((m) => [m.playerA, m.playerB]).every((x) => qfWinners.includes(x)));
  check("Top-16 draw #2: FINAL feeds SF-01/SF-02", fin[0].feedsFrom[0] === "SF-01" && fin[0].feedsFrom[1] === "SF-02");
  check("Top-16 draw #2: FINAL sides are W(SF-01)/W(SF-02)", fin[0].playerA === "W(SF-01)" && fin[0].playerB === "W(SF-02)");
}
console.log("[bracket] Top-16 draw #2: SF drawn from QF winners (a live draw on purpose), FINAL fixed");

// ---- winner propagation: the REAL propagateWinners, for regular wins AND pens ----
{
  const played = (m, a, b, extra = {}) => ({ ...m, scoreA: a, scoreB: b, played: true, ...extra });
  const ids = Array.from({ length: 8 }, (_, i) => `p-${i + 1}`);
  const qf = drawKnockoutRound(ids, "qf");
  const sf = buildFixedNextRound(qf.map((m) => m.id), "sf");
  const fin = buildFixedNextRound(sf.map((m) => m.id), "final");

  const qfDone = qf.map((m, i) => played(m, 2, i % 2));
  const afterQf = propagateWinners([...qfDone, ...sf, ...fin]);
  const sfRes = afterQf.filter((m) => m.stage === "sf");
  check("propagate: SF resolved to real players once the QFs are won",
    !sfRes.some((m) => isPlaceholder(m.playerA) || isPlaceholder(m.playerB)));
  // The QF -> SF feeding is drawn, so resolve from each SF's OWN feedsFrom
  // rather than assuming SF-01 = QF-01 v QF-02.
  const qfWin = new Map(qfDone.map((m) => [m.id, matchWinner(m)]));
  check("propagate: each SF resolved from its OWN drawn QF feeders",
    sfRes.every((m) => m.playerA === qfWin.get(m.feedsFrom[0]) && m.playerB === qfWin.get(m.feedsFrom[1])),
    sfRes.map((m) => `${m.playerA} v ${m.playerB}`).join(" | "));
  const finMid = afterQf.find((m) => m.stage === "final");
  check("propagate: FINAL still shows W(SF-*) before the SFs are won",
    finMid.playerA === "W(SF-01)" && finMid.playerB === "W(SF-02)");

  // regular SF wins must propagate (this used to work only for pens)
  const sfDone = sfRes.map((m, i) => played(m, i === 0 ? 3 : 1, i === 0 ? 1 : 2));
  const afterSf = propagateWinners([...qfDone, ...sfDone, ...fin]);
  const finReg = afterSf.find((m) => m.stage === "final");
  check("propagate: FINAL resolved after REGULAR SF wins", !hasUnresolvedPlaceholders([finReg]));
  check("propagate: FINAL sides are the real SF winners",
    finReg.playerA === matchWinner(sfDone[0]) && finReg.playerB === matchWinner(sfDone[1]));
  check("propagate: FINAL never regresses to W(QF-*)",
    !finReg.playerA.includes("QF-") && !finReg.playerB.includes("QF-"));

  // pens SF wins must propagate too
  const sfPens = sfRes.map((m, i) => played(m, 1, 1, { penaltyWinner: i === 0 ? m.playerA : m.playerB }));
  const afterPens = propagateWinners([...qfDone, ...sfPens, ...fin]);
  const finPens = afterPens.find((m) => m.stage === "final");
  check("propagate: FINAL resolved after PENS SF wins", !hasUnresolvedPlaceholders([finPens]));
  check("propagate: pens FINAL sides are the shootout winners",
    finPens.playerA === sfPens[0].penaltyWinner && finPens.playerB === sfPens[1].penaltyWinner);

  // Top-16: R16 winners must fill the fixed QF placeholders, in order
  const r16 = drawKnockoutRound(Array.from({ length: 16 }, (_, i) => `p-${i + 1}`), "r16");
  const qf2 = buildFixedNextRound(r16.map((m) => m.id), "qf");
  const r16Done = r16.map((m) => played(m, 3, 1));
  const afterR16 = propagateWinners([...r16Done, ...qf2]);
  // propagateWinners returns matches in INPUT order, so select by stage rather
  // than by index — the R16 rows come first.
  const qfRes = afterR16.filter((m) => m.stage === "qf");
  // Each QF must resolve from the feeders IT was given, not from position 0/1.
  // Pin a deliberately crossed scheme so a positional implementation fails.
  const idx = new Map(r16.map((m, i) => [m.id, i]));
  const winnersByIdx = r16Done.map(matchWinner);
  check("propagate: each QF filled from its OWN drawn feeders, not by position",
    qfRes.every((m) => {
      const [fa, fb] = m.feedsFrom;
      return m.playerA === winnersByIdx[idx.get(fa)] && m.playerB === winnersByIdx[idx.get(fb)];
    }),
    qfRes.map((m) => `${m.playerA} v ${m.playerB}`).join(" | "));
  check("propagate: a QF crossed over two R16 feeders resolves correctly",
    (() => {
      const crossed = buildFixedNextRound(r16.map((m) => m.id), "qf", [[7, 0], [1, 6], [3, 2], [5, 4]]);
      const res = propagateWinners([...r16Done, ...crossed]).filter((m) => m.stage === "qf");
      return res[0].playerA === winnersByIdx[7] && res[0].playerB === winnersByIdx[0];
    })());
  check("propagate: no QF placeholder left once every R16 tie is won",
    !qfRes.some((m) => hasUnresolvedPlaceholders([m])));
}
console.log("[propagate] REAL propagateWinners: the QF->SF->FINAL chain resolves for regular AND pens wins,");
console.log("[propagate] and Top-16 R16 winners fill the fixed QF pairs in order");

// ---- external tie resolution replay ----
// NOTE: this is STILL a mirror. lib/table.ts imports POINTS_WIN / POINTS_DRAW
// from the config as runtime values, so Node cannot load it and the real cut-tie
// helpers remain untested against the real code. Closing that needs the same
// treatment draw.ts just received.
function slotsForTie(table, tied, q) {
  return Math.max(0, q - table.indexOf(tied[0]));
}
function resolveExternal(table, tied, sel, q) {
  const pool = new Set(tied);
  const uniq = [...new Set(sel)];
  const slots = slotsForTie(table, tied, q);
  if (uniq.length !== slots) return { ok: false, error: `need ${slots}, got ${uniq.length}` };
  if (uniq.some((id) => !pool.has(id))) return { ok: false, error: "out-of-pool" };
  const keep = table.filter((r) => !pool.has(r)).slice(0, q - slots);
  const ordered = table.filter((r) => keep.includes(r) || uniq.includes(r));
  if (ordered.length !== q) return { ok: false, error: "count" };
  return { ok: true, ids: ordered };
}
// 15/16/17 tied (rows 15-17), Top 16 → 2 slots
const table16 = Array.from({ length: 20 }, (_, i) => `p-${i + 1}`);
const tied3 = ["p-15", "p-16", "p-17"];
let r = resolveExternal(table16, tied3, ["p-15", "p-17"], 16); // 15 beats 17, then 17 beats 16
if (!r.ok || r.ids.length !== 16 || !r.ids.includes("p-15") || !r.ids.includes("p-17") || r.ids.includes("p-16")) {
  console.log("EXTERNAL RESOLVE FAIL (15/17 qualify)"); process.exitCode = 1;
} else console.log("EXTERNAL RESOLVE OK: {15,17} qualify, exactly 16, 16 out");
r = resolveExternal(table16, tied3, ["p-15"], 16);
if (r.ok) { console.log("EXTERNAL FAIL: short pick accepted"); process.exitCode = 1; }
r = resolveExternal(table16, tied3, ["p-15", "p-18"], 16);
if (r.ok) { console.log("EXTERNAL FAIL: out-of-pool accepted"); process.exitCode = 1; }
else console.log("EXTERNAL GUARDS OK: short + out-of-pool picks rejected");


// ============================================================
// From here on we import the REAL modules (Node strips the types),
// so these tests cannot drift away from the implementation.
// ============================================================

import { readFileSync } from "node:fs";

const { resolvePages, planScreen, isPageId, pageLabel } = await import("../lib/screenPlaylist.ts");
const { needsAction, isResolved, commitBlocker, isLocked, pruneDrafts } = await import("../lib/scoreFlow.ts");
const { buildRoster, safeId, normalizePhotoUrl } = await import("../lib/roster.ts");
const { readXlsx, pickRosterSheet } = await import("../lib/server/xlsx.ts");
const { tournamentStats, creditBoard, podium, tournamentFinished, CREDIT_KEYS } = await import("../lib/stats.ts");
const { diffConfig, extractInitialiser, configStaleness, stripComments } = await import("../lib/server/configStaleness.ts");
const { cleanTournamentName } = await import("../lib/nameRules.ts");
const REAL_CFG = await import("../config/tournament.config.ts");



// ---- projection page selection ----
{
  const ctx = (o = {}) => ({ matchdays: [1, 2, 3], hasTable: true, knockout: false, ...o });
  const p = (ticked, c) => JSON.stringify(resolvePages(ticked, c).pages);
  check("group: ticked matchdays then table, in order", p(["md2", "md1", "table"], ctx()) === '["md1","md2","table"]', p(["md2","md1","table"], ctx()));
  check("group: unticked matchday omitted", p(["md3", "table"], ctx()) === '["md3","table"]');
  check("group: stale matchday dropped", p(["md9", "table"], ctx()) === '["table"]', p(["md9","table"], ctx()));
  check("group: junk keys ignored", p(["md1", "../../etc/passwd", "zzz", 42, null, "table"], ctx()) === '["md1","table"]', p(["md1","../../etc/passwd","zzz",42,null,"table"], ctx()));
  check("group: duplicates deduped", p(["md1", "md1", "table"], ctx()) === '["md1","table"]');
  check("group: nothing ticked -> table fallback", JSON.stringify(resolvePages([], ctx())) === '{"pages":["table"],"fallback":true}', JSON.stringify(resolvePages([], ctx())));
  check("group: no table available + nothing ticked -> nothing", JSON.stringify(resolvePages([], ctx({ hasTable: false }))) === '{"pages":[],"fallback":true}');
  check("knockout: bracket only, matchday ticks ignored", p(["md1", "md2"], ctx({ knockout: true })) === '["knockout"]');
  check("knockout: table opt-in adds it", p(["table"], ctx({ knockout: true })) === '["knockout","table"]');
  check("page ids are whitelisted", isPageId("md3") && isPageId("table") && !isPageId("knockout") && !isPageId("../x") && !isPageId(7));
  check("page labels are human", pageLabel("md3") === "Matchday 3" && pageLabel("table") === "Point Table" && pageLabel("knockout") === "Knockout");
}
console.log("[project] page selection: order, stale + junk filtering, dedupe, table fallback, knockout override");

// ---- state machine priorities ----
{
  const base = {
    hasPendingDraw: false, leagueCount: 8, knockoutCount: 0, qualifiers: 8,
    sfDrawDone: false, leagueDone: false, matchdays: [1, 2], projection: { pages: ["md1", "table"], rotate: true },
  };
  const k = (i) => planScreen(i).kind;
  check("nothing drawn -> not-prepared", k({ ...base, leagueCount: 0, knockoutCount: 0 }) === "not-prepared");
  check("a pending draw beats everything", k({ ...base, hasPendingDraw: true, knockoutCount: 4 }) === "ceremony");
  check("knockout exists -> rotate around the bracket", k({ ...base, knockoutCount: 4 }) === "rotate");
  check("top16 before the SF draw no longer has its own card", k({ ...base, knockoutCount: 8, qualifiers: 16, sfDrawDone: false }) === "rotate");
  const rot = planScreen({ ...base, knockoutCount: 4, projection: { pages: [], rotate: true } });
  check("bracket-only is a single page", JSON.stringify(rot) === '{"kind":"rotate","pages":["knockout"],"fallback":false}');
  // the table is always available once a league exists, so "status" is now
  // only a defensive fallback — the important part is it is never reached here
  check("group stage with no matchdays still shows the table, not a status card", k({ ...base, matchdays: [], projection: { pages: [], rotate: true } }) === "rotate");
  check("...and the status branch only fires with no table either", planScreen({ ...base, matchdays: [], projection: { pages: [], rotate: true } }).kind !== "status");
}
console.log("[project] state machine: ceremony > not-prepared > rotate > status, awaiting-sf folded into the bracket");

// ---- what still needs a human (To score rules) ----
{
  const L = (o = {}) => ({ id: "x", stage: "league", playerA: "p-1", playerB: "p-2", scoreA: null, scoreB: null, played: false, ...o });
  const K = (o = {}) => L({ stage: "qf", ...o });
  check("unscored needs action", needsAction(L()) && needsAction(K()));
  check("scored league is resolved", isResolved(L({ played: true, scoreA: 2, scoreB: 1 })));
  check("level league leaves the queue", !needsAction(L({ played: true, scoreA: 1, scoreB: 1 })) && isResolved(L({ played: true, scoreA: 1, scoreB: 1 })));
  check("level KO without winner stays queued", needsAction(K({ played: true, scoreA: 1, scoreB: 1 })));
  check("level KO with winner is resolved", isResolved(K({ played: true, scoreA: 1, scoreB: 1, penaltyWinner: "p-1" })));
  check("locked tie is inert", isLocked(L({ playerA: "W(QF-01)" })) && !needsAction(L({ playerA: "W(QF-01)" })));
  check("commit blocked on a blank side", commitBlocker(K(), null, 1, null) === "set both scores");
  check("commit blocked on a level KO", commitBlocker(K(), 1, 1, null) === "pick a winner");
  check("level league may commit", commitBlocker(L(), 1, 1, null) === null);
}
console.log("[flow] To score = unscored + level-KO-awaiting-winner; league draws final; commit gating");

// ---- draft pruning ----
{
  const m = (id, o = {}) => ({ id, stage: "league", playerA: "p-1", playerB: "p-2", scoreA: null, scoreB: null, played: false, ...o });
  const matches = [m("MD1-01"), m("MD1-02", { played: true, scoreA: 2, scoreB: 1 }), { ...m("QF-01", { stage: "qf" }) }];
  const kept = pruneDrafts({
    "MD1-01": { a: 1, b: 0, winner: null }, "MD1-02": { a: 5, b: 5, winner: null },
    "QF-01": { a: 2, b: 2, winner: "p-1" }, "GONE-99": { a: 1, b: 1, winner: null },
  }, matches);
  check("keeps pending edits", Object.keys(kept).sort().join(",") === "MD1-01,QF-01", Object.keys(kept).join(","));
  check("drops a draft identical to the record", Object.keys(pruneDrafts({ "MD1-01": { a: null, b: null, winner: null } }, [m("MD1-01")])).length === 0);
}
console.log("[drafts] prunes resolved + vanished matches + no-op drafts");

// ---- roster import: column aliases, gamer_id, warnings ----
{
  const table = (headers, rows) => ({ headers, rows });
  const r1 = buildRoster(table(
    ["Photo", "NAME", "Gamer ID", "Pot No."],
    [[null, "Arjun", "ARJUN01", 1], [null, "Bhavya", "BHAVYA02", 2], [null, "Chirag", "CHIRAG03", 3]]
  ));
  check("flexible headers (Photo / NAME / Gamer ID / Pot No.)", r1.players.length === 3 && r1.errors.length === 0, r1.errors.join(";"));
  check("gamer_id becomes the player id", r1.players.map((p) => p.id).join(",") === "ARJUN01,BHAVYA02,CHIRAG03");
  check("pots parsed", r1.players.map((p) => p.pot).join(",") === "1,2,3");
  check("missing photo warns once per row", r1.warnings.filter((w) => /no photo/.test(w)).length === 3);

  const r2 = buildRoster(table(["name", "gamer_id", "pot"], [["A", "dup/../id", 1], ["B", "dup/../id", 1]]));
  check("gamer_id sanitised: slashes + dot-runs removed", r2.players[0].id === "dup-id", r2.players[0].id);
  check("gamer_id can never be a path escape", !safeId("../../etc/passwd").includes("..") && safeId("..") === "player", safeId(".."));
  check("duplicate gamer_id disambiguated", r2.players[1].id !== r2.players[0].id && r2.players[1].id.startsWith("dup-id"), r2.players[1].id);
  check("duplicate reported", r2.warnings.some((w) => /duplicate gamer_id/.test(w)));

  const r3 = buildRoster(table(["player", "pot"], [["Solo", 1]]), undefined);
  check("missing gamer_id falls back to p-N with a warning", r3.players[0].id === "p-1" && r3.warnings.some((w) => /gamer_id/.test(w)));
  check("a single player is an error", r3.errors.length > 0, JSON.stringify(r3.errors));

  const r4 = buildRoster(table(["nickname", "pot"], [["x", 1]]));
  check("no recognisable name column is a hard error", r4.errors.length > 0 && /name column/.test(r4.errors[0]));

  const r5 = buildRoster(table(["name", "gamer_id", "pot"], [["A", "a1", 1], ["B", "b1", 1], ["C", "c1", 2]]));
  check("uneven pots warned about", r5.warnings.some((w) => /uneven/.test(w)));

  check("drive share link rewritten", normalizePhotoUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view") === "https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMn&sz=w512");
  check("plain URL untouched", normalizePhotoUrl("https://x.test/a.png") === "https://x.test/a.png");
  check("bare host gets https", normalizePhotoUrl("x.test/a.png") === "https://x.test/a.png");
  check("safeId keeps a normal id intact", safeId("ARJUN01") === "ARJUN01", safeId("ARJUN01"));
}
console.log("[roster] header aliases, gamer_id as id, sanitising, dedupe, warnings, Drive links");

// ---- xlsx reader: real fixture with cell-anchored images ----
{
  const { readFileSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = new URL("../scripts/fixtures/roster.xlsx", import.meta.url);
  if (!existsSync(path)) {
    console.log("[xlsx] SKIP — run: node scripts/make-xlsx-fixture.mjs scripts/fixtures/roster.xlsx");
  } else {
    const buf = readFileSync(path);
    const sheets = readXlsx(buf);
    check("reads the sheet list", sheets.length === 1 && sheets[0].name === "Players", JSON.stringify(sheets.map((s) => s.name)));
    const sheet = pickRosterSheet(sheets);
    check("picks the players sheet", sheet?.name === "Players");
    const hdr = sheet.cells.filter((c) => c.row === 1).sort((a, b) => a.col - b.col).map((c) => c.value);
    check("header row read in order", hdr.join(",") === "photo,name,gamer_id,pot", hdr.join(","));
    const names = sheet.cells.filter((c) => c.col === 2 && c.row > 1).map((c) => c.value);
    check("8 data rows read", names.length === 8, String(names.length));
    check("shared strings resolved", names[0] === "Arjun" && names[7] === "Hina", names.join(","));
    const ids = sheet.cells.filter((c) => c.col === 3 && c.row > 1).map((c) => c.value);
    check("gamer_id column read", ids[0] === "ARJUN01", ids[0]);
    const pots = sheet.cells.filter((c) => c.col === 4 && c.row > 1).map((c) => c.value);
    check("numeric cells read as text", pots.join(",") === "1,1,1,1,1,1,1,1", pots.join(","));
    check("all 8 cell-anchored images found", sheet.images.length === 8, String(sheet.images.length));
    check("images anchored to the right rows", sheet.images.every((im) => im.row >= 2 && im.col === 1));
    check("images are real PNG bytes", sheet.images.every((im) => im.data.length > 8 && im.data.slice(1, 4).toString() === "PNG"));
    check("png extension detected", sheet.images.every((im) => im.ext === "png"));

    // and the whole chain: xlsx -> table -> roster
    const byRow = new Map();
    for (const c of sheet.cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row).push(c); }
    const rowNums = [...byRow.keys()].sort((a, b) => a - b);
    const maxCol = Math.max(...[...byRow.values()].flat().map((c) => c.col));
    const headers = []; for (let c = 1; c <= maxCol; c++) headers.push(byRow.get(1).find((x) => x.col === c)?.value ?? "");
    const rows = [];
    for (const r of rowNums.filter((n) => n > 1)) {
      const line = [];
      for (let c = 1; c <= maxCol; c++) {
        const cell = byRow.get(r).find((x) => x.col === c);
        const img = sheet.images.find((im) => im.row === r && im.col === c);
        line.push(cell ? cell.value : img ? null : "");
      }
      rows.push(line);
    }
    const parsed = buildRoster({ headers, rows }, (row, col) => sheet.images.some((im) => im.row === row && im.col === col));
    check("end-to-end: 8 players from the xlsx", parsed.players.length === 8);
    check("end-to-end: every row counted as having a photo", parsed.rows.every((r) => r.hasImage) && parsed.warnings.length === 0, parsed.warnings.join("; "));
    console.log("[xlsx] real fixture: cells, shared strings, cell-anchored PNGs, end-to-end roster");
  }
}

// ============================================================
// config staleness — the "I edited the file and nothing happened" guard
// ============================================================
{
  const SRC = `
// header comment
export const TOURNAMENT_NAME = "OLD NAME";
export const PLAYERS: string[] = [
  "A", "B",
];
export const POTS: number = 4;
export const QUALIFIERS_COUNT: 8 | 16 = 8;
export const THIRD_PLACE = true;
export const TIEBREAK_MODE = "golden_goal" as const; // trailing comment
export const OWNER_PIN = "1111";   // <-- SET THIS
export const SCREEN_PIN = "";
export const AVATAR_DIR = "/players";
export const PLAYER_IMAGES: Record<string, string> = {
  // nothing
};
export function helper() { return 1; }
`;
  const BUILT = {
    TOURNAMENT_NAME: "OLD NAME",
    PLAYERS: ["A", "B"],
    POTS: 4, QUALIFIERS_COUNT: 8, THIRD_PLACE: true, TIEBREAK_MODE: "golden_goal",
    OWNER_PIN: "1111", SCREEN_PIN: "", AVATAR_DIR: "/players", PLAYER_IMAGES: {},
  };

  // --- the parser copes with the real file's syntax ---
  check("plain string", extractInitialiser(SRC, "TOURNAMENT_NAME") === '"OLD NAME"');
  check(": string[] annotation", extractInitialiser(SRC, "PLAYERS") !== null);
  check("union type annotation", extractInitialiser(SRC, "QUALIFIERS_COUNT") === "8");
  check("as const suffix is tolerated", extractInitialiser(SRC, "TIEBREAK_MODE") === '"golden_goal" as const');
  check("trailing comment is tolerated", extractInitialiser(SRC, "OWNER_PIN") === '"1111"');
  check("export function is not a const", extractInitialiser(SRC, "helper") === null);
  check("absent key returns null", extractInitialiser(SRC, "NOPE") === null);

  // --- no false positives: an untouched config is NOT stale ---
  const same = diffConfig(SRC, BUILT);
  check("identical source is not stale", same.stale === false, JSON.stringify(same.diffs));
  check("identical source has no diffs", same.diffs.length === 0);

  // --- a comment/whitespace-only edit must NOT be reported ---
  const cosmetic = SRC.replace("// header comment", "// header comment\n// another thought")
                      .replace('"A", "B",', '"A",\n  "B",')
                      .replace("= 4;", "=    4;   ");
  check("comment/whitespace-only edit is not stale",
    diffConfig(cosmetic, BUILT).stale === false, JSON.stringify(diffConfig(cosmetic, BUILT).diffs));

  // --- a real edit IS reported, and names the key ---
  const renamed = diffConfig(SRC.replace('"OLD NAME"', '"NEW NAME"'), BUILT);
  check("a changed value is stale", renamed.stale === true);
  check("a changed value names the key", renamed.diffs.some((d) => d.key === "TOURNAMENT_NAME"));
  check("a changed value shows both sides",
    renamed.diffs.find((d) => d.key === "TOURNAMENT_NAME")?.built === "OLD NAME" &&
    renamed.diffs.find((d) => d.key === "TOURNAMENT_NAME")?.onDisk === "NEW NAME");

  const rebalanced = diffConfig(SRC.replace('"A", "B",', '"A", "B", "C", "D",'), BUILT);
  check("a changed PLAYERS list is reported", rebalanced.diffs.some((d) => d.key === "PLAYERS"));
  check("PLAYERS diff counts both sides",
    rebalanced.diffs.find((d) => d.key === "PLAYERS")?.built.startsWith("2 players") &&
    rebalanced.diffs.find((d) => d.key === "PLAYERS")?.onDisk.startsWith("4 players"));

  const repotted = diffConfig(SRC.replace("= 4;", "= 2;"), BUILT);
  check("a changed pot count is reported", repotted.diffs.some((d) => d.key === "POTS"));

  // --- secrets are NEVER disclosed, only set/empty ---
  const pinFlip = diffConfig(SRC.replace('SCREEN_PIN = ""', 'SCREEN_PIN = "9999"'), BUILT);
  const pinDiff = pinFlip.diffs.find((d) => d.key === "SCREEN_PIN");
  check("a newly set PIN is reported", !!pinDiff);
  check("the PIN's VALUE never appears in the diff", !!pinDiff && !JSON.stringify(pinFlip).includes("9999"),
    JSON.stringify(pinFlip));
  check("secrets are reported as set/empty", pinDiff?.built === "empty" && pinDiff?.onDisk === "set");
  const samePinEdit = diffConfig(SRC.replace('OWNER_PIN = "1111"', 'OWNER_PIN = "2222"'), BUILT);
  check("changing a PIN to another set value is NOT reported (both are 'set')",
    !samePinEdit.diffs.some((d) => d.key === "OWNER_PIN"));

  // --- unreadable keys are skipped, never guessed at ---
  const mangled = diffConfig(SRC.replace('export const POTS: number = 4;', 'export const POTS = (4);'), BUILT);
  check("an unparseable key is listed as unreadable", mangled.unreadable.length > 0 || mangled.stale);
  check("a mangled file still returns a result object", typeof mangled.stale === "boolean");
  check("diffConfig never throws on garbage", (() => {
    try { diffConfig("\0\0 not typescript at all", BUILT); return true; } catch { return false; }
  })());

  // --- commented-out entries must not read as real ones ---
  check("a commented-out PLAYER_IMAGES entry is not counted",
    diffConfig(SRC.replace("{\n  // nothing\n}", '{\n  // "A": "https://x/p1.png",\n}'),
      { ...BUILT, PLAYER_IMAGES: {} }).stale === false);
  check("a // inside a string literal survives comment stripping",
    stripComments('const a = "https://x"; // gone').includes("https://x"));
  check("a // inside a string literal does not swallow the rest",
    !stripComments('const a = "https://x"; // gone').includes("gone"));
  check("a real PLAYER_IMAGES entry is still counted",
    diffConfig(SRC.replace("{\n  // nothing\n}", '{ "A": "https://x/p1.png" }'),
      { ...BUILT, PLAYER_IMAGES: {} }).stale === true);

  // --- the REAL config file, through the REAL comparator ---
  // Node imports the same file from source, so "built" and "on disk" agree and
  // this MUST be clean. A false positive here would fire the banner on every
  // fresh build, which is the failure mode that would kill trust in the warning.
  const live = configStaleness(REAL_CFG);
  check("the real config is readable", live.readable === true);
  check("an unedited real config is NOT stale", live.stale === false,
    JSON.stringify(live.diffs));
  check("no PIN value anywhere in the real result", !/6827|30266/.test(JSON.stringify(live)));

  // Simulate a build that predates an edit: pretend the running build compiled
  // the OLD name and the 8-player roster, exactly like yesterday's build.
  const realSrc = readFileSync(new URL("../config/tournament.config.ts", import.meta.url), "utf8");
  const oldBuild = {
    ...REAL_CFG,
    TOURNAMENT_NAME: "Efootball TechFest 2027",
    PLAYERS: ["Player A1", "Player A2"],
  };
  const staleSim = diffConfig(realSrc, oldBuild);
  check("an edit after a build IS reported as stale", staleSim.stale === true);
  check("the real renamed tournament is named in the diff",
    staleSim.diffs.some((d) => d.key === "TOURNAMENT_NAME" &&
      d.built === "Efootball TechFest 2027" && d.onDisk === "KICKSTREAM NEXUS"),
    JSON.stringify(staleSim.diffs.map((d) => `${d.key}: ${d.built} -> ${d.onDisk}`)));
  check("the real roster change is named in the diff",
    staleSim.diffs.some((d) => d.key === "PLAYERS" && d.built.startsWith("2 players")));
  check("nothing else in the real config looks stale",
    staleSim.diffs.every((d) => ["TOURNAMENT_NAME", "PLAYERS"].includes(d.key)),
    JSON.stringify(staleSim.diffs.map((d) => d.key)));

  console.log("[config] staleness: parser tolerance, no false positives on cosmetic edits,");
  console.log("[config] real diffs for name/players/pots, secrets masked to set/empty, unreadable skipped");
}

// ---- tournament name validation (server + client share this) ----
{
  check("name is trimmed", cleanTournamentName("  KICKSTREAM  ") === "KICKSTREAM");
  check("name collapses inner whitespace", cleanTournamentName("Kick   Stream\nNexus") === "Kick Stream Nexus");
  check("name strips control chars", cleanTournamentName("A\u0000B\u007fC") === "ABC");
  check("empty name is rejected", (() => { try { cleanTournamentName("   "); return false; } catch { return true; } })());
  check("non-string name is rejected", (() => { try { cleanTournamentName(42); return false; } catch { return true; } })());
  check("over-long name is rejected",
    (() => { try { cleanTournamentName("x".repeat(61)); return false; } catch { return true; } })());
  check("60 chars is accepted", cleanTournamentName("x".repeat(60)).length === 60);
  console.log("[config] name validation: trim, collapse, strip control chars, 1-60 chars");
}


// ============================================================
// HYDRATION — nothing browser-only may be read during the first
// client render, or React throws away the server HTML and
// re-renders that subtree (losing input state and remounting
// controls). The reference pattern is useDrafts in lib/drafts.ts:
// seed with a constant, load the real value in a useEffect.
// ============================================================
{
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  // Comments explain WHY a value is deferred and inevitably mention the API they
  // defer (e.g. "window.location.host is only knowable on the client"). Strip
  // them first, or the guard matches its own documentation.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const readCode = (p) => strip(read(p));

  // 1. no `typeof window` branch in ANY component render path
  const components = [
    "app/page.tsx", "app/editor/page.tsx", "app/owner/page.tsx", "app/screen/page.tsx",
    "components/ScreenPlaylist.tsx", "components/ResultsShow.tsx", "components/PhoneScoreCard.tsx",
    "components/PointsTable.tsx", "components/KnockoutBracket.tsx", "components/SetupWizard.tsx",
    "components/Avatar.tsx", "components/PinGate.tsx", "components/DrawShow.tsx",
    "components/DrawControlPanel.tsx", "components/StatusPage.tsx", "components/ErrorBoundary.tsx",
  ];
  for (const f of components) {
    check(`${f} has no typeof-window render branch`, !/typeof window/.test(read(f)));
  }

  // 2. the / share link is published after mount
  const home = read("app/page.tsx");
  const homeCode = readCode("app/page.tsx");
  check("/ publishes location.host after mount", /useEffect\(\(\) => \{ setHost\(window\.location\.host\); \}, \[\]\)/.test(home));
  check("/ renders the share link only once host is set", /\{host && \(/.test(home));
  check("/ reads window.location only inside that effect",
    (homeCode.match(/window\.location/g) || []).length === 1,
    `found ${(homeCode.match(/window\.location/g) || []).length} use(s) outside comments`);

  // 3. the queued badge is a constant on first render
  const hook = read("lib/useTournament.ts");
  check("queued starts at 0, not a browser read", /const \[queued, setQueued\] = useState\(0\)/.test(hook));
  check("queued is published from an effect", /useEffect\(\(\) => \{ setQueued\(Object\.keys\(queueRef\.current\)\.length\); \}, \[\]\)/.test(hook));

  // 4. the device LABEL is separate from the attribution id
  check("device label starts empty", /const \[deviceLabel, setDeviceLabel\] = useState\(""\)/.test(hook));
  check("device label is published from an effect", /useEffect\(\(\) => \{ setDeviceLabel\(me\); \}, \[me\]\)/.test(hook));
  // [^\n]* not [^;]*$: the line ends with a semicolon, which [^;]* can never reach.
  const returnLine = (hook.match(/^\s*return \{ state, derived,[^\n]*/m) || [""])[0];
  check("the hook returns the label, not the raw id", /device: deviceLabel/.test(returnLine), returnLine.trim());
  // "device: me" is CORRECT inside a score payload (attribution), so the guard
  // must inspect the return statement only, not the whole file.
  check("the raw id is not what the hook returns", !/device: me/.test(returnLine));
  check("score attribution still uses device: me", /device: me,/.test(hook));

  // 5. score attribution must keep using the synchronous id — a regression here
  //    would silently lose who-recorded-which-score in the editor.
  check("score submissions still stamp the synchronous device id", /device: me/.test(hook));
  check("optimistic patches still stamp editedBy", /editedBy: me/.test(hook));

  // 6. DATA-LOSS GUARD. queueRef must keep loading SYNCHRONOUSLY. The mount
  //    effect calls flush(), which ends in saveQueue(queueRef.current); if the
  //    queue were only loaded in an effect, that flush would save an empty map
  //    and wipe every queued offline score.
  check("queueRef still loads the queue synchronously (do NOT move this into an effect)",
    /useRef<Record<string, ScoreDraft>>\(typeof window === "undefined" \? \{\} : loadQueue\(\)\)/.test(hook));
  check("the mount effect still flushes the queue", /refresh\(\)\.then\(flush\)/.test(hook));

  // 7. drafts are the reference implementation — keep it that way
  const drafts = read("lib/drafts.ts");
  check("useDrafts seeds with a constant", /useState<DraftMap>\(\{\}\)/.test(drafts));
  check("useDrafts loads storage in an effect", /useEffect\(/.test(drafts) && /readStorage\(\)/.test(drafts));
  check("useDrafts never seeds state from localStorage", !/useState<DraftMap>\(readStorage\(\)/.test(drafts));

  console.log("[hydration] no browser-only reads in render (16 components), queued/device/host");
  console.log("[hydration] published after mount, attribution preserved, queue-load data-loss guard");
}




// ---- tournament stats + credit leaderboards (real module) ----
{
  const P = (id, n) => ({ id, name: n, pot: 1 });
  const M = (id, stage, a, b, pa, pb, o = {}) => ({ id, stage, playerA: pa, playerB: pb, scoreA: a, scoreB: b, played: a != null, ...o });

  const players = [P("A1", "Alpha"), P("B2", "Bravo"), P("C3", "Chic"), P("D4", "Delta"), P("E5", "Echo")];
  const league = [
    M("L1", "league", 2, 0, "A1", "B2"),
    M("L2", "league", 1, 1, "C3", "D4"),
    M("L3", "league", 0, 0, "A1", "C3"),
    M("L4", "league", 3, 1, "D4", "E5"),
  ];
  const st = tournamentStats(players, league, []);
  const by = (id) => st.find((s) => s.playerId === id);

  check("apps/goals accumulate", by("A1").apps === 2 && by("A1").goals === 2, JSON.stringify(by("A1")));
  check("a 0-0 clean sheet counts for BOTH sides", by("C3").cleanSheets === 1, "Chic kept it");
  check("a clean sheet also counts when winning 2-0", by("A1").cleanSheets === 2, JSON.stringify(by("A1").cleanSheets));
  check("a 0-0 is a draw, not a win", by("A1").draws === 1 && by("A1").wins === 1);
  check("conceded accumulates (Alpha never conceded)", by("A1").conceded === 0 && by("A1").gd === 2, JSON.stringify(by("A1")));
  check("biggest winning margin tracked", by("A1").biggestWin === 2 && by("D4").biggestWin === 2);

  // pens: a level knockout tie is a WIN for penaltyWinner, and the score still feeds GF/GA
  const ko = [M("K1", "qf", 1, 1, "A1", "B2", { penaltyWinner: "B2" })];
  const st2 = tournamentStats(players, league, ko);
  const b2 = st2.find((s) => s.playerId === "B2");
  check("pens winner counted as a win, not a draw", b2.wins === 1 && b2.draws === 0, JSON.stringify(b2));
  check("level scoreline still feeds goals/conceded (1-1 on top of a 0-2 loss)", b2.goals === 1 && b2.conceded === 3, JSON.stringify({g:b2.goals,c:b2.conceded}));

  // locked bracket rows are skipped entirely
  const st3 = tournamentStats(players, [], [M("K2", "sf", null, null, "W(K1)", "p-9", {})]);
  check("W(...) rows skipped", st3.every((s) => s.apps === 0 && s.goals === 0));

  // ---- leaderboard rules ----
  const fake = (o) => ({ playerId: o.n, name: o.n, gamerId: o.n, apps: 5, wins: 0, draws: 0, losses: 0, goals: 0, conceded: 0, gd: 0, cleanSheets: 0, biggestWin: 0, ...o });
  const rows = [
    fake({ n: "X", goals: 9, conceded: 1, wins: 4, losses: 0, cleanSheets: 3, gd: 8 }),
    fake({ n: "Y", goals: 7, conceded: 2, wins: 3, losses: 1, cleanSheets: 2, gd: 5 }),
    fake({ n: "Z", goals: 5, conceded: 3, wins: 2, losses: 2, cleanSheets: 1, gd: 2 }),
    fake({ n: "W", goals: 5, conceded: 4, wins: 2, losses: 2, cleanSheets: 0, gd: 1 }),
    fake({ n: "V", goals: 2, conceded: 5, wins: 1, losses: 3, cleanSheets: 0, gd: -3 }),
    fake({ n: "U", goals: 2, conceded: 9, wins: 0, losses: 4, cleanSheets: 0, gd: -7 }),
  ];
  const scorer = creditBoard(rows, "scorer");
  check("competition ranking: shared value shares a rank, next skips",
    scorer.entries.map((e) => e.rank).join(",") === "1,2,3,3,5,5", scorer.entries.map((e) => e.rank).join(","));
  check("most-is-better sorted descending", scorer.entries.map((e) => e.value).join(",") === "9,7,5,5,2,2");
  const def = creditBoard(rows, "defence");
  check("fewest-is-better sorted ascending", def.entries.map((e) => e.value).join(",") === "1,2,3,4,5", def.entries.map((e) => e.value).join(","));
  check("rank 6 is excluded from a top-5 board", def.entries.length === 5 && def.entries.every((e) => e.rank <= 5));
  check("board title + hint present", def.title === "BEST DEFENCE" && def.hint === "fewest conceded");

  // 0-app players excluded everywhere (else they'd top the "fewest" boards)
  const withGhost = [...rows, fake({ n: "GHOST", apps: 0, goals: 0, conceded: 0, wins: 0, losses: 0, cleanSheets: 0 })];
  for (const k of CREDIT_KEYS) {
    const b = creditBoard(withGhost, k);
    check(`0-app player excluded from "${k}"`, b && !b.entries.some((e) => e.stats.name === "GHOST"));
  }

  // a tie on 5th pushes the list past 5 rows
  const tied = [...rows, fake({ n: "T1", goals: 2, conceded: 5 }), fake({ n: "T2", goals: 2, conceded: 5 })];
  const bt = creditBoard(tied, "scorer");
  check("tie on 5th extends the list beyond 5 rows", bt.entries.length === 8, String(bt.entries.length));
  check("...and they share the rank", bt.entries.slice(4).every((e) => e.rank === 5));

  // row cap guards a mass tie
  const mass = Array.from({ length: 14 }, (_, i) => fake({ n: "M" + i, goals: 3, conceded: 3 }));
  const bm = creditBoard(mass, "scorer");
  check("row cap stops a mass tie at 10", bm.entries.length === 10, String(bm.entries.length));
  check("...and reports how many were tied out", bm.moreTied === 4, String(bm.moreTied));

  // ---- podium + "finished" ----
  const koFull = [
    M("QF1", "qf", 2, 0, "A1", "B2"),
    M("QF2", "qf", 1, 2, "C3", "D4"),
    M("SF1", "sf", 2, 0, "A1", "D4"),
    M("SF2", "sf", 1, 3, "B2", "C3"),
    M("FIN", "final", 3, 2, "A1", "D4"),
  ];
  const withThird = [...koFull, M("THIRD", "third", 1, 0, "B2", "C3")];
  const pod = podium(st, league, withThird);
  check("podium champion from the final", pod.champion?.name === "Alpha", pod.champion?.name);
  check("podium runner-up is the other finalist", pod.runnerUp?.name === "Delta", pod.runnerUp?.name);
  check("podium third from the 3rd-place tie", pod.third?.name === "Bravo", pod.third?.name);
  const noThird = podium(st, league, koFull);
  check("no 3rd-place tie -> joint third with an explanation",
    noThird.third !== null && /Joint 3rd/.test(noThird.thirdNote ?? ""), noThird.thirdNote);

  check("not finished before the final", tournamentFinished([], true) === false);
  check("not finished with the final but no 3rd place", tournamentFinished(koFull, true) === false);
  check("finished with final + 3rd place", tournamentFinished(withThird, true) === true);
  check("finished on the final alone when 3rd place is off", tournamentFinished(koFull, false) === true);
  check("an undecided final is never finished",
    tournamentFinished([M("FIN", "final", 1, 1, "A1", "D4", { penaltyWinner: null })], false) === false);
  console.log("[stats] apps/goals/clean sheets, pens=win, W() skipped, competition ranking, direction per stat,");
  console.log("[stats] 0-app excluded, tie-at-5th extends, row cap, podium, tournamentFinished (incl. THIRD_PLACE off)");
}

// ---- results sits below ceremony and above not-prepared ----
{
  const base = {
    hasPendingDraw: false, leagueCount: 24, knockoutCount: 8, qualifiers: 8,
    sfDrawDone: true, leagueDone: true, matchdays: [1, 2],
    projection: { pages: ["knockout"], rotate: true },
    tournamentFinished: false, resultsSuppressed: false,
  };
  check("no results before the tournament is over", planScreen(base).kind !== "results");
  const done = { ...base, tournamentFinished: true };
  check("results once finished", planScreen(done).kind === "results");
  check("ceremony still beats results", planScreen({ ...done, hasPendingDraw: true }).kind === "ceremony");
  check("suppressed -> falls through to the bracket", planScreen({ ...done, resultsSuppressed: true }).kind === "rotate");
  check("projector peek -> falls through to the bracket", planScreen({ ...done, resultsSuppressed: true }).kind === "rotate");
}
console.log("[screen] results priority: ceremony > results > not-prepared > rotate");

// ============================================================
// config staleness — the "I edited the file and nothing happened" guard
// ============================================================
{
  const SRC = `
// header comment
export const TOURNAMENT_NAME = "OLD NAME";
export const PLAYERS: string[] = [
  "A", "B",
];
export const POTS: number = 4;
export const QUALIFIERS_COUNT: 8 | 16 = 8;
export const THIRD_PLACE = true;
export const TIEBREAK_MODE = "golden_goal" as const; // trailing comment
export const OWNER_PIN = "1111";   // <-- SET THIS
export const SCREEN_PIN = "";
export const AVATAR_DIR = "/players";
export const PLAYER_IMAGES: Record<string, string> = {
  // nothing
};
export function helper() { return 1; }
`;
  const BUILT = {
    TOURNAMENT_NAME: "OLD NAME",
    PLAYERS: ["A", "B"],
    POTS: 4, QUALIFIERS_COUNT: 8, THIRD_PLACE: true, TIEBREAK_MODE: "golden_goal",
    OWNER_PIN: "1111", SCREEN_PIN: "", AVATAR_DIR: "/players", PLAYER_IMAGES: {},
  };

  // --- the parser copes with the real file's syntax ---
  check("plain string", extractInitialiser(SRC, "TOURNAMENT_NAME") === '"OLD NAME"');
  check(": string[] annotation", extractInitialiser(SRC, "PLAYERS") !== null);
  check("union type annotation", extractInitialiser(SRC, "QUALIFIERS_COUNT") === "8");
  check("as const suffix is tolerated", extractInitialiser(SRC, "TIEBREAK_MODE") === '"golden_goal" as const');
  check("trailing comment is tolerated", extractInitialiser(SRC, "OWNER_PIN") === '"1111"');
  check("export function is not a const", extractInitialiser(SRC, "helper") === null);
  check("absent key returns null", extractInitialiser(SRC, "NOPE") === null);

  // --- no false positives: an untouched config is NOT stale ---
  const same = diffConfig(SRC, BUILT);
  check("identical source is not stale", same.stale === false, JSON.stringify(same.diffs));
  check("identical source has no diffs", same.diffs.length === 0);

  // --- a comment/whitespace-only edit must NOT be reported ---
  const cosmetic = SRC.replace("// header comment", "// header comment\n// another thought")
                      .replace('"A", "B",', '"A",\n  "B",')
                      .replace("= 4;", "=    4;   ");
  check("comment/whitespace-only edit is not stale",
    diffConfig(cosmetic, BUILT).stale === false, JSON.stringify(diffConfig(cosmetic, BUILT).diffs));

  // --- a real edit IS reported, and names the key ---
  const renamed = diffConfig(SRC.replace('"OLD NAME"', '"NEW NAME"'), BUILT);
  check("a changed value is stale", renamed.stale === true);
  check("a changed value names the key", renamed.diffs.some((d) => d.key === "TOURNAMENT_NAME"));
  check("a changed value shows both sides",
    renamed.diffs.find((d) => d.key === "TOURNAMENT_NAME")?.built === "OLD NAME" &&
    renamed.diffs.find((d) => d.key === "TOURNAMENT_NAME")?.onDisk === "NEW NAME");

  const rebalanced = diffConfig(SRC.replace('"A", "B",', '"A", "B", "C", "D",'), BUILT);
  check("a changed PLAYERS list is reported", rebalanced.diffs.some((d) => d.key === "PLAYERS"));
  check("PLAYERS diff counts both sides",
    rebalanced.diffs.find((d) => d.key === "PLAYERS")?.built.startsWith("2 players") &&
    rebalanced.diffs.find((d) => d.key === "PLAYERS")?.onDisk.startsWith("4 players"));

  const repotted = diffConfig(SRC.replace("= 4;", "= 2;"), BUILT);
  check("a changed pot count is reported", repotted.diffs.some((d) => d.key === "POTS"));

  // --- secrets are NEVER disclosed, only set/empty ---
  const pinFlip = diffConfig(SRC.replace('SCREEN_PIN = ""', 'SCREEN_PIN = "9999"'), BUILT);
  const pinDiff = pinFlip.diffs.find((d) => d.key === "SCREEN_PIN");
  check("a newly set PIN is reported", !!pinDiff);
  check("the PIN's VALUE never appears in the diff", !!pinDiff && !JSON.stringify(pinFlip).includes("9999"),
    JSON.stringify(pinFlip));
  check("secrets are reported as set/empty", pinDiff?.built === "empty" && pinDiff?.onDisk === "set");
  const samePinEdit = diffConfig(SRC.replace('OWNER_PIN = "1111"', 'OWNER_PIN = "2222"'), BUILT);
  check("changing a PIN to another set value is NOT reported (both are 'set')",
    !samePinEdit.diffs.some((d) => d.key === "OWNER_PIN"));

  // --- unreadable keys are skipped, never guessed at ---
  const mangled = diffConfig(SRC.replace('export const POTS: number = 4;', 'export const POTS = (4);'), BUILT);
  check("an unparseable key is listed as unreadable", mangled.unreadable.length > 0 || mangled.stale);
  check("a mangled file still returns a result object", typeof mangled.stale === "boolean");
  check("diffConfig never throws on garbage", (() => {
    try { diffConfig("\0\0 not typescript at all", BUILT); return true; } catch { return false; }
  })());

  // --- commented-out entries must not read as real ones ---
  check("a commented-out PLAYER_IMAGES entry is not counted",
    diffConfig(SRC.replace("{\n  // nothing\n}", '{\n  // "A": "https://x/p1.png",\n}'),
      { ...BUILT, PLAYER_IMAGES: {} }).stale === false);
  check("a // inside a string literal survives comment stripping",
    stripComments('const a = "https://x"; // gone').includes("https://x"));
  check("a // inside a string literal does not swallow the rest",
    !stripComments('const a = "https://x"; // gone').includes("gone"));
  check("a real PLAYER_IMAGES entry is still counted",
    diffConfig(SRC.replace("{\n  // nothing\n}", '{ "A": "https://x/p1.png" }'),
      { ...BUILT, PLAYER_IMAGES: {} }).stale === true);

  // --- the REAL config file, through the REAL comparator ---
  // Node imports the same file from source, so "built" and "on disk" agree and
  // this MUST be clean. A false positive here would fire the banner on every
  // fresh build, which is the failure mode that would kill trust in the warning.
  const live = configStaleness(REAL_CFG);
  check("the real config is readable", live.readable === true);
  check("an unedited real config is NOT stale", live.stale === false,
    JSON.stringify(live.diffs));
  check("no PIN value anywhere in the real result", !/6827|30266/.test(JSON.stringify(live)));

  // Simulate a build that predates an edit: pretend the running build compiled
  // the OLD name and the 8-player roster, exactly like yesterday's build.
  const realSrc = readFileSync(new URL("../config/tournament.config.ts", import.meta.url), "utf8");
  const oldBuild = {
    ...REAL_CFG,
    TOURNAMENT_NAME: "Efootball TechFest 2027",
    PLAYERS: ["Player A1", "Player A2"],
  };
  const staleSim = diffConfig(realSrc, oldBuild);
  check("an edit after a build IS reported as stale", staleSim.stale === true);
  check("the real renamed tournament is named in the diff",
    staleSim.diffs.some((d) => d.key === "TOURNAMENT_NAME" &&
      d.built === "Efootball TechFest 2027" && d.onDisk === "KICKSTREAM NEXUS"),
    JSON.stringify(staleSim.diffs.map((d) => `${d.key}: ${d.built} -> ${d.onDisk}`)));
  check("the real roster change is named in the diff",
    staleSim.diffs.some((d) => d.key === "PLAYERS" && d.built.startsWith("2 players")));
  check("nothing else in the real config looks stale",
    staleSim.diffs.every((d) => ["TOURNAMENT_NAME", "PLAYERS"].includes(d.key)),
    JSON.stringify(staleSim.diffs.map((d) => d.key)));

  console.log("[config] staleness: parser tolerance, no false positives on cosmetic edits,");
  console.log("[config] real diffs for name/players/pots, secrets masked to set/empty, unreadable skipped");
}

// ---- tournament name validation (server + client share this) ----
{
  check("name is trimmed", cleanTournamentName("  KICKSTREAM  ") === "KICKSTREAM");
  check("name collapses inner whitespace", cleanTournamentName("Kick   Stream\nNexus") === "Kick Stream Nexus");
  check("name strips control chars", cleanTournamentName("A\u0000B\u007fC") === "ABC");
  check("empty name is rejected", (() => { try { cleanTournamentName("   "); return false; } catch { return true; } })());
  check("non-string name is rejected", (() => { try { cleanTournamentName(42); return false; } catch { return true; } })());
  check("over-long name is rejected",
    (() => { try { cleanTournamentName("x".repeat(61)); return false; } catch { return true; } })());
  check("60 chars is accepted", cleanTournamentName("x".repeat(60)).length === 60);
  console.log("[config] name validation: trim, collapse, strip control chars, 1-60 chars");
}


// ============================================================
// biggest-win caption — the recorded GOALS, never the margin.
//
// Regression: the results screen once printed
//   biggest win {biggestWin}-0 vs ...
// i.e. the MARGIN with a hard-coded 0, so a 6-2 win displayed as
// "4-0" and an away 2-4 win displayed as "2-0" (margin 2).
// ============================================================
{
  const P = (id) => ({ id, name: id.toUpperCase(), pot: 1 });
  const M = (id, pa, sa, pb, sb, extra = {}) =>
    ({ id, stage: "league", matchday: 1, playerA: pa, playerB: pb, scoreA: sa, scoreB: sb, played: true, ...extra });

  const roster = [P("x"), P("y"), P("z")];
  const x0 = (rs, m) => tournamentStats(rs, [m], [])[0];

  // --- case 1 from the bug report: recorded 6-2, winner at HOME ---
  {
    const [x] = tournamentStats(roster, [M("MD2-03", "x", 6, "y", 2)], []);
    check("home 6-2: margin is 4", x.biggestWin === 4);
    check("home 6-2: the player's OWN goals are recorded", x.biggestWinScoreSelf === 6);
    check("home 6-2: the opponent's goals are recorded", x.biggestWinScoreAgainst === 2);
    check("home 6-2: flagged as a home win", x.biggestWinAway === false);
    check("home 6-2: caption would read 6-2, not 4-0",
      `${x.biggestWinScoreSelf}-${x.biggestWinScoreAgainst}` === "6-2");
  }

  // --- case 2 from the bug report: recorded 2-4, winner was the AWAY side ---
  {
    const [, y] = tournamentStats(roster, [M("MD1-07", "x", 2, "y", 4)], []);
    check("away 2-4: margin is 2", y.biggestWin === 2);
    check("away 2-4: the WINNER's own goals come first (4)", y.biggestWinScoreSelf === 4);
    check("away 2-4: the loser scored 2", y.biggestWinScoreAgainst === 2);
    check("away 2-4: flagged as an AWAY win", y.biggestWinAway === true);
    check("away 2-4: caption would read 4-2 (won away), not 2-0",
      `${y.biggestWinScoreSelf}-${y.biggestWinScoreAgainst}` === "4-2");
    check("away 2-4: the loser recorded no biggest win", x0(roster, M("MD1-07", "x", 2, "y", 4)).biggestWin === 0);
  }

  // a level tie won on penalties is a win, but has NO margin, so it must never
  // become a "biggest win" (that would caption it as 0-0)
  {
    const pens = M("FIN-01", "x", 1, "y", 1, { stage: "final", penaltyWinner: "y" });
    const [x, y] = tournamentStats(roster, [], [pens]);
    check("pens win counts as a win", y.wins === 1);
    check("pens win records no biggest-win caption", y.biggestWin === 0 && y.biggestWinMatchId === undefined);
    check("pens win leaves the scoreline fields unset", y.biggestWinScoreSelf === undefined);
  }

  // a later, larger win must replace the earlier one — and ALL fields together
  {
    // first win at HOME, later and bigger win AWAY -> the side flag must flip
    const ms = [M("MD1-01", "x", 1, "y", 0), M("MD3-02", "z", 1, "y", 5)];
    const [, y] = tournamentStats(roster, ms, []);
    check("the larger margin wins", y.biggestWin === 4);
    check("and it is the later match", y.biggestWinMatchId === "MD3-02");
    check("and its scoreline moved with it", y.biggestWinScoreSelf === 5 && y.biggestWinScoreAgainst === 1);
    check("and its side moved with it", y.biggestWinAway === true);
    check("the opponent is the one they beat", y.biggestWinOpponent === "Z");
  }

  // adding these fields must not disturb the leaderboard ordering
  {
    const ms = [M("MD1-01", "x", 3, "y", 0), M("MD1-02", "y", 2, "z", 0), M("MD1-03", "z", 1, "x", 0)];
    const board = creditBoard(tournamentStats(roster, ms, []), "margin");
    check("BIGGEST WIN still ranks by margin",
      board && board.entries[0].stats.playerId === "x" && board.entries[0].value === 3);
  }

  // static guard: the fabricated form must never come back
  {
    const src = readFileSync(new URL("../components/ResultsShow.tsx", import.meta.url), "utf8");
    check("ResultsShow no longer prints the margin with a hard-coded 0", !/biggestWin\}–0/.test(src));
    check("ResultsShow prints the recorded self score", /biggestWinScoreSelf\}–\{e\.stats\.biggestWinScoreAgainst/.test(src));
    check("ResultsShow labels an away win", /biggestWinAway \? " \(won away\)"/.test(src));
    check("ResultsShow guards the caption on the real score", /biggestWinScoreSelf != null/.test(src));
  }

  console.log("[stats] biggest-win caption: real goals not margin (6-2 and away 2-4 exact),");
  console.log("[stats] away flag, pens win excluded, later margin replaces all fields, ranking intact");
}
if (!process.exitCode) console.log("ALL CHECKS PASSED");
