#!/usr/bin/env bash
# ============================================================
# hub — run the tournament server in the background, headless.
# ------------------------------------------------------------
# Why this exists: `npm start` needs a terminal that stays open.
# Close it (or log out) and the show dies. This installs a macOS
# launchd agent instead, so the hub:
#
#   * starts by itself when you log in
#   * restarts within ~10s if it ever crashes
#   * keeps the Mac awake while serving (phones + projector need it)
#   * writes logs to files you can read after the fact
#   * never needs a terminal window
#
# Usage:  npm run hub -- <command>      (or: bash scripts/hub.sh <command>)
#         bash scripts/hub.sh help
# ============================================================

set -euo pipefail

# --- resolve everything from this script's own location (folder name has spaces)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LABEL="com.efootball.techfest-hub"
PORT=8000
LOG_DIR="$PROJECT_DIR/logs"
TEMPLATE="$PROJECT_DIR/scripts/launchd/$LABEL.plist.template"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI="gui/$(id -u)"

# ---------------------------------------------------------------- pretty output
if [ -t 1 ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
else B=""; R=""; G=""; Y=""; D=""; N=""; fi
say()  { printf '%s==>%s %s\n' "$G$B" "$N" "$*"; }
info() { printf '    %s\n' "$*"; }
dim()  { printf '%s    %s%s\n' "$D" "$*" "$N"; }
warn() { printf '%s  ! %s%s\n' "$Y" "$*" "$N" >&2; }
die()  { printf '%s  ✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# ---------------------------------------------------------------- helpers
loaded()   { launchctl print "$GUI/$LABEL" >/dev/null 2>&1; }
disabled() { launchctl print-disabled "$GUI" 2>/dev/null | grep -q "\"$LABEL\".*true"; }

port_pid() { lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null || true; }

http_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://localhost:$PORT/" 2>/dev/null || echo 000
}

pid_of_hub() {
  launchctl print "$GUI/$LABEL" 2>/dev/null \
    | sed -n 's/^[[:space:]]*pid = \([0-9]*\).*/\1/p' | head -1
}

need_macos() {
  [ "$(uname -s)" = "Darwin" ] || die "hub only supports macOS launchd. Use 'nohup npm start &' elsewhere."
  [ -d "$HOME/Library/LaunchAgents" ] || die "No ~/Library/LaunchAgents on this account."
  # A LaunchAgent needs a GUI login session; a bare ssh shell has none.
  launchctl print "$GUI" >/dev/null 2>&1 \
    || die "No GUI session for uid $(id -u) (common over plain ssh). Log in at the desktop first."
}

# macOS TCC (Privacy & Security) protects ~/Documents, ~/Desktop and ~/Downloads.
# A LaunchAgent is spawned by launchd, NOT by Terminal, so it inherits none of
# Terminal's consent — and the first read of a protected path fails with
# "Operation not permitted". With `next start` that happens while Node is still
# looking for the nearest package.json, so the server dies before it prints
# anything and the log stays empty. Verified: a launchd job can read ~/ and
# /tmp fine, and only ~/Documents is refused.
#
# There is no reliable way to grant a Homebrew node binary folder access (it is
# not a bundle, so it does not appear in System Settings, and brew upgrade
# would lose it). The fix is to keep the project out of those three folders.
in_protected_dir() {
  case "$PROJECT_DIR" in
    "$HOME"/Documents/*|"$HOME"/Documents) return 0 ;;
    "$HOME"/Desktop/*|"$HOME"/Desktop)     return 0 ;;
    "$HOME"/Downloads/*|"$HOME"/Downloads) return 0 ;;
    *) return 1 ;;
  esac
}

die_if_protected() {
  in_protected_dir || return 0
  cat >&2 <<EOF

  ✗ This project sits in a macOS privacy-protected folder, so a background
    service cannot read it.

      $PROJECT_DIR

    ~/Documents, ~/Desktop and ~/Downloads are protected by macOS (TCC). Terminal
    is allowed to read them; a launchd agent is not, because it is not launched
    from your session. 'next start' therefore fails immediately with
    "Operation not permitted" — before it prints anything, which is why the
    log file looks empty.

    Fix: move the project out of that folder, e.g.

      mv "$PROJECT_DIR" "$HOME/efootball-techfest-2027"
      cd "$HOME/efootball-techfest-2027" && npm run hub -- install

    Your data/ (state, avatars) and node_modules/ move with it, so nothing is
    lost. 'hub install' works out all paths from where this script lives, so
    there is nothing else to change.

    (Granting access in System Settings > Privacy & Security is not worth it:
    Homebrew's node is a bare binary that does not appear in that list, and the
    grant is lost on every 'brew upgrade node'.)

EOF
  exit 1
}

node_bin() {
  local n
  n="$(command -v node 2>/dev/null || true)"
  [ -n "$n" ] || die "node not found on PATH. Install Node, or fix PATH, then re-run."
  printf '%s' "$n"
}

# The ONLY place a build happens. Checks the real exit code and never filters the
# build output — a grep like `| grep Compiled` hides failures, which is exactly
# how a half-finished .next/ slips through and `next start` then dies on a
# missing BUILD_ID.
do_build() {
  say "Building (this replaces any running build)"
  cd "$PROJECT_DIR"
  if ! npm run build; then
    warn "npm run build FAILED. Not starting the server — fix the error above first."
    return 1
  fi
  if [ ! -f "$PROJECT_DIR/.next/BUILD_ID" ]; then
    warn "Build reported success but .next/BUILD_ID is missing."
    warn "That means the build was interrupted. Try: rm -rf .next && npm run build"
    return 1
  fi
  dim "build ok (BUILD_ID $(cat "$PROJECT_DIR/.next/BUILD_ID"))"
}

wait_healthy() {
  local tries=40 i code
  for i in $(seq 1 $tries); do
    code="$(http_code)"
    if [ "$code" = "200" ]; then
      dim "serving http://localhost:$PORT/ (HTTP $code)"
      return 0
    fi
    sleep 1
  done
  return 1
}

# Restarting a port-bound server with `kickstart -k` is a race: the job is
# caffeinate -> node next start -> next-server, and signalling the top of that
# tree does not reliably reap the grandchild that still owns the port. The
# outgoing process can then answer requests for several seconds, which shows up
# as confusing "stale config" or stale-state readings straight after a restart.
# Unload, wait for the port to genuinely clear, then load.
wait_port_free() {
  local i
  for i in $(seq 1 20); do
    [ -z "$(port_pid)" ] && return 0
    sleep 0.5
  done
  return 1
}

# bootout -> wait for the port -> bootstrap -> wait for health.
# Reuses the already-loaded plist, so it is only valid once installed.
reload_service() {
  if loaded; then
    launchctl bootout "$GUI/$LABEL" 2>/dev/null || true
    if ! wait_port_free; then
      warn "Port $PORT is still held by PID(s): $(port_pid)"
      warn "Something outside the hub may be running. Try: lsof -ti :$PORT"
      return 1
    fi
  fi
  launchctl enable "$GUI/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$PLIST" || { warn "launchctl bootstrap failed."; return 1; }
  wait_healthy || { show_err_tail; warn "Did not come up."; return 1; }
  return 0
}

show_err_tail() {
  warn "Last 25 lines of logs/server.err.log:"
  [ -f "$LOG_DIR/server.err.log" ] && tail -n 25 "$LOG_DIR/server.err.log" | sed 's/^/      /' || echo "      (no error log yet)"
}

write_plist() {
  [ -f "$TEMPLATE" ] || die "Template missing: $TEMPLATE"
  local node next
  node="$(node_bin)"
  next="$PROJECT_DIR/node_modules/next/dist/bin/next"
  [ -f "$next" ] || die "next binary missing: $next — run 'npm install' in $PROJECT_DIR"

  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
  # | as the sed delimiter (paths contain /), and escape & and | defensively.
  sed -e "s|__PROJECT_DIR__|${PROJECT_DIR//&/\\&}|g" \
      -e "s|__NODE_BIN__|${node//&/\\&}|g" \
      -e "s|__NEXT_BIN__|${next//&/\\&}|g" \
      "$TEMPLATE" > "$PLIST"
  chmod 644 "$PLIST" || true
  dim "wrote $PLIST"
}

# ---------------------------------------------------------------- commands
cmd_install() {
  need_macos
  die_if_protected
  say "Installing the hub as a background service"

  local pids; pids="$(port_pid)"
  if [ -n "$pids" ]; then
    if loaded; then
      dim "port $PORT held by the hub itself — replacing it"
    else
      warn "Port $PORT is already in use by PID(s): $pids"
      warn "Stop that first (e.g. a 'npm start' in another terminal), then re-run."
      die "Not installing."
    fi
  fi

  do_build || exit 1
  write_plist

  if loaded; then launchctl bootout "$GUI/$LABEL" 2>/dev/null || true; sleep 1; fi
  launchctl enable "$GUI/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$GUI" "$PLIST" || die "launchctl bootstrap failed."

  say "Waiting for it to answer"
  if ! wait_healthy; then
    show_err_tail
    die "The agent did not start serving. See the log above; 'hub logs' has more."
  fi

  local hubpid; hubpid="$(pid_of_hub)"
  cat <<EOF

${G}${B}Hub installed.${N}
    URL          http://localhost:$PORT/
    Phones       http://<this-mac's-LAN-IP>:$PORT/editor
    Service      $LABEL (auto-starts at login, restarts if it crashes)
    PID          ${hubpid:-?}
    Logs         $LOG_DIR/server.log
                 $LOG_DIR/server.err.log

    hub status     is it up?
    hub logs       tail the logs
    hub rebuild    after editing config/tournament.config.ts
    hub pause      stop it, and keep it stopped across restarts

  Close this terminal. It keeps running.
EOF
}

cmd_uninstall() {
  need_macos
  say "Removing the hub"
  if loaded; then launchctl bootout "$GUI/$LABEL" 2>/dev/null || true; fi
  launchctl enable "$GUI/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" && dim "removed $PLIST" || true
  say "Done. Logs kept in $LOG_DIR (delete that folder by hand)."
}

cmd_start() {
  need_macos
  die_if_protected
  if [ ! -f "$PLIST" ]; then
    warn "Not installed yet — running the installer instead."
    cmd_install; return
  fi
  say "Starting"
  reload_service || die "Start failed."
  say "Up on http://localhost:$PORT/ (pid $(pid_of_hub))"
}

cmd_stop() {
  need_macos
  if ! loaded; then dim "not running."; return; fi
  say "Stopping (unloading — it will NOT come back at next login; use 'hub resume' to re-enable)"
  launchctl bootout "$GUI/$LABEL" || die "bootout failed."
  dim "stopped"
}

cmd_restart() {
  need_macos
  die_if_protected
  [ -f "$PLIST" ] || die "Not installed. Run: npm run hub -- install"
  say "Restarting"
  reload_service || die "Restart failed."
  say "Up (pid $(pid_of_hub))"
}

# pause = launchctl disable: KeepAlive stops reviving it, and the choice
# survives a reboot, which bootout does not.
cmd_pause() {
  need_macos
  say "Pausing — it will stay off even if it crashes or you reboot"
  launchctl disable "$GUI/$LABEL" || die "disable failed."
  if loaded; then launchctl bootout "$GUI/$LABEL" 2>/dev/null || true; fi
  dim "paused. Bring it back with: npm run hub -- resume"
}

cmd_resume() {
  need_macos
  die_if_protected
  [ -f "$PLIST" ] || die "Not installed. Run: npm run hub -- install"
  say "Resuming"
  launchctl enable "$GUI/$LABEL" || die "enable failed."
  reload_service || die "Resume failed."
  say "Up (pid $(pid_of_hub))"
}

# The documented way to apply a config/tournament.config.ts edit: the values in
# that file are compiled in, so a restart alone is not enough — rebuild too.
cmd_rebuild() {
  need_macos
  die_if_protected
  [ -f "$PLIST" ] || die "Not installed. Run: npm run hub -- install"
  do_build || exit 1
  say "Restarting onto the new build"
  reload_service || die "Rebuild restart failed."

  # Parsed with a case statement, NOT sed. macOS ships BSD sed, which does not
  # support \(a\|b\) alternation in a BRE, so a sed extraction silently never
  # matches there and this check degrades into "always warn".
  local body stale
  body="$(curl -s --max-time 4 "http://localhost:$PORT/api/config" 2>/dev/null || true)"
  case "$body" in
    *'"configStale":true'*)  stale=true ;;
    *'"configStale":false'*) stale=false ;;
    *)                       stale=unknown ;;
  esac
  case "$stale" in
    false) say "Up, and the config is in sync with the build (stale-config banner should be gone)" ;;
    true)  warn "Up, but the server still reports a stale config."
           warn "See the diff on /owner, then run: npm run hub -- rebuild" ;;
    *)     warn "Up, but /api/config did not answer — cannot confirm the config is in sync." ;;
  esac
}

cmd_status() {
  need_macos
  die_if_protected
  if [ -f "$PLIST" ]; then info "installed   yes  ($PLIST)"; else info "installed   no   (run: npm run hub -- install)"; fi
  if disabled; then info "paused      YES (launchctl disabled)"; else info "paused      no"; fi

  if loaded; then
    info "service     running (pid $(pid_of_hub))"
  else
    info "service     not loaded"
  fi

  local code; code="$(http_code)"
  if [ "$code" = "200" ]; then
    info "health      OK  (HTTP $code on http://localhost:$PORT/)"
  elif [ "$code" = "000" ]; then
    info "health      DOWN — nothing answering on port $PORT"
  else
    info "health      HTTP $code (unexpected)"
  fi

  if [ -f "$PROJECT_DIR/data/state.json" ]; then
    info "state       $(wc -l < "$PROJECT_DIR/data/state.json" | tr -d ' ') lines, modified $(date -r "$PROJECT_DIR/data/state.json" '+%Y-%m-%d %H:%M:%S')"
  else
    info "state       no data/state.json yet"
  fi

  local b; b="$(curl -s --max-time 4 "http://localhost:$PORT/api/config" 2>/dev/null || true)"
  case "$b" in
    *'"configStale":true'*)  warn "config      STALE — config/tournament.config.ts changed after the build. Run: npm run hub -- rebuild" ;;
    *'"configStale":false'*) info "config      in sync with the build" ;;
    *)                       info "config      (server not reachable)" ;;
  esac
}

cmd_logs() {
  [ -d "$LOG_DIR" ] || die "No logs yet at $LOG_DIR"
  say "Tailing $LOG_DIR (Ctrl-C to stop)"
  tail -n 40 -f "$LOG_DIR/server.err.log" "$LOG_DIR/server.log"
}

cmd_help() {
  cat <<EOF
${B}hub — run the tournament server in the background${N}

  install     build, install the launchd agent, start it, verify it answers
  status      is it installed / running / healthy? is the config in sync?
  start       start it (bootstraps if it was stopped)
  stop        stop it (unloads; will not auto-start at next login)
  restart     restart it in place
  pause       stop it AND keep it stopped across crashes and reboots
  resume      undo a pause
  rebuild     build, then restart  <-- use after editing tournament.config.ts
  logs        tail the server logs
  uninstall   remove the agent (logs are kept)

  Full:  npm run hub -- <command>
EOF
}

# ---------------------------------------------------------------- dispatch
case "${1:-help}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  pause)     cmd_pause ;;
  resume)    cmd_resume ;;
  rebuild)   cmd_rebuild ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  help|-h|--help) cmd_help ;;
  *) printf '%s' "$R"; cmd_help; exit 1 ;;
esac
