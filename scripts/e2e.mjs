// End-to-end smoke test against a RUNNING server (default http://localhost:8000).
// Walks the whole event: roster -> group draw -> ceremony -> scores from three
// "phones" -> knockout -> champion -> 3rd place, asserting the state machine
// at each step. Run with:  node scripts/e2e.mjs [baseUrl]
//
// Reads OWNER_PIN / SCREEN_PIN out of the config so it works whether or not
// you have set them — and so it exercises the real access control.

import { readFileSync, existsSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:8000";
const J = { "content-type": "application/json" };

function readPin(key) {
  try {
    const src = readFileSync(new URL("../config/tournament.config.ts", import.meta.url), "utf8");
    const m = src.match(new RegExp(`export const ${key}\\s*=\\s*"([^"]*)"`));
    return m ? m[1] : "";
  } catch { return ""; }
}
const OWNER_PIN = readPin("OWNER_PIN");
const SCREEN_PIN = readPin("SCREEN_PIN");
const ownerHeader = OWNER_PIN ? { "x-owner-pin": OWNER_PIN } : {};

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ""}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

const control = (body, headers = ownerHeader) =>
  fetch(`${BASE}/api/control`, { method: "POST", headers: { ...J, ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const score = (matchId, a, b, opts = {}) =>
  fetch(`${BASE}/api/score`, {
    method: "POST", headers: J,
    body: JSON.stringify({ matchId, scoreA: a, scoreB: b, editedAt: new Date().toISOString(), device: "E2E", ...opts }),
  }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const state = () => fetch(`${BASE}/api/state`).then((r) => (r.status === 204 ? null : r.json()));
const names = (s) => new Map(s.players.map((p) => [p.id, p.name]));
const nm = (s, id) => (String(id).startsWith("W(") ? id : names(s).get(id) ?? id);

/** Mirror of lib/draw.ts propagateWinners — the UI always renders the RESOLVED
 *  bracket, so assertions must too. Raw rows keep W(...) sides by design. */
function resolve(matches) {
  const isPh = (v) => typeof v === "string" && v.startsWith("W(");
  const winner = (m) => {
    if (!m.played) return null;
    if (m.goldenGoalWinner && !isPh(m.goldenGoalWinner)) return m.goldenGoalWinner;
    if (m.penaltyWinner && !isPh(m.penaltyWinner)) return m.penaltyWinner;
    if (m.scoreA == null || m.scoreB == null) return null;
    if (m.scoreA > m.scoreB) return isPh(m.playerA) ? null : m.playerA;
    if (m.scoreB > m.scoreA) return isPh(m.playerB) ? null : m.playerB;
    return null;
  };
  const byId = new Map(matches.map((m) => [m.id, m]));
  const depth = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const m = byId.get(id);
    if (!m || !m.feedsFrom) return 0;
    return 1 + Math.max(...m.feedsFrom.map((x) => depth(x, seen)));
  };
  const ordered = [...matches].sort((a, b) => depth(a.id) - depth(b.id));
  const wm = new Map(), out = new Map();
  for (const orig of ordered) {
    let cur = { ...orig };
    if (cur.feedsFrom) {
      const [a, b] = cur.feedsFrom;
      cur = { ...cur, playerA: wm.get(a) ?? `W(${a})`, playerB: wm.get(b) ?? `W(${b})` };
    }
    out.set(cur.id, cur);
    wm.set(cur.id, winner(cur));
  }
  return matches.map((m) => out.get(m.id));
}
const matchWin = (m) => {
  if (!m.played) return null;
  if (m.penaltyWinner) return m.penaltyWinner;
  if (m.scoreA > m.scoreB) return m.playerA;
  if (m.scoreB > m.scoreA) return m.playerB;
  return null;
};

const NAMES = ["Arjun", "Bhavya", "Chirag", "Divya", "Esha", "Farah", "Gaurav", "Hina"];
// Build knockout brackets with the REAL engine, exactly as app/owner/page.tsx does.
// This file used to hand-write sequential feedsFrom, so the e2e never exercised
// the actual round-to-round feeding at all.
const { drawKnockoutRound, buildFixedNextRound, randomPairing } = await import("../lib/draw.ts");

async function main() {
  section("reset");
  ok("reset", (await control({ action: "reset" })).ok);

  // Pin the shape of the tournament this run exercises. Without this the suite
  // silently inherits whatever the server happens to be configured for, so a
  // real Top-16 / K=4 setup (config/tournament.config.ts, or a roster import
  // that widened it) makes the Top-8 assertions below fail for no real reason.
  // The pre-run values are restored at the end.
  const pre = await state();
  const wasQualifiers = pre.qualifiers;
  const wasK = pre.matchesPerPlayer;

  section("roster");
  ok("8 players", (await control({
    action: "roster",
    players: NAMES.map((n, i) => ({ id: `p-${i + 1}`, name: n, pot: 1 })),
  })).ok);
  ok("pin qualifiers=8, K=2 for this run",
    (await control({ action: "settings", qualifiers: 8, matchesPerPlayer: 2 })).ok);
  ok("shape is what this suite expects",
    (await state()).qualifiers === 8 && (await state()).matchesPerPlayer === 2);

  section("group draw ceremony");
  const md1 = Array.from({ length: 4 }, (_, i) => ({
    id: `MD1-${String(i + 1).padStart(2, "0")}`, stage: "league", matchday: 1,
    playerA: `p-${i * 2 + 1}`, playerB: `p-${i * 2 + 2}`, scoreA: null, scoreB: null, played: false,
  }));
  ok("stage draw", (await control({ action: "stageDraw", kind: "league", matches: md1 })).ok);
  let s = await state();
  ok("pendingDraw visible to projector", !!s.pendingDraw && s.pendingDraw.revealed === 0);

  const blocked = await control({ action: "confirmDraw" });
  ok("cannot confirm before revealing all", blocked.status === 409, `got ${blocked.status}`);

  await control({ action: "drawControl", which: "reveal" });
  s = await state();
  ok("manual reveal advances", s.pendingDraw.revealed === 1);

  await control({ action: "drawControl", which: "auto", value: true });
  await new Promise((r) => setTimeout(r, 3200));
  s = await state();
  ok("autoplay reveals all and stops itself", s.pendingDraw.revealed === 4 && s.pendingDraw.auto === false,
    `revealed=${s.pendingDraw.revealed} auto=${s.pendingDraw.auto}`);

  ok("confirm", (await control({ action: "confirmDraw" })).ok);
  s = await state();
  ok("draw committed to league", s.league.length === 4 && s.pendingDraw === null);
  ok("projection starts on matchday 1 + the table", JSON.stringify(s.projection.pages) === '["md1","table"]', JSON.stringify(s.projection.pages));

  section("scores from three phones");
  ok("phone A", (await score("MD1-01", 3, 1, { device: "PHONE-A" })).ok);
  ok("phone B", (await score("MD1-02", 0, 2, { device: "PHONE-B" })).ok);
  ok("phone C draws", (await score("MD1-03", 1, 1, { device: "PHONE-C" })).ok);
  s = await state();
  ok("all three landed in shared state",
    s.league.find((m) => m.id === "MD1-01").scoreA === 3 &&
    s.league.find((m) => m.id === "MD1-02").scoreB === 2 &&
    s.league.find((m) => m.id === "MD1-03").played === true);
  ok("editor attribution recorded", s.league.find((m) => m.id === "MD1-01").editedBy === "PHONE-A");

  const stale = await score("MD1-01", 9, 9, { editedAt: "2000-01-01T00:00:00Z", device: "OLD-PHONE" });
  ok("stale offline edit rejected (409)", stale.status === 409 && stale.stale === true, `got ${stale.status}`);
  s = await state();
  ok("fresh score untouched by stale edit", s.league.find((m) => m.id === "MD1-01").scoreA === 3);

  const locked = await score("MD1-04", 1, 1);
  ok("ordinary tie is scoreable", locked.ok);
  for (const m of s.league) if (!m.played) await score(m.id, 2, 0);

  section("knockout draw #1 (Top 8)");
  s = await state();
  ok("league finished", s.league.every((m) => m.played));
  const qf = Array.from({ length: 4 }, (_, i) => ({
    id: `QF-${String(i + 1).padStart(2, "0")}`, stage: "qf",
    playerA: `p-${i * 2 + 1}`, playerB: `p-${i * 2 + 2}`, scoreA: null, scoreB: null, played: false,
  }));
    const sf = buildFixedNextRound(qf.map((m) => m.id), "sf");
    const fin = buildFixedNextRound(sf.map((m) => m.id), "final");
    ok("stage ko1", (await control({ action: "stageDraw", kind: "ko1", matches: [...qf, ...sf, ...fin] })).ok);
    await control({ action: "drawControl", which: "revealAll" });
    ok("confirm ko1", (await control({ action: "confirmDraw" })).ok);
    s = await state();
    const sfLive = s.knockout.filter((m) => m.stage === "sf");
    const sfFeeders = sfLive.flatMap((m) => m.feedsFrom);
    ok("SF feeding is DRAWN: each SF takes two DISTINCT QF winners",
      sfLive.every((m) => m.feedsFrom[0] !== m.feedsFrom[1]));
    ok("SF feeding is DRAWN: all 4 QF winners feed exactly one SF",
      new Set(sfFeeders).size === 4 && sfFeeders.every((f) => qf.some((q) => q.id === f)),
      sfFeeders.join(","));
    ok("the FINAL stays W(SF-01) v W(SF-02) - only one way to pair two ties",
      s.knockout.find((m) => m.id === "FINAL-01").playerA === "W(SF-01)" &&
      s.knockout.find((m) => m.id === "FINAL-01").feedsFrom.join("+") === "SF-01+SF-02");

  section("knockout results (regular wins must propagate)");
  await score("QF-01", 2, 0);
  await score("QF-02", 3, 1);
  await score("QF-03", 1, 0);
  await score("QF-04", 0, 2);
  s = await state();
  ok("QFs scored", s.knockout.filter((m) => m.stage === "qf" && m.played).length === 4);

  // this is the regression that used to only work for penalty winners
  const r1 = await score("SF-01", 2, 0);
  ok("SF with placeholder sides is scoreable once feeders resolve", r1.ok, r1.error);

  // SF-02 level -> rejected outright, because a KO tie needs a winner
  const levelNoWinner = await score("SF-02", 1, 1);
  ok("level SF score rejected without a pens pick", levelNoWinner.status === 400, `got ${levelNoWinner.status}`);
  s = await state();
  ok("...so SF-02 is still unplayed", s.knockout.find((m) => m.id === "SF-02").played === false);

  // read the REAL SF-02 sides out of the resolved bracket (never guess them)
  const koNow = resolve(s.knockout);
  const sf2 = koNow.find((m) => m.id === "SF-02");
  ok("SF-02 has two real players after the QFs", !sf2.playerA.startsWith("W(") && !sf2.playerB.startsWith("W("),
    `${sf2.playerA} vs ${sf2.playerB}`);

  // a winner pick for someone NOT in the tie must be refused (integrity guard)
  const outsider = ["p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-7", "p-8"].find(
    (id) => id !== sf2.playerA && id !== sf2.playerB
  );
  const phantom = await score("SF-02", 1, 1, { penaltyWinner: outsider });
  ok("phantom winner (not in the tie) rejected", phantom.status === 400, `got ${phantom.status}`);

  // the level tie itself is fine once a real winner comes with it
  const withWinner = await score("SF-02", 1, 1, { penaltyWinner: sf2.playerA });
  ok("level SF accepted once a winner is included", withWinner.ok, withWinner.error);

  s = await state();
  const ko = resolve(s.knockout);
  const f = ko.find((m) => m.stage === "final");
  const fa = names(s).get(f.playerA) ?? f.playerA;
  const fb = names(s).get(f.playerB) ?? f.playerB;
  ok("FINAL resolved from the regular-win SF", fa === "Arjun", `final A = ${fa}`);
  ok("FINAL resolved from the pens SF", !String(fb).startsWith("W("), `final B = ${fb}`);
  ok("FINAL never shows W(QF-*)", !/QF-/.test(f.playerA + f.playerB), `${f.playerA} vs ${f.playerB}`);

  const third = ko.find((m) => m.stage === "third");
  ok("3rd place auto-created from SF losers", !!third, "THIRD-01 missing");
  if (third) {
    const sf1f = ko.find((m) => m.id === "SF-01");
    const sf2f = ko.find((m) => m.id === "SF-02");
    const loserOf = (m) => (m.playerA === matchWin(m) ? m.playerB : m.playerA);
    ok("3rd place sides are the SF losers",
      third.playerA === loserOf(sf1f) && third.playerB === loserOf(sf2f),
      `${nm(s, third.playerA)} vs ${nm(s, third.playerB)}`);
    console.log(`       THIRD-01: ${nm(s, third.playerA)} vs ${nm(s, third.playerB)}`);
  }

  section("finish the tournament");
  await score("FINAL-01", 3, 2);
  await score("THIRD-01", 1, 0);
  s = await state();
  const fDone = resolve(s.knockout).find((m) => m.stage === "final");
  const winner = fDone.scoreA > fDone.scoreB ? nm(s, fDone.playerA) : nm(s, fDone.playerB);
  ok("final scored", fDone.played === true);
  ok("champion would render", !String(winner).startsWith("W("), `winner=${winner}`);
  console.log(`       ★ CHAMPION: ${winner}`);

  section("routes");
  // the home page is a launcher, not a redirect — guard against regressing it
  for (const route of ["/", "/editor", "/owner", "/screen"]) {
    const r = await fetch(`${BASE}${route}`, { redirect: "manual" });
    ok(`${route} serves a real page (status 200, no redirect)`, r.status === 200, `status ${r.status}`);
  }
  const home = await fetch(`${BASE}/`).then((r) => r.text());
  for (const marker of ["Record scores", "Owner control", "Projection"]) {
    ok(`home shows "${marker}"`, home.includes(marker));
  }
  for (const href of ["/editor", "/owner", "/screen"]) {
    ok(`home links to ${href}`, home.includes(`"${href}"`) || home.includes(href));
  }

  section("roster import from a spreadsheet");
  {
    const xlsx = readFileSync(new URL("./fixtures/roster.xlsx", import.meta.url));
    const post = (buf, query = "") =>
      fetch(`${BASE}/api/roster${query}`, { method: "POST", headers: ownerHeader, body: buf })
        .then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));

    // roster changes are only allowed before the first draw
    const lockedNow = await post(xlsx, "?dryRun=1");
    ok("roster import refused once the group stage is drawn", lockedNow.status === 409, `got ${lockedNow.status}`);

    // reset clears draws but deliberately KEEPS the roster, so compare before/after
    const beforeIds = (await state()).players.map((p) => p.id).join(",");
    await control({ action: "reset" });
    const preview = await post(xlsx, "?dryRun=1");
    ok("dry-run preview succeeds after a reset", preview.ok === true, preview.error);
    ok("preview finds 8 players", preview.players?.length === 8, String(preview.players?.length));
    ok("preview found all 8 cell-anchored images", preview.photos?.found === 8, JSON.stringify(preview.photos));
    ok("gamer_id becomes the player id", preview.players?.[0]?.id === "ARJUN01", preview.players?.[0]?.id);
    ok("a dry run does not apply", preview.applied === undefined);
    ok("...and mutates nothing", (await state()).players.map((p) => p.id).join(",") === beforeIds);

    const applied = await post(xlsx);
    ok("apply succeeds", applied.applied === true, applied.error);
    ok("photos stored on the host", applied.photos?.stored === 8, JSON.stringify(applied.photos));
    const s2 = await state();
    ok("roster now uses gamer_ids", s2.players.map((p) => p.id).join(",") === "ARJUN01,BHAVYA02,CHIRAG03,DIVYA04,ESHA05,FARAH06,GAURAV07,HINA08");

    const avatar = await fetch(`${BASE}/api/avatar/ARJUN01`);
    ok("photo served by /api/avatar", avatar.status === 200 && avatar.headers.get("content-type") === "image/png", `${avatar.status} ${avatar.headers.get("content-type")}`);
    const missing = await fetch(`${BASE}/api/avatar/NOBODY99`);
    ok("unknown avatar 404s", missing.status === 404);
    const traversal = await fetch(`${BASE}/api/avatar/${encodeURIComponent("../state")}`);
    ok("path traversal in the avatar id is refused", traversal.status === 404, String(traversal.status));

    // csv path
    const csv = "photo,name,gamer_id,pot\n,Arjun,ARJUN01,1\n,Bhavya,BHAVYA02,1\n,Chirag,CHIRAG03,1\n";
    const csvPreview = await post(Buffer.from(csv), "?dryRun=1");
    ok("csv import works (no photos)", csvPreview.ok === true && csvPreview.rows.every((r) => !r.hasImage), csvPreview.error);
    ok("csv reports a missing photo per row", csvPreview.warnings.filter((w) => /no photo/.test(w)).length === 3);

    const junk = await post(Buffer.from("nickname,pot\nx,1\n"), "?dryRun=1");
    ok("a file with no name column is rejected clearly", junk.status === 400 && /name column/.test(junk.error || ""), junk.error);
  }

// ==========================================================
    // Top-16 knockout: TWO ceremonies, every round fully drawn.
    // Ceremony #1 = 8 R16 ties + 4 QF ties whose R16->QF feeding is
    // one of the 105 possible schemes, drawn at random (NOT the old
    // sequential R16-01 v R16-02, R16-03 v R16-04, ...).
    // Ceremony #2 = 2 SFs drawn from the QF winners + the fixed Final.
    // This is the event format actually in use, and nothing covered it.
    // ==========================================================
    section("Top-16 knockout: R16 + QF in ONE ceremony, feeding drawn");
    {
      const P16 = Array.from({ length: 16 }, (_, i) => ({ id: `t-${i + 1}`, name: `T${i + 1}`, pot: Math.floor(i / 4) + 1 }));
      await control({ action: "reset" });
      ok("Top-16: roster of 16 across 4 pots",
        (await control({ action: "roster", players: P16 })).ok);
      ok("Top-16: switch to 16 qualifiers, K=3",
        (await control({ action: "settings", qualifiers: 16, matchesPerPlayer: 3 })).ok);

      // a complete 24-tie league (6 pot-pairs x 4 ties), all played
      const pots = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
      const league = [];
      let n = 0;
      for (let x = 0; x < 4; x++) for (let y = x + 1; y < 4; y++) {
        for (let k = 0; k < 4; k++) {
          n++;
          league.push({
            id: `MD${n}`, stage: "league", matchday: x * 3 + y - 1,
            playerA: `t-${pots[x][k] + 1}`, playerB: `t-${pots[y][k] + 1}`,
            scoreA: (k + x + y) % 3, scoreB: (k + y) % 2, played: true,
            editedAt: new Date().toISOString(), editedBy: "E2E",
          });
        }
      }
      await control({ action: "import", state: { ...(await state()), league, knockout: [], players: P16, qualifiers: 16, matchesPerPlayer: 3 } });

      // ---- ceremony #1: R16 drawn, QF feeding drawn ----
      const r16 = drawKnockoutRound(P16.map((p) => p.id), "r16");
      const qf = buildFixedNextRound(r16.map((m) => m.id), "qf");
      ok("ceremony #1 stages the 8 R16 ties AND the 4 QF ties together",
        r16.length === 8 && qf.length === 4 &&
        (await control({ action: "stageDraw", kind: "ko1", matches: [...r16, ...qf] })).ok);
      await control({ action: "drawControl", which: "revealAll" });
      ok("confirm ceremony #1", (await control({ action: "confirmDraw" })).ok);

      let st = await state();
      const qfLive = st.knockout.filter((m) => m.stage === "qf");
      const feeders = qfLive.flatMap((m) => m.feedsFrom);
      ok("QF feeding is DRAWN, not sequential: each QF names two DISTINCT R16 ties",
        qfLive.every((m) => m.feedsFrom[0] !== m.feedsFrom[1]));
      ok("QF feeding uses all 8 R16 ties exactly once",
        new Set(feeders).size === 8 && feeders.every((f) => r16.some((r) => r.id === f)),
        feeders.join(","));
      ok("QF ties are placeholders until their R16 ties are won",
        qfLive.every((m) => m.playerA.startsWith("W(") && m.playerB.startsWith("W(")));

      // ---- play the R16, then the QFs ----
      for (const m of st.knockout.filter((x) => x.stage === "r16")) await score(m.id, 2, 1);
      st = await state();
      const qfAfter = st.knockout.filter((m) => m.stage === "qf");
      const r16Win = new Map(st.knockout.filter((x) => x.stage === "r16")
        .map((m) => [m.id, m.scoreA > m.scoreB ? m.playerA : m.playerB]));
      // Resolve before asserting: the RAW QF rows deliberately keep W(...) sides
      // (that is what the UI then renders). Only the resolved view has real players.
      const qfResolvedAfter = resolve(st.knockout).filter((m) => m.stage === "qf");
      ok("each QF resolved from its OWN drawn feeders",
        qfResolvedAfter.every((m) => m.playerA === r16Win.get(m.feedsFrom[0]) && m.playerB === r16Win.get(m.feedsFrom[1])),
        qfResolvedAfter.map((m) => `${m.playerA} v ${m.playerB}`).join(" | "));
      ok("raw QF rows keep their W(...) sides, as the UI expects",
        qfAfter.every((m) => m.playerA.startsWith("W(")));
      for (const m of qfAfter) await score(m.id, 3, 1);

      // ---- ceremony #2: SF drawn from the QF winners, Final fixed ----
      st = await state();
      // Winners must come from the RESOLVED bracket. The raw rows deliberately keep
      // W(...) sides on purpose, so reading them here produced SF ties full of
      // placeholders with no feedsFrom — which the server stored and could never
      // score. app/owner/page.tsx uses derived.knockout, which is resolved.
      const qfResolved = resolve(st.knockout).filter((m) => m.stage === "qf");
      const qfWinners = qfResolved.map((m) => (m.scoreA > m.scoreB ? m.playerA : m.playerB));
      ok("QF winners resolve to real players, not placeholders",
        qfWinners.length === 4 && qfWinners.every((w) => typeof w === "string" && !w.startsWith("W(")),
        qfWinners.join(","));
      ok("all 4 QF ties decided", st.knockout.filter((m) => m.stage === "qf").every((m) => m.played));
      // a later round posted with placeholder sides is refused, not stored
      const junkSf = [{
        id: "SF-01", stage: "sf", playerA: "W(R16-01)", playerB: "W(R16-02)",
        feedsFrom: null, scoreA: null, scoreB: null, played: false,
      }];
      const junk = await control({ action: "stageDraw", kind: "ko2", matches: junkSf });
      ok("a tie with placeholder sides and NO feeders is REFUSED", junk.ok === false && /no feeders/.test(junk.error || ""), JSON.stringify(junk));
      ok("the refused draw left the bracket untouched",
        (await state()).knockout.filter((m) => m.stage === "sf").every((m) => !m.played));

      const sf = drawKnockoutRound(qfWinners, "sf");
      const fin = buildFixedNextRound(sf.map((m) => m.id), "final");
      ok("ceremony #2 stages 2 SFs + the Final",
        (await control({ action: "stageDraw", kind: "ko2", matches: [...sf, ...fin] })).ok);
      await control({ action: "drawControl", which: "revealAll" });
      ok("confirm ceremony #2", (await control({ action: "confirmDraw" })).ok);

      st = await state();
      ok("SF pairings are built from the QF winners",
        sf.every((m) => qfWinners.includes(m.playerA) && qfWinners.includes(m.playerB)));
      ok("the Final is still W(SF-01) v W(SF-02)",
        st.knockout.find((m) => m.id === "FINAL-01")?.playerA === "W(SF-01)");
      for (const m of st.knockout.filter((x) => x.stage === "sf")) await score(m.id, 2, 1);
      st = await state();
      const finalRaw = st.knockout.find((m) => m.id === "FINAL-01");
      const final = resolve(st.knockout).find((m) => m.id === "FINAL-01");
      ok("the Final resolved to the two SF winners (in the resolved view)",
        !final.playerA.startsWith("W(") && !final.playerB.startsWith("W("),
        `${final.playerA} v ${final.playerB}`);
      ok("the raw Final row keeps W(SF-01) v W(SF-02) until it is scored",
        finalRaw.playerA === "W(SF-01)" && finalRaw.playerB === "W(SF-02)");
      ok("the 3rd-place match appeared automatically", st.knockout.some((m) => m.stage === "third"));
      await score("FINAL-01", 3, 1);
      await score(st.knockout.find((m) => m.stage === "third").id, 1, 2);
      st = await state();
      ok("Top-16 completed: the final is decided", st.knockout.find((m) => m.id === "FINAL-01").played);
      ok("Top-16 completed: the 3rd-place match is decided",
        st.knockout.find((m) => m.stage === "third").played);

      // leave the server on the Top-8 demo roster the rest of the suite expects
      await control({ action: "reset" });
      await control({ action: "settings", qualifiers: 8, matchesPerPlayer: 2 });
      await control({ action: "roster", players: NAMES.map((nn, i) => ({ id: `p-${i + 1}`, name: nn, pot: 1 })) });
    }

  section("projector page selection");
  {
    // reset so the group stage can be drawn fresh
    await control({ action: "reset" });
    await control({
      action: "roster",
      players: Array.from({ length: 8 }, (_, i) => ({ id: `p-${i + 1}`, name: `P${i + 1}`, pot: 1 })),
    });
    const md = [1, 2, 3].flatMap((d) =>
      Array.from({ length: 4 }, (_, i) => ({
        id: `MD${d}-${String(i + 1).padStart(2, "0")}`, stage: "league", matchday: d,
        playerA: `p-${i * 2 + 1}`, playerB: `p-${i * 2 + 2}`, scoreA: null, scoreB: null, played: false,
      }))
    );
    await control({ action: "stageDraw", kind: "league", matches: md });
    await control({ action: "drawControl", which: "revealAll" });
    await control({ action: "confirmDraw" });
    let s2 = await state();
    ok("confirming the group draw starts on matchday 1 + table",
      JSON.stringify(s2.projection.pages) === '["md1","table"]', JSON.stringify(s2.projection.pages));

    const set = await control({ action: "projection", pages: ["md2", "md3", "table"] });
    ok("owner can tick several pages", set.ok && JSON.stringify((await state()).projection.pages) === '["md2","md3","table"]');

    const junk = await control({ action: "projection", pages: ["md1", "../../etc/passwd", "zzz", 42, "table"] });
    s2 = await state();
    ok("junk page ids are filtered server-side", JSON.stringify(s2.projection.pages) === '["md1","table"]', JSON.stringify(s2.projection.pages));

    await control({ action: "projection", pages: [] });
    s2 = await state();
    ok("unticking everything stores an empty selection", JSON.stringify(s2.projection.pages) === "[]");

    // knock the group stage out, then draw the knockout: bracket only
    for (const m of (await state()).league) await score(m.id, 1, 0);
    const q = (await state()).players.slice(0, 8).map((p) => p.id);
    const qf = Array.from({ length: 4 }, (_, i) => ({
      id: `QF-${String(i + 1).padStart(2, "0")}`, stage: "qf",
      playerA: q[i * 2], playerB: q[i * 2 + 1], scoreA: null, scoreB: null, played: false,
    }));
    const sf = Array.from({ length: 2 }, (_, i) => ({
      id: `SF-${String(i + 1).padStart(2, "0")}`, stage: "sf",
      playerA: `W(${qf[i * 2].id})`, playerB: `W(${qf[i * 2 + 1].id})`,
      feedsFrom: [qf[i * 2].id, qf[i * 2 + 1].id], scoreA: null, scoreB: null, played: false,
    }));
    await control({
      action: "stageDraw", kind: "ko1",
      matches: [...qf, ...sf, { id: "FINAL-01", stage: "final", playerA: "W(SF-01)", playerB: "W(SF-02)", feedsFrom: ["SF-01", "SF-02"], scoreA: null, scoreB: null, played: false }],
    });
    await control({ action: "drawControl", which: "revealAll" });
    await control({ action: "confirmDraw" });
    s2 = await state();
    ok("confirming the knockout resets the selection to bracket-only",
      JSON.stringify(s2.projection.pages) === "[]", JSON.stringify(s2.projection.pages));

    await control({ action: "projection", pages: ["table"] });
    s2 = await state();
    ok("the table can be opted back in during the knockout", JSON.stringify(s2.projection.pages) === '["table"]');
  }

  section("results screen");
  {
    const ROSTER = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"];

    // A "what is the projector showing" probe that mirrors lib/screenPlaylist.ts
    const plan = async () => {
      const s = await state();
      if (s.pendingDraw) return "ceremony";
      const finalDone = s.knockout.some((m) => m.stage === "final" && m.played);
      const thirdDone = s.knockout.some((m) => m.stage === "third" && m.played);
      if (finalDone && thirdDone && !s.resultsSuppressed) return "results";
      return s.knockout.length > 0 ? "knockout" : "group";
    };

    await control({ action: "reset" });
    await control({
      action: "roster",
      players: ROSTER.map((n) => ({ id: n, name: `Player ${n}`, pot: 1 })),
    });

    // group stage
    const md = Array.from({ length: 4 }, (_, i) => ({
      id: `MD1-0${i + 1}`, stage: "league", matchday: 1,
      playerA: ROSTER[i * 2], playerB: ROSTER[i * 2 + 1],
      scoreA: null, scoreB: null, played: false,
    }));
    await control({ action: "stageDraw", kind: "league", matches: md });
    await control({ action: "drawControl", which: "revealAll" });
    await control({ action: "confirmDraw" });
    for (const m of md) await score(m.id, 2, 0);
    ok("group stage does not show the results", (await plan()) === "group", await plan());

    const early = await control({ action: "results", suppressed: false });
    ok("results switch rejected before the final", early.status === 409, `got ${early.status}`);

    // knockout
    const qf = Array.from({ length: 4 }, (_, i) => ({
      id: `QF-0${i + 1}`, stage: "qf", playerA: ROSTER[i * 2], playerB: ROSTER[i * 2 + 1],
      scoreA: null, scoreB: null, played: false,
    }));
    const sf = Array.from({ length: 2 }, (_, i) => ({
      id: `SF-0${i + 1}`, stage: "sf", playerA: `W(${qf[i * 2].id})`, playerB: `W(${qf[i * 2 + 1].id})`,
      feedsFrom: [qf[i * 2].id, qf[i * 2 + 1].id], scoreA: null, scoreB: null, played: false,
    }));
    const fin = { id: "FINAL-01", stage: "final", playerA: "W(SF-01)", playerB: "W(SF-02)", feedsFrom: ["SF-01", "SF-02"], scoreA: null, scoreB: null, played: false };
    await control({ action: "stageDraw", kind: "ko1", matches: [...qf, ...sf, fin] });
    await control({ action: "drawControl", which: "revealAll" });
    await control({ action: "confirmDraw" });
    ok("knockout drawn, still not the results", (await plan()) === "knockout", await plan());

    for (const m of qf) await score(m.id, 2, 1);
    const sf2Sides = resolve((await state()).knockout).find((m) => m.id === "SF-02");
    await score("SF-01", 2, 0);
    await score("SF-02", 1, 1, { penaltyWinner: sf2Sides.playerB });
    ok("final played but 3rd place outstanding: NOT results", (await plan()) === "knockout", await plan());
    const midBlocked = await control({ action: "results", suppressed: false });
    ok("results switch rejected with the final only", midBlocked.status === 409, `got ${midBlocked.status}`);

    await score("FINAL-01", 3, 2);
    const withFinal = await state();
    const third = withFinal.knockout.find((m) => m.stage === "third");
    ok("3rd-place tie auto-created once both SFs are decided", !!third);
    if (third) await score(third.id, 1, 0);
    ok("final + 3rd place played: results ON by default", (await plan()) === "results", await plan());

    const off = await control({ action: "results", suppressed: true });
    ok("owner can hold the results back", off.ok === true);
    ok("held back -> the bracket shows instead", (await plan()) === "knockout", await plan());
    const on = await control({ action: "results", suppressed: false });
    ok("owner can bring the results back", on.ok === true);
    ok("results restored", (await plan()) === "results", await plan());

    // a staged draw must outrank the results screen
    await control({ action: "stageDraw", kind: "ko1", matches: qf });
    ok("a staged draw outranks the results screen", (await plan()) === "ceremony", await plan());
    await control({ action: "cancelDraw" });
    ok("cancelled -> results again", (await plan()) === "results", await plan());
  }

  section("access control");
  if (OWNER_PIN) {
    const noPin = await control({ action: "projection", matchday: 1 }, {});
    ok("control rejected with no owner code", noPin.status === 403, `got ${noPin.status}`);
    const wrongPin = await control({ action: "projection", matchday: 1 }, { "x-owner-pin": "definitely-wrong" });
    ok("control rejected with a wrong owner code", wrongPin.status === 403, `got ${wrongPin.status}`);
    const rightPin = await control({ action: "projection", matchday: 1 });
    ok("control accepted with the right owner code", rightPin.status === 200, `got ${rightPin.status}`);
    // the projector code must NOT be able to draw / reset anything
    if (SCREEN_PIN) {
      const asScreen = await control({ action: "projection", matchday: 1 }, { "x-screen-pin": SCREEN_PIN });
      ok("projector code cannot authorise control", asScreen.status === 403, `got ${asScreen.status}`);
      const screenAuth = await fetch(`${BASE}/api/screen-auth`, { method: "POST", headers: { "x-screen-pin": SCREEN_PIN } })
        .then((r) => r.json());
      ok("projector code passes the screen check", screenAuth.ok === true);
      const screenWrong = await fetch(`${BASE}/api/screen-auth`, { method: "POST", headers: { "x-screen-pin": "nope" } })
        .then((r) => r.json());
      ok("wrong projector code fails the screen check", screenWrong.ok === false);
    }
  } else {
    ok("no owner code configured — control open (set OWNER_PIN before the event)", true);
  }
  ok("tournament data survived the probe", (await state()).knockout.length > 0);

  // ==========================================================
  // hydration — what the SERVER sends must not contain values
  // that only exist in the browser, or React discards the HTML
  // and re-renders that subtree (remounting controls, and in
  // dev logging "Hydration failed"). These are static HTML
  // checks, so they hold for any build.
  // ==========================================================
  section("hydration: server HTML carries no browser-only values");
  {
    const home = await fetch(`${BASE}/`).then((r) => r.text());
    ok("the / share link is NOT in the served HTML", !home.includes("with your team"));
    ok("the / share link is not half-rendered either", !/Share\s*<code[^>]*>http:\/\/(?!<\/)/.test(home));

    const ed = await fetch(`${BASE}/editor`).then((r) => r.text());
    ok("the editor queue badge is NOT in the served HTML", !/\d+ queued<\/span>/.test(ed));

    const ow = await fetch(`${BASE}/owner`).then((r) => r.text());
    ok("the owner device label is NOT in the served HTML", !/this device\s*[A-Za-z0-9?]{3,}/.test(ow));
    ok("the owner header does not leak a random device id", !/this device\s*\?{2,}/.test(ow));
  }

  // ==========================================================
  // config staleness + live tournament name
  // ==========================================================
  section("config staleness + live name");
  {
    // A freshly built server must read as clean, or the warning loses credibility.
    const pub = await fetch(`${BASE}/api/config`).then((r) => r.json());
    const pubText = JSON.stringify(pub);
    ok("/api/config is reachable without a code", typeof pub.configStale === "boolean");
    ok("a clean build is not reported as stale", pub.configStale === false, JSON.stringify(pub));
    ok("public /api/config leaks no diffs", pub.configDiffs === undefined);
    ok("public /api/config never contains a PIN", !/\d{4,}/.test(pubText), pubText);

    const priv = await fetch(`${BASE}/api/config`, { headers: ownerHeader }).then((r) => r.json());
    ok("owner gets the diff list (empty when fresh)", Array.isArray(priv.configDiffs));
    ok("owner response still never contains a PIN", !/\d{4,}/.test(JSON.stringify(priv)));

    const wrongPin = await fetch(`${BASE}/api/config`, { headers: { ...J, "x-owner-pin": "definitely-wrong" } })
      .then((r) => r.json());
    ok("a wrong owner code gets no diffs", wrongPin.configDiffs === undefined);
    ok("a wrong owner code still gets the boolean", typeof wrongPin.configStale === "boolean");
  }

  // rename: owner-only, validated, and visible everywhere within one poll
  {
    const before = (await state()).tournamentName;
    ok("state carries a tournament name", typeof before === "string" && before.length > 0, String(before));

    ok("rename with a wrong owner code is rejected",
      (await control({ action: "name", name: "HACKED" }, { ...J, "x-owner-pin": "wrong" })).status === 403);
    ok("state unchanged after the rejected rename", (await state()).tournamentName === before);

    ok("rename with no name is rejected", (await control({ action: "name", name: "   " })).status === 400);
    ok("blank name never reached the state", (await state()).tournamentName === before);
    ok("over-long name is rejected", (await control({ action: "name", name: "x".repeat(61) })).status === 400);
    ok("control chars are stripped, not stored",
      (await control({ action: "name", name: "  NEXUS\u0000  LIVE  " })).ok);
    ok("the cleaned name is what got stored", (await state()).tournamentName === "NEXUS LIVE");

    // The name is rendered from polled state, so server-rendered HTML cannot
    // contain it (it renders "…" until the first poll lands). What we CAN prove
    // over HTTP — and what actually matters — is that no CLIENT bundle still
    // hard-codes the name. If someone re-adds TOURNAMENT_NAME to a component,
    // that component's chunk starts containing the string again and this fails.
    for (const path of ["/", "/screen", "/editor", "/owner"]) {
      const html = await fetch(`${BASE}${path}`).then((r) => r.text());
      const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      ok(`${path} ships scripts`, srcs.length > 0, `${srcs.length} scripts`);
      let baked = [];
      for (const src of srcs) {
        const js = await fetch(new URL(src, BASE)).then((r) => r.text()).catch(() => "");
        if (js.includes("NEXUS LIVE") || (before && js.includes(before))) baked.push(src);
      }
      ok(`${path} does not hard-code the name in its client bundle`, baked.length === 0, baked.join(","));
    }

    // And the value really is on the wire for those clients to pick up.
    const afterRename = (await state()).tournamentName;
    ok("the renamed value is what every client polls for", afterRename === "NEXUS LIVE");

    // a reset must not rename the event (the name is a display setting, not progress)
    await control({ action: "name", name: "Survives A Reset" });
    ok("rename before reset", (await state()).tournamentName === "Survives A Reset");
    await control({ action: "reset" });
    ok("the name SURVIVES a reset", (await state()).tournamentName === "Survives A Reset",
      String((await state()).tournamentName));
    ok("the reset really did clear the tournament", (await state()).knockout.length === 0);

    // The whole point of the bug report: after a reset, "Apply players" works again.
    const mk = (names) => names.map((n, i) => ({ id: `p-${i + 1}`, name: n, pot: 1 }));
    ok("roster is replaceable again after a reset",
      (await control({ action: "roster", players: mk(["R1", "R2", "R3", "R4"]) })).ok);
    ok("the new roster is live", (await state()).players.map((p) => p.name).join(",") === "R1,R2,R3,R4");
    ok("Apply-players path works: a draw can follow", (await control({
      action: "stageDraw", kind: "league", matches: [
        { id: "MD1-01", stage: "league", matchday: 1, playerA: "p-1", playerB: "p-2" },
        { id: "MD1-02", stage: "league", matchday: 1, playerA: "p-3", playerB: "p-4" },
      ] })).ok);
    ok("and the roster locks again once a draw exists",
      (await control({ action: "roster", players: mk(["X1", "X2", "X3", "X4"]) })).status === 409);

    // a malformed roster must be refused, not stored.
    // Reset first: a locked roster 409s before validation is even reached,
    // which is correct behaviour but would mask these checks.
    await control({ action: "reset" });
    ok("a roster of bare strings is rejected", (await control({ action: "roster", players: ["a", "b"] })).status === 400);
    ok("a roster missing a name is rejected",
      (await control({ action: "roster", players: [{ id: "p-1" }, { id: "p-2", name: "B" }] })).status === 400);
    ok("a roster with duplicate ids is rejected",
      (await control({ action: "roster", players: [{ id: "x", name: "A" }, { id: "x", name: "B" }] })).status === 400);
    ok("a one-player roster is rejected",
      (await control({ action: "roster", players: [{ id: "p-1", name: "Solo" }] })).status === 400);
    ok("none of the rejected rosters touched the state",
      (await state()).players.map((p) => p.name).join(",") === "R1,R2,R3,R4");

    // put the state back the way the run found it
    ok("restore demo roster", (await control({ action: "roster", players: mk(NAMES) })).ok);
    ok("restore the original name", (await control({ action: "name", name: before })).ok);
    ok("name restored", (await state()).tournamentName === before);
    ok("final state has no half-drawn tournament", (await state()).league.length === 0);
    ok("final state has the demo roster ready for a draw", (await state()).players.length === NAMES.length);

    // put the operator's tournament shape back how we found it
    ok("restore the pre-run qualifiers/K",
      (await control({ action: "settings", qualifiers: wasQualifiers, matchesPerPlayer: wasK })).ok);
    const post = await state();
    ok("qualifiers restored", post.qualifiers === wasQualifiers, `${post.qualifiers} != ${wasQualifiers}`);
    ok("K restored", post.matchesPerPlayer === wasK, `${post.matchesPerPlayer} != ${wasK}`);
  }

  console.log(`\n${fail === 0 ? "ALL E2E CHECKS PASSED" : "E2E FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error("E2E crashed:", e); process.exitCode = 1; });
