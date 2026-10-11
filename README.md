# Efootball TechFest 2027 — Tournament Hub

UCL-style: group draw (1 per other pot, neutral) → live table → knockout (Top 8 full-fixed / Top 16 R16-fixes-QF + fresh SF) → champion. LAN-hosted, **no internet needed on event day**.

## ★ Three sites, one server

| Route | Who | What it does | Lock |
|---|---|---|---|
| `/` | anyone | **Front door.** Big *Record scores* button + links to everything, plus a live status line ("Group stage running · 8 ties to score"). | open |
| `/editor` | Volunteers, on their **phones** | Record every score. Big tap targets, no keyboard. Empty until the group draw exists. | open |
| `/owner` | You, on the **master laptop** | Setup, draws, the live ceremony, cut-tie resolution, what the projector shows, exports | `OWNER_PIN` |
| `/screen` | **Projector** (or any laptop) | Big-type projection: ceremony, fixtures, table, bracket | `SCREEN_PIN` |

All three working sites read/write **one server-side state file**, so a score typed on one phone appears on every other device *and* the projector within ~1.5s.

```
npm install
npm run serve-lan     # build + start, binds 0.0.0.0:8000
```
Share `http://<host-ip>:8000` as the front door — volunteers get a big *Record scores* button, and `/owner` + `/screen` are one tap away (each asking for its own code). Bookmark `/owner` on the master laptop and `/screen` on the projector.

The status line on the home page comes from the same `planScreen()` state machine the projector uses, so the two can never disagree about what stage the tournament is in.

### VS Code port forwarding (phones off-LAN)
`cd` into the project remotely, then forward **port 8000** (Ports panel → *Forward a Port*). Every route is served through that one tunnel, so `https://<tunnel>/` reaches the phones.
Set **both PINs first** — the tunnel exposes `/owner` too, and the PIN is the only thing guarding draws/reset. The check is server-side, so knowing a URL grants nothing.

## ★ Before the event — one file

> ### ⚠ Editing this file requires a rebuild
> Every value in `config/tournament.config.ts` — **including both PINs** — is
> compiled into the app by `next build`. Nothing reads the file at runtime, on the
> client or the server, so **editing it changes nothing until you rebuild**:
>
> ```bash
> npm run build && npm start      # or just: npm run serve-lan
> ```
>
> With the background service installed, `npm run hub -- rebuild` does the build
> **and** the restart for you, then confirms the banner is gone.
>
> Under `npm run dev` edits apply automatically, which is why this only surprises
> you in production. Your scores and draws live in `data/state.json` and survive
> a rebuild, so it's safe to do during a break.
>
> **If you forget,** `/owner` shows a red banner listing every value that differs
> (old value struck through, new value underneath), `/` shows a one-liner, and
> the phones show a dismissible note. The projector never shows it — that screen
> is audience-facing.
>
> **The exception: the tournament name is live.** It lives in the store, not the
> config, and `/owner` → Projector → **Tournament name** renames every screen in
> ~1.5s with no rebuild. `TOURNAMENT_NAME` in the config is only the initial
> default for a brand-new `data/state.json`.

`config/tournament.config.ts`:
- `OWNER_PIN` / `SCREEN_PIN` — **set these**, or anyone on the tunnel can reset your tournament. Editing them also needs a rebuild.
- `TOURNAMENT_NAME` — the default event name (change it live in `/owner` instead)
- `PLAYERS` — gamer-tags
- `POTS` — `1` = single-pool flexible (manager sets K), `2` = 2 cross-pot games each, `≥3` = UCL (needs equal pots)
- `LEAGUE_MATCHES_PER_PLAYER` — K for 1-pot flexible (default 4)
- `QUALIFIERS_COUNT` — `8` (QF fixes SF+Final) or `16` (R16 fixes QF, fresh SF)
- `THIRD_PLACE` — 3rd-place match (auto-created once both SFs are decided)
- `AVATAR_DIR` / `PLAYER_IMAGES` — player images (see below)

Roster, pots, K, the qualifier count **and the tournament name** can all be changed live from `/owner`. The roster is the only one that locks once you draw.

