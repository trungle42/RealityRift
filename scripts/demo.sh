#!/usr/bin/env bash
# Storybound demo in one command (macOS / Linux): the backend (reachable from the phone), the game, and the cv_2 tracker window.
# Whatever is already running is left alone, and Ctrl-C stops only what this script started.
#
#   ./scripts/demo.sh                                 backend :8000, game :5173, tracker window
#   ./scripts/demo.sh --no-tracker                    no webcam tracker (keyboard and phone only)
#   API_PORT=8020 WEB_PORT=5220 ./scripts/demo.sh     other ports (the game and tracker are pointed at that backend)
#
# Backend and game logs go to a temporary folder (printed at start); the tracker prints slashes and jumps here.
# The Gemini key stays in backend/.env, which this script never reads: the backend loads it itself.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"
tracker=1
for arg in "$@"; do
  case "$arg" in
    --no-tracker) tracker=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

api="http://localhost:$api_port"
web="http://localhost:$web_port"
backend_pid="" web_pid="" tracker_pid=""

up() { curl -fsS --max-time 2 "$1" >/dev/null 2>&1; }
fail() { echo "demo: $*" >&2; exit 1; }

# Only the PIDs recorded below are ever signalled: each is a process this script started (the subshells exec into them).
stop() {
  trap - EXIT INT TERM
  local started="$tracker_pid $web_pid $backend_pid" alive="" pid
  [[ -z "${started// /}" ]] && return 0
  echo
  echo "Stopping what this script started..."
  [[ -n "$tracker_pid" ]] && kill -INT "$tracker_pid" 2>/dev/null || true   # INT lets the tracker release the camera cleanly
  for pid in $web_pid $backend_pid; do kill -TERM "$pid" 2>/dev/null || true; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=""
    for pid in $started; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
    [[ -z "$alive" ]] && return 0
    sleep 0.5
  done
  for pid in $alive; do kill -KILL "$pid" 2>/dev/null || true; done
}
trap stop EXIT
trap 'exit 130' INT TERM

# Wait for a server this script started; give up if it exits or does not answer in time.
wait_up() {
  local url="$1" pid="$2" name="$3" seconds="$4" log="$5" tries=0
  until up "$url"; do
    kill -0 "$pid" 2>/dev/null || fail "$name stopped while starting (port in use?). Log: $log"
    tries=$((tries + 1))
    [[ "$tries" -gt $((seconds * 2)) ]] && fail "$name did not answer at $url within $seconds s. Log: $log"
    sleep 0.5
  done
}

# Decide what to start, and check its setup, before starting anything.
start_backend=1 start_web=1 start_tracker="$tracker"
up "$api/api/health" && start_backend=0
up "$web/" && start_web=0
if [[ "$tracker" == 1 ]] && pgrep -f -- "-m tools.publish" >/dev/null 2>&1; then start_tracker=0; fi
if [[ "$start_backend" == 1 && ! -x "$repo_root/backend/.venv/bin/python" ]]; then
  fail "backend/.venv is missing. Set it up once: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
fi
if [[ "$start_web" == 1 && ! -x "$repo_root/frontend/node_modules/.bin/vite" ]]; then
  fail "frontend/node_modules is missing. Install it once: cd frontend && npm install"
fi
if [[ "$start_tracker" == 1 && ! -x "$repo_root/cv_2/.venv/bin/python" ]]; then
  fail "cv_2/.venv is missing. Set it up once: cd cv_2 && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt (or run with --no-tracker)"
fi

logs=""
if [[ "$start_backend$start_web" != 00 ]]; then
  tmp="${TMPDIR:-/tmp}"
  logs="$(mktemp -d "${tmp%/}/storybound-demo.XXXXXX")"
fi

if [[ "$start_backend" == 1 ]]; then
  echo "Backend: starting on port $api_port, open to the local network for the phone ..."
  (cd "$repo_root/backend" && exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$api_port") >"$logs/backend.log" 2>&1 &
  backend_pid=$!
  wait_up "$api/api/health" "$backend_pid" "The backend" 30 "$logs/backend.log"
else
  echo "Backend: already running at $api, leaving it alone."
fi

if [[ "$start_web" == 1 ]]; then
  echo "Game: starting on port $web_port ..."
  # The dev server `npm run dev` runs, started directly so there is one process to stop.
  (cd "$repo_root/frontend" && VITE_API_URL="$api" exec node_modules/.bin/vite --port "$web_port" --strictPort) >"$logs/frontend.log" 2>&1 &
  web_pid=$!
  wait_up "$web/" "$web_pid" "The game" 30 "$logs/frontend.log"
else
  echo "Game: already running at $web, leaving it alone."
fi

lan_ip="$(curl -fsS --max-time 2 "$api/joystick/info" 2>/dev/null | sed -n 's/.*"lan_ip": *"\([^"]*\)".*/\1/p' || true)"
if curl -fsS --max-time 2 "$api/api/health" 2>/dev/null | grep -Eq '"gemini": ?true'; then story="Gemini storyteller"; else story="scripted story, no Gemini key loaded"; fi
echo
echo "  Game:            $web/   ($story)"
if [[ -n "$lan_ip" ]]; then
  echo "  Phone joystick:  http://$lan_ip:$api_port/joystick   (phone on the same Wi-Fi or hotspot)"
else
  echo "  Phone joystick:  no network address found. Join a Wi-Fi or hotspot, then open http://<laptop-ip>:$api_port/joystick"
fi
[[ "$start_backend" == 0 ]] && echo "                   (if the phone cannot open it, that backend was started without --host 0.0.0.0)"
[[ -n "$backend_pid$web_pid" ]] && echo "  Logs:            $logs"
echo

if [[ "$start_tracker" == 1 ]]; then
  echo "Tracker: starting the webcam window (macOS asks for camera access the first time) ..."
  (cd "$repo_root/cv_2" && exec .venv/bin/python -m tools.publish --window --api "$api") &
  tracker_pid=$!
elif [[ "$tracker" == 1 ]]; then
  echo "Tracker: one is already running, leaving it alone."
fi

echo "Running. Press Ctrl-C to stop what this script started."
while :; do
  if [[ -n "$tracker_pid" ]] && ! kill -0 "$tracker_pid" 2>/dev/null; then
    wait "$tracker_pid" 2>/dev/null || true
    tracker_pid=""
    echo "demo: the tracker stopped (its messages are above). The backend and game keep running; Ctrl-C to stop."
  fi
  if [[ -n "$backend_pid" ]] && ! kill -0 "$backend_pid" 2>/dev/null; then
    backend_pid=""
    echo "demo: the backend stopped. Log: $logs/backend.log"
  fi
  if [[ -n "$web_pid" ]] && ! kill -0 "$web_pid" 2>/dev/null; then
    web_pid=""
    echo "demo: the game server stopped. Log: $logs/frontend.log"
  fi
  sleep 1
done
