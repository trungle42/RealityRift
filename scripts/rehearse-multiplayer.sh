#!/usr/bin/env bash
# Three-laptop rehearsal on one Mac: a "host" and two "teammate" stacks, each with its own backend and game, all meeting on
# the host's presence relay, so networked play can be tried before Windows laptops join for real.
#
#   ./scripts/rehearse-multiplayer.sh                 three stacks + three browser tabs (Trung red, Rishaan blue, haicil yellow)
#   ./scripts/rehearse-multiplayer.sh --harness       also open tests/multiplayer.html (automatic checks against the host relay)
#   ./scripts/rehearse-multiplayer.sh --no-browser    start the stacks only and print the URLs
#
# Ports: host backend :8061 + game :5261, teammates :8062/:5262 and :8063/:5263. All backends run OFFLINE=1 (no Gemini key
# needed, scripted story), no tracker and no tunnel. Ports 8000 and 5173 are never touched. If one of the rehearsal ports is
# already in use the script stops before starting anything. Ctrl-C stops only what this script started. Logs: a temp folder.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
browser=1 harness=0
for arg in "$@"; do
  case "$arg" in
    --no-browser) browser=0 ;;
    --harness) harness=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

fail() { echo "rehearse: $*" >&2; exit 1; }
up() { curl -fsS --max-time 2 "$1" >/dev/null 2>&1; }
[[ -x "$repo_root/backend/.venv/bin/python" ]] || fail "backend/.venv is missing. Set it up once: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
[[ -x "$repo_root/frontend/node_modules/.bin/vite" ]] || fail "frontend/node_modules is missing. Install it once: cd frontend && npm install"
grep -q "presence" "$repo_root/backend/app/main.py" || fail "this checkout's backend has no presence relay (backend/app/presence.py) yet."
for port in 8061 8062 8063 5261 5262 5263; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then fail "port $port is already in use. Stop whatever runs there (or an earlier rehearsal) and try again."; fi
done

pids=""
stop() {
  trap - EXIT INT TERM
  [[ -z "${pids// /}" ]] && return 0
  echo; echo "Stopping the rehearsal stacks..."
  local pid alive
  for pid in $pids; do kill -TERM "$pid" 2>/dev/null || true; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=""; for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
    [[ -z "$alive" ]] && return 0; sleep 0.5
  done
  for pid in $alive; do kill -KILL "$pid" 2>/dev/null || true; done
}
trap stop EXIT
trap 'exit 130' INT TERM

logs="$(mktemp -d "${TMPDIR:-/tmp}/storybound-rehearsal.XXXXXX")"
wait_up() {
  local url="$1" pid="$2" name="$3" log="$4" tries=0
  until up "$url"; do
    kill -0 "$pid" 2>/dev/null || fail "$name stopped while starting. Log: $log"
    tries=$((tries + 1)); [[ "$tries" -gt 60 ]] && fail "$name did not answer at $url within 30 s. Log: $log"
    sleep 0.5
  done
}

relay="ws://localhost:8061" room="reh"
for n in 1 2 3; do
  api_port=$((8060 + n)) web_port=$((5260 + n))
  (cd "$repo_root/backend" && OFFLINE=1 exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$api_port") >"$logs/backend-$n.log" 2>&1 &
  pids="$pids $!"; wait_up "http://localhost:$api_port/api/health" "$!" "Backend $n" "$logs/backend-$n.log"
  (cd "$repo_root/frontend" && VITE_API_URL="http://localhost:$api_port" exec node_modules/.bin/vite --port "$web_port" --strictPort) >"$logs/game-$n.log" 2>&1 &
  pids="$pids $!"; wait_up "http://localhost:$web_port/" "$!" "Game $n" "$logs/game-$n.log"
done

enc="ws%3A%2F%2Flocalhost%3A8061"
urls=(
  "http://localhost:5261/?presence=$enc&room=$room&name=Trung&wand=red"
  "http://localhost:5262/?presence=$enc&room=$room&name=Rishaan&wand=blue"
  "http://localhost:5263/?presence=$enc&room=$room&name=haicil&wand=yellow"
)
echo
echo "  Relay (host backend):  $relay   room \"$room\""
echo "  Host (Trung, red):     ${urls[0]}"
echo "  Rishaan (blue):        ${urls[1]}"
echo "  haicil (yellow):       ${urls[2]}"
echo "  Checks:                http://localhost:5261/tests/multiplayer.html?relay=$enc"
echo "  Logs:                  $logs"
echo
if [[ "$browser" == 1 ]] && command -v open >/dev/null 2>&1; then
  for url in "${urls[@]}"; do open "$url"; sleep 0.4; done
  [[ "$harness" == 1 ]] && open "http://localhost:5261/tests/multiplayer.html?relay=$enc"
fi
echo "Running. Press Ctrl-C to stop the rehearsal (only these six processes)."
while :; do
  for pid in $pids; do kill -0 "$pid" 2>/dev/null || { echo "rehearse: a stack stopped (pid $pid); logs in $logs"; pids="${pids/$pid/}"; }; done
  sleep 2
done