### Group-stage format matrix
| Pots | Format | Each player plays |
|---|---|---|
| **1** | Single-pool flexible (any N) | **K** distinct opponents (even N = exact K; odd N = K or K−1, K must be even) |
| **2** | 2 even pots | **Exactly 2**, both vs the other pot |
| **≥3** | UCL equal pots | **pots−1**, one per other pot |

## Roster from a spreadsheet
`/owner` → **Export** → *Roster from a spreadsheet*. Upload a `.xlsx` (or `.csv`, or paste a published Sheets CSV URL), review the preview, then **Apply roster**.

Expected columns — order and header wording are flexible:

| Column | Accepted as | Notes |
|---|---|---|
| photo | `photo` `avatar` `picture` `image` `url` | In an `.xlsx`, a **cell-anchored image** (no column needed). In a `.csv`, a URL — Google Drive share links are rewritten to direct image links. |
| name | `name` `player` `gamer` `full name` | required |
| gamer_id | `gamer_id` `gamer id` `gamerid` `id` `uid` | becomes the player's **id** |
| pot | `pot` `pot_no` `pot no.` `group` | integer ≥ 1 |

- **gamer_id becomes the player id**, so a corrected name or a reordered sheet can never orphan a fixture. Ids are sanitised (`/` and dot-runs can't survive), and duplicates get disambiguated with a warning.
- **Photos are pulled out of the file and stored on the host** (`data/avatars/`, served by `/api/avatar/…`), so the projector and every phone work with **no internet at the venue**. Re-upload to change a photo later.
- Anything missing falls back gracefully: no photo → coloured initials on the projector; missing `gamer_id` → generated `p-N` with a warning; uneven pots → warning.
- **Only possible before the first draw** — once fixtures exist they reference player ids, so the roster is locked (enforced server-side on both `/api/roster` and `control.roster`). Reset to change it.
- The manual Setup wizard still works alongside this, for quick testing and typo fixes.

## What the projector shows
`/owner` → **Projector** tab. Tick the pages to rotate through; the panel previews exactly what the audience will see (same function the projector uses).

- **Group stage** — a checkbox per matchday plus `Point Table`. Presets: *All* / *Table only* / *None*. **Untick everything and the Point Table is still shown**, so the projector is never blank.
- **Knockout stage** — the bracket is always shown, single page, no rotation. Tick `Point Table` to add it.
- **A draw ceremony always takes over the screen** while one is running (group or knockout), then the chosen pages resume.
- Confirming the group draw starts you on *Matchday 1 + Point Table*; confirming a knockout draw resets the selection to *bracket only* so the table can't silently start rotating in.
- Keys on the projector: `Space`/`→` next, `←` back, `P` pause.

## Recording a score (phone)
Every result needs an explicit confirmation, so a mis-tap can never reach the table, the bracket or the projector:

1. **Set it** — `−` / `+` per side. This only fills a *local draft*; nothing is sent.
2. **Check it** — the card turns amber with a **NOT SAVED YET** tag and a review strip: `Check: Arjun 2 – 0 Bhavya`.
3. **Confirm FT** — one tap records it, and the tie moves from **To score** to **Done** by itself.

- Confirm is **gated, not silently wrong**: with a side left blank it stays disabled (*set both scores*); a level **knockout** tie shows the two "wins" buttons and stays disabled until one is picked (*pick a winner*). A level **league** match is a real draw and confirms straight away.
- **Drafts survive a killed tab.** Unsaved scores are kept in the phone's `localStorage` and restored if the browser evicts or reloads the page. They are always shown as pending, never applied silently, and are deleted the moment you confirm.
- **To fix a score:** open **Done**, tap `+`/`−` on the tie, then **Update result**.
- **To score only empties when nothing is left to do**: an unscored tie, or a knockout tie still waiting for a winner. A level *league* match counts as finished.
- The server enforces the same rule — a level knockout score without a winner is rejected outright, so a KO tie can never be left "recorded but unresolved".

Same flow on the owner laptop (`/owner` → Knockout), kept as an emergency fallback if a phone dies.

## ★ How the knockout is drawn
Every round is drawn live — nothing is pre-arranged — and the whole bracket is settled in **two
ceremonies** for a 16-player event:

| | Ceremony #1 | Ceremony #2 |
|---|---|---|
| **Top-16** | 8 R16 ties **and** the 4 QF ties together | 2 SFs drawn from the QF winners + the Final |
| **Top-8** | 4 QFs, the 2 SFs and the Final together | — |

The **feeding of one round into the next is drawn too**. Pairing 8 R16 ties into 4 QF ties has
**105** possible schemes and one is picked at random, so the quarter-finals can legitimately come out
as `R16-01 + R16-05`, `R16-02 + R16-03`, or anything else — never pre-set to
`R16-01 + R16-02, R16-03 + R16-04, …`. The same applies to QF→SF (3 schemes). Pairing 2 SFs into the
Final has only **one** way, so the Final stays `W(SF-01) v W(SF-02)`.

Later rounds appear as `Winner R16-03` on the projector rather than a raw `W(R16-03)`, and each tie
is headed by the feeder pair it was drawn from (`QF-02 · from R16-03 + R16-08`).

The server refuses a later round whose ties hold unresolved slots **and** record no feeders — such a
tie could never be scored and could only be cleared by resetting the tournament.

## Results (the closing screen)
Once the tournament is over the projector switches itself to a **podium** then a run of **credit leaderboards**.

- **Unlocks only when the final is decided AND the 3rd-place match has been played** (if `THIRD_PLACE` is off, the final alone is enough). `/owner` → **Projector** shows a **Show results** switch once available, and says what it's waiting for when it isn't. It defaults **ON**; untick it to hold the bracket while you talk, or while the 3rd-place match is still to come. The server refuses to enable it early.
- **Podium** — champion (raised, centred), runner-up, third place, each with photo, name and `gamer_id`, plus a one-shot confetti burst. If the 3rd-place tie was never played, both semi-final losers are credited as joint 3rd with a note.
- **Credits** — a **top-5 leaderboard** per statistic: Top scorer, Best defence, Most wins, Fewest defeats, Most clean sheets, Biggest win, Best goal difference.
  - **Competition ranking** — equal values share a rank and the next rank skips (`1, 2, 3, 3, 5`). Everyone tied on 5th is shown, so a list can run to 6–7 rows (capped at 10, with a `+N more tied` note).
  - Players with **0 matches are excluded** everywhere — otherwise a player who never played would top *fewest conceded* on zeroes. Each row also shows `P` (matches played) so a strong-looking entry from someone who played once is self-explanatory.
  - A **level knockout tie counts as a win for the penalty winner**, not a draw, while the scoreline still feeds goals/conceded.
- Keys: `Space`/`→` next, `←` back, `P` pause, and **`Esc` or "◀ show bracket"** to return to the bracket. That back button is a *local* override for the projector session — the projector holds the screen code, not your owner code, so it deliberately cannot change your setting.

## Player identity on the projector
- **Group stage: photo + `gamer_id`, name withheld.** A missing photo falls back to a neutral disc rather than initials, so `AR` can't give away Arjun.
- **Knockout onwards: photo + name + `gamer_id`** — the name is the reveal.
- `/owner` and the phone editor always show names; the withholding is a projector device, and volunteers need to recognise who's playing.

## ★ Running it in the background (no terminal)
`npm start` needs a terminal that stays open. Close it — or log out — and the
show dies mid-match. On macOS, install a **launchd agent** instead:

```bash
npm run hub -- install     # build, install, start, verify
```

After that you can close every terminal. The hub:
- **starts by itself when you log in**
- **restarts within ~10s if it ever crashes** (verified: `kill -9` → back in ~14s)
- **keeps the Mac awake** while serving, so it can't sleep mid-tournament
- writes everything to `logs/server.log` and `logs/server.err.log`
- **never shows a build error to the audience** — a failed build stops the
  service and prints the error instead of crash-looping

| Command | What it does |
|---|---|
| `npm run hub -- status` | installed? running? healthy? is the config in sync with the build? |
| `npm run hub -- logs` | tail the logs |
| `npm run hub -- rebuild` | **after editing `config/tournament.config.ts`** — build + restart in one step, and confirms the staleness banner is gone |
| `npm run hub -- restart` | restart in place (waits for the port to actually clear first) |
| `npm run hub -- stop` / `start` | stop / start |
| `npm run hub -- pause` / `resume` | switch it off (or on) **and keep it that way across reboots** — `pause` survives a crash, `stop` does not |
| `npm run hub -- uninstall` | remove the agent (logs are kept) |

It is installed at `~/Library/LaunchAgents/com.efootball.techfest-hub.plist`,
generated from `scripts/launchd/*.plist.template` so no machine-specific file is
committed.

### ⚠ The project must not live in ~/Documents, ~/Desktop or ~/Downloads
macOS protects those three folders (TCC). Terminal is allowed to read them, but
a launchd agent is **not** — it isn't launched from your session — so
`next start` dies instantly with `Operation not permitted` *before printing
anything*, which is why the log looks empty. There is no reliable permission
workaround (Homebrew's `node` is a bare binary that doesn't appear in System
Settings, and any grant is lost on `brew upgrade node`). `hub install` detects
this and tells you to move the project, e.g. to `~/efootball-techfest-2027`.
Everything — `data/`, `node_modules/` — moves with it, and `hub install` works
out all paths from where the script lives, so nothing else changes.

Other things worth knowing:
- A `LaunchAgent` runs only in a **GUI login session**, so the hub stops if you
  log out. Stay logged in during the event.
- If you move or rename the project folder, re-run `npm run hub -- install`.
- The LAN/VS Code forwarding setup is unchanged: still `0.0.0.0:8000`.

### What `verify` runs against
| Area | Tested how |
|---|---|
| Group draw + knockout bracket + winner propagation | **the real `lib/draw.ts`** |
| Standings, cut-tie resolution, scoring flow, projector state machine, statistics, roster/xlsx import, config-staleness | **the real modules** |
| Cut-tie resolution (`slotsForTie` / `resolveExternalQualifiers`) | a **mirror** of `lib/table.ts` — it imports `POINTS_WIN`/`POINTS_DRAW` from the config as runtime values, so Node cannot load it yet |

`lib/draw.ts` used to be tested through a hand-written "plain JS mirror" living inside `verify.mjs` — a second
implementation of the draw and bracket logic. That copy could drift from the shipped engine without failing, and
sabotaging `buildFixedNextRound` still passed. `mid` now lives in `draw.ts` so the module has no runtime imports,
which lets the test runner load the real thing. Closing the `lib/table.ts` mirror needs the same treatment.

## Run commands
| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:8000` (hot reload) |
| `npm run build` | Production build |
| `npm start` | Production server on `0.0.0.0:8000` |
| `npm run serve-lan` | `build && start` — event-day hosting, **but needs a terminal that stays open** |
| `npm run hub -- install` | Install the **background** service (macOS) — then you never need a terminal again |
| `npm run verify` | Pure-logic checks — imports the **real** modules (Node strips the types) so tests can't drift from the implementation |
| `npm run e2e` | End-to-end run against a **running** server |
| `npm run verify:all` | Both of the above |
| `node scripts/make-xlsx-fixture.mjs` | Rebuild the roster `.xlsx` test fixture |

### Health check, background & stop
```bash
# background dev server (logs to /tmp/techfest-dev.log)
nohup npm run dev > /tmp/techfest-dev.log 2>&1 &

# health check — expect HTTP:200
curl -s -o /dev/null -w "HTTP:%{http_code}\n" http://localhost:8000/

# stop / kill switch (frees port 8000)
lsof -ti:8000 | xargs kill
# force kill if unresponsive
lsof -ti:8000 -sTCP:LISTEN | xargs kill -9

# keep the host laptop awake — a sleeping host kills the show (macOS)
caffeinate -dimsu
```

## Event flow
1. `/owner` → Setup → **Run group draw** → the projector immediately shows the ceremony.
2. Drive the ceremony: **Reveal next** / **Auto-draw** / **Reveal all** / **Redraw**. You cannot confirm until every tie has been revealed, so the audience always sees the full draw before it's committed. **Confirm** publishes it to the phones.
3. Volunteers record scores at `/editor`. Filter **To score** to work the queue. Level knockout ties turn into two big "wins" buttons.
4. Everyone sees the same table on `/screen`, auto-rotating between the **matchday you selected** and the **point table** (plus the bracket once it exists). Pick the matchday in `/owner` → Projector.
5. Finish the group stage → **Knockout draw #1** (Top 16: **#2** for the SFs) → final → champion + 3rd place.
6. Cut ties at the qualification line resolve **outside** this app (your separate tie-breaker UI): tick the decided qualifier(s) in `/owner` → Setup → Confirm. The KO draw stays locked until exactly 8/16 are settled.

## Projection site states
`/screen` picks the first applicable state, so it never shows a stale or half-built bracket:

1. **Ceremony** — a draw is in progress (group, KO #1 or KO #2), with animation
2. **Results** — the tournament is over and you haven't held them back (see *Results* below)
3. **FIXTURES NOT PREPARED** — nothing drawn yet
4. **The ticked pages** — see *What the projector shows* above
5. **Status card** — only as a last resort if no page is renderable

A draw ceremony outranks the results, so re-drawing after the final never hides a live draw.

Controls: `Space`/`→` next, `←` back, `P` pause. The reveal counter lives on the server, so a projector that connects mid-draw snaps to the current tie.

## Player images (projection showoff)
Resolution order per player: URL from the roster sheet / `PLAYER_IMAGES` → a photo extracted from the spreadsheet and stored on the host (`/api/avatar/…`) → a file in `public/players/` → **coloured monogram**, so a missing or broken image can never disrupt the show.

`/owner` → Export → *Player images* lists exactly which players still need one. Square images crop best.

## Data & sync
- **Source of truth** = the host's `data/state.json` (atomic writes, survives restarts, gitignored). Player photos extracted from the roster sheet live alongside it in `data/avatars/`.
- Clients poll `GET /api/state?since=<revision>`; unchanged → `204`, so an idle phone costs ~0 bytes.
- **Last-write-wins per match**, ordered by the *device's* edit time. A queued edit from a phone that was briefly offline is **rejected** rather than clobbering a fresher score, and the editor is told. The server stamps its own `updatedAt` on receipt so clock drift can't corrupt ordering.
- Scores entered offline are queued in the phone's `localStorage` and retried automatically.
- Sheets is **archival only** (roster/avatar import + CSV export) — nothing polls it during the event.

## Backups & exports
`/owner` → Export: Results CSV, Players CSV, Backup JSON, and JSON import (restores a whole tournament). The state file itself is `data/state.json` — copy it between events.

## Verify
`npm run verify` — runs against the **real** modules (Node strips the types), so the tests cannot drift from the implementation. Group-draw fairness is checked by the engine's own validators: 1-pot flexible (even and odd N), 2-pot cross, and UCL 3/4/5 pots all go through `drawLeague`/`drawTwoPot`/`drawFlexLeague` + `verifyLeague`/`verifyTwoPot`/`verifyMatchdays`/`verifyFlexLeague`. Also the knockout chain (`R16→QF→SF→FINAL`, Final never shows `W(QF-*)`) with the **drawn round-to-round feeding**: `randomPairing` picks one of the 105 ways to pair 8 R16 ties into 4 QF ties (3 ways for 4 ties into 2, 1 way for the Final), and `verify` proves both the reachable count and that every tie names two distinct feeders with all feeders used once, winner propagation for **regular scores as well as pens**, external tie resolution, the screen state machine, the home-page status line, projector page selection, what still needs a human (To score rules + commit gating), draft pruning, tournament statistics (pens = win, clean sheets, biggest margin), **competition ranking + tie-at-5th + row cap**, the podium, `tournamentFinished`, LWW merge rules, revision monotonicity, 3rd-place idempotency, the real `.xlsx` fixture, **config-staleness detection** (parser tolerance, no false positives on comment/whitespace-only edits, commented-out entries ignored, secrets masked to set/empty) and **name validation**.
`npm run e2e` — drives a running server through a whole event: ceremony → scores from three phones → knockout → champion → 3rd place, including the phantom-winner guard, the "level knockout needs a winner" rule, the results screen (invisible before the final, blocked with the final but no 3rd place, on by default once both are done, owner hold/restore, ceremony outranking it), roster import from the xlsx fixture, projector page selection, the `/` launcher, **config staleness + live rename** (a clean build reports clean, the public `/api/config` leaks no diffs and never a PIN, a wrong code gets no diffs, rename is owner-only and validated, the renamed value is what clients poll for, and no client bundle hard-codes the name), and the real access control (it reads `OWNER_PIN`/`SCREEN_PIN` from the config and asserts the gate rejects a missing, wrong and projector-only code).
