#!/bin/bash
# Drive a live Claude Code session with this checkout's plugin loaded, in a Herdr tab.
# The mod suites run inside the CLI's test engine and send no model requests, so they
# cannot catch a mismatch with the live engine; this script exercises the real one.
#
#   live-check.sh start <name> [cwd]   open a tab and start claude with --plugin-dir mod
#   live-check.sh say <name> <text>    submit a prompt or slash command, wait for it to settle
#   live-check.sh read <name> [lines]  print the visible screen (the pane docks on the right)
#   live-check.sh narrow <name> <r>    split the tab so the session keeps ratio r of its width
#   live-check.sh widen <name>         close the split that narrow opened
#   live-check.sh stop <name>          close the tab
#
# Requires Herdr (run from inside a Herdr pane). Model: LIVE_CHECK_MODEL, default sonnet.
# The session runs with bypassed permissions so tool calls are not held for approval.
# Edits under mod/ hot-reload into a running session when the next turn ends.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
state="${LIVE_CHECK_STATE:-${TMPDIR:-/tmp}/whatsup-live-check}"
mkdir -p "$state"
field() { python3 -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1].split("."): v=v[k]
print(v)' "$1"; }
cmd="${1:?usage: live-check.sh start|say|read|narrow|widen|stop <name> ...}"; name="${2:?name}"
case "$cmd" in
  start)
    cwd="$(cd "${3:-$root}" && pwd)"
    tab_json="$(herdr tab create --workspace "${HERDR_WORKSPACE_ID:?run inside a Herdr pane}" --cwd "$cwd" --label "whatsup live check · $name" --no-focus)"
    tab="$(printf '%s' "$tab_json" | field result.tab.tab_id)"
    pane="$(printf '%s' "$tab_json" | field result.root_pane.pane_id)"
    cleanup_start() {
      start_status=$?
      if [ "$start_status" -ne 0 ]; then
        herdr tab close "$tab" >/dev/null || true
        rm -f "$state/$name"
      fi
    }
    trap cleanup_start EXIT
    printf '%s %s\n' "$tab" "$pane" > "$state/$name"
    attempt=1
    while true; do
      if start_output="$(herdr agent start "$name" --kind claude --pane "$pane" --timeout 60000 -- \
        --plugin-dir "$root/mod" --permission-mode bypassPermissions --model "${LIVE_CHECK_MODEL:-sonnet}" 2>&1)"; then
        break
      else
        start_status=$?
      fi
      # Busy means no agent was launched: the new shell may still be initializing.
      # Never retry other errors (a timed-out launch may already have an agent).
      start_error="$(printf '%s' "$start_output" | field error.code 2>/dev/null || true)"
      if [ "$start_error" != agent_pane_busy ] || [ "$attempt" -ge 10 ]; then
        printf '%s\n' "$start_output" >&2
        exit "$start_status"
      fi
      sleep 1
      attempt=$((attempt + 1))
    done
    trap - EXIT
    echo "started $name: tab $tab, pane $pane"
    ;;
  say)
    read -r _ pane < "$state/$name"
    # Target the pane, not the name: a plugin reload can clear the agent's name.
    text="${3:?text}"
    if prompt_output="$(herdr agent prompt "$pane" "$text" --wait --timeout "${LIVE_CHECK_TIMEOUT:-180000}" 2>&1)"; then
      :
    else
      prompt_status=$?
      prompt_error="$(printf '%s' "$prompt_output" | field error.code 2>/dev/null || true)"
      # Local slash commands can finish without a lifecycle transition. Herdr
      # reports that as stalled; timeouts and submission errors still fail.
      case "$text:$prompt_error" in
        /*:agent_prompt_stalled) ;;
        *) printf '%s\n' "$prompt_output" >&2; exit "$prompt_status" ;;
      esac
    fi
    sleep "${LIVE_CHECK_SETTLE:-2}"
    ;;
  read)
    read -r _ pane < "$state/$name"
    herdr pane read "$pane" --source visible --lines "${3:-80}"
    ;;
  narrow)
    read -r _ pane < "$state/$name"
    herdr pane split "$pane" --direction right --ratio "${3:?ratio}" --no-focus | field result.pane.pane_id > "$state/$name.split"
    sleep 2
    ;;
  widen)
    herdr pane close "$(cat "$state/$name.split")" >/dev/null; rm -f "$state/$name.split"
    sleep 2
    ;;
  stop)
    read -r tab _ < "$state/$name"
    herdr tab close "$tab" >/dev/null; rm -f "$state/$name" "$state/$name.split"
    echo "closed $tab"
    ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
