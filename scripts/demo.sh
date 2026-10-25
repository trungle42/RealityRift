#!/usr/bin/env bash
# Storybound demo in one command (macOS / Linux): the backend (reachable from the phone), the game, and the cv_2 tracker (no
# window of its own: its camera picture shows inside the game), then the game opens in the default browser.
# Whatever is already running is left alone, and Ctrl-C stops only what this script started.
#
#   ./scripts/demo.sh                                 backend :8000, game :5173, tracker, browser
#   ./scripts/demo.sh --no-tracker --no-browser       no webcam tracker / do not open the browser
#   ./scripts/demo.sh --tune                          first tune the tracker's colours to this camera and room (no keys)
#   ./scripts/demo.sh --tunnel                        phones join over the internet (cloudflared), for Wi-Fi that blocks them
#   ./scripts/demo.sh --color red,blue,yellow         wand colour per player, in order (default yellow): the camera tracks only these
#   API_PORT=8020 WEB_PORT=5220 ./scripts/demo.sh     other ports (the game and tracker are pointed at that backend)
#
# Backend and game logs go to a temporary folder (printed at start); the tracker prints slashes and jumps here.
# The Gemini key stays in backend/.env, which this script never reads: the backend loads it itself.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"
tracker=1 browser=1 tune=0 tunnel=0 colors="${YT_COLORS:-yellow}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-tracker) tracker=0 ;;
    --no-browser) browser=0 ;;
    --tune) tune=1 ;;
    --tunnel) tunnel=1 ;;
    --color|--colors) [[ $# -ge 2 ]] || { echo "--color needs colours, e.g. --color red,blue" >&2; exit 2; }; colors="$2"; shift ;;
    --color=*|--colors=*) colors="${1#*=}" ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done
# Wand colours, one per player in order (player 1's first). The tracker detects only these (YT_COLORS), and the game is told
# the order (?wand=), so each colour drives its own hero. With more than one person in view a whole-picture jump is ambiguous,
# so jump detection is off then.
colors="$(printf '%s' "$colors" | tr 'A-Z' 'a-z' | tr -d ' ')"
seen=","
for c in ${colors//,/ }; do
  case "$c" in red|blue|yellow) ;; *) echo "demo: --color takes red, blue and yellow (got '$c')" >&2; exit 2 ;; esac
  [[ "$seen" == *",$c,"* ]] && { echo "demo: --color lists $c twice" >&2; exit 2; }
  seen="$seen$c,"
done
[[ -n "${colors//,/}" ]] || { echo "demo: --color needs at least one colour" >&2; exit 2; }
jump=1; [[ "$colors" == *,* ]] && jump=0

api="http://localhost:$api_port"
web="http://localhost:$web_port"
backend_pid="" web_pid="" tracker_pid="" tunnel_pid=""
public_url="" public_url_file="$repo_root/backend/.public_url"

# The room code the game, the phones and the tracker share. With --tunnel the phone page is on the internet, so each launch
# gets a fresh random one (6 letters, in the QR link) that a stranger cannot guess; ROOM=... picks one instead.
room="${ROOM:-storybound}"
if [[ "$tunnel" == 1 && -z "${ROOM:-}" ]]; then
  letters=abcdefghjkmnpqrstuvwxyz room=""
  for b in $(od -An -N6 -tu1 /dev/urandom); do room+="${letters:b%${#letters}:1}"; done
fi
[[ "$room" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || { echo "demo: ROOM must be 1-32 letters, digits, - or _" >&2; exit 2; }

up() { curl -fsS --max-time 2 "$1" >/dev/null 2>&1; }
fail() { echo "demo: $*" >&2; exit 1; }

# Only the PIDs recorded below are ever signalled: each is a process this script started (the subshells exec into them).
stop() {
  trap - EXIT INT TERM
  # The tunnel's URL file goes too, but only if it still holds this run's URL.
  if [[ -n "$public_url" && "$(cat "$public_url_file" 2>/dev/null || true)" == "$public_url" ]]; then rm -f "$public_url_file"; fi
  local started="$tracker_pid $tunnel_pid $web_pid $backend_pid" alive="" pid
  [[ -z "${started// /}" ]] && return 0
  echo
  echo "Stopping what this script started..."
  [[ -n "$tracker_pid" ]] && kill -INT "$tracker_pid" 2>/dev/null || true   # INT lets the tracker release the camera cleanly
  for pid in $tunnel_pid $web_pid $backend_pid; do kill -TERM "$pid" 2>/dev/null || true; done
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
cloudflared=""
if [[ "$tunnel" == 1 ]]; then
  cloudflared="$(command -v cloudflared || true)"
  [[ -z "$cloudflared" && -x /opt/homebrew/bin/cloudflared ]] && cloudflared=/opt/homebrew/bin/cloudflared
  [[ -n "$cloudflared" ]] || fail "--tunnel needs cloudflared. Install it once: brew install cloudflared"
fi
if [[ "$start_tracker" == 1 && ! -x "$repo_root/cv_2/.venv/bin/python" ]]; then
  fail "cv_2/.venv is missing. Set it up once: cd cv_2 && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt (or run with --no-tracker)"
fi

# --tune: the colour setup (cv_2 tools.autotune) needs the camera to itself, so it runs first, before the tracker starts.
if [[ "$tune" == 1 ]]; then
  if pgrep -f -- "-m tools.publish" >/dev/null 2>&1; then
    fail "--tune needs the camera, but a tracker (python -m tools.publish) is already running. Stop it (Ctrl-C in its terminal), then run ./scripts/demo.sh --tune again."
  fi
  [[ -x "$repo_root/cv_2/.venv/bin/python" ]] || fail "cv_2/.venv is missing, so the colours cannot be tuned. Set it up once: cd cv_2 && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt"
  echo "Colour setup: follow the prompts in the camera window (no keys to press) ..."
  if ! (cd "$repo_root/cv_2" && YT_COLORS="$colors" .venv/bin/python -m tools.autotune --colors "$colors"); then
    echo "demo: the colour setup did not finish; starting with the colours from before (cv_2/tuned.env if present, else the built-in ones)."
  fi
fi

logs=""
if [[ "$start_backend$start_web" != 00 || "$tunnel" == 1 ]]; then
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

# --tunnel: a Cloudflare quick tunnel to the backend. Its requests arrive from 127.0.0.1, so the backend locks them down by
# their Cloudflare headers (backend/app/tunnel.py): only the phone page and a phone's socket. Never open one to a backend
# without that lockdown (an older one still running), or the API and the camera relay would be on the internet.
if [[ "$tunnel" == 1 ]]; then
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H 'cf-ray: demo-check' "$api/api/health" || true)" == 403 ]] \
    || fail "the backend at $api does not lock down tunnel requests (it runs older code). Stop it, then run ./scripts/demo.sh --tunnel again."
  echo "Tunnel: starting cloudflared so phones can join from any network ..."
  "$cloudflared" tunnel --url "http://127.0.0.1:$api_port" --no-autoupdate >"$logs/tunnel.log" 2>&1 &
  tunnel_pid=$!
  for _ in $(seq 1 80); do
    public_url="$(grep -Eo 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$logs/tunnel.log" | head -n 1 || true)"
    [[ -n "$public_url" ]] && break
    kill -0 "$tunnel_pid" 2>/dev/null || fail "cloudflared stopped while starting. Log: $logs/tunnel.log"
    sleep 0.5
  done
  [[ -n "$public_url" ]] || fail "cloudflared printed no tunnel address within 40 s. Log: $logs/tunnel.log"
  printf '%s\n' "$public_url" >"$public_url_file"
  if ! curl -fsS --max-time 2 "$api/joystick/info" 2>/dev/null | grep -Fq "$public_url"; then
    echo "demo: the backend at $api does not see the tunnel address (started from another folder?): the game's QR code shows"
    echo "      the Wi-Fi address. Give the phones the tunnel link below instead."
  fi
fi

lan_ip="$(curl -fsS --max-time 2 "$api/joystick/info" 2>/dev/null | sed -n 's/.*"lan_ip": *"\([^"]*\)".*/\1/p' || true)"
if curl -fsS --max-time 2 "$api/api/health" 2>/dev/null | grep -Eq '"gemini": ?true'; then story="Gemini storyteller"; else story="scripted story, no Gemini key loaded"; fi
echo
query="?wand=$colors"; [[ "$room" != storybound ]] && query="?room=$room&wand=$colors"
echo "  Game:            $web/$query   ($story)"
if [[ -n "$public_url" ]]; then
  echo "  Phone joystick:  $public_url/joystick$query   (any network; or scan the QR code in the game)"
  echo "  Room:            $room   (new each launch; up to 3 phones)"
elif [[ -n "$lan_ip" ]]; then
  echo "  Phone joystick:  http://$lan_ip:$api_port/joystick$query   (phone on the same Wi-Fi or hotspot)"
else
  echo "  Phone joystick:  no network address found. Join a Wi-Fi or hotspot, then open http://<laptop-ip>:$api_port/joystick"
fi
[[ "$start_backend" == 0 ]] && echo "                   (if the phone cannot open it, that backend was started without --host 0.0.0.0)"
[[ -n "$backend_pid$web_pid" ]] && echo "  Logs:            $logs"
echo

if [[ "$start_tracker" == 1 ]]; then
  echo "Tracker: starting; its camera picture shows in the game's wand panel (macOS asks for camera access the first time) ..."
  echo "         Colours: $colors (players 1-3 in that order)$([[ "$jump" == 0 ]] && echo '; jump is off with several players in view')"
  (cd "$repo_root/cv_2" && YT_COLORS="$colors" YT_JUMP="$jump" exec .venv/bin/python -m tools.publish --api "$api" --room "$room") &
  tracker_pid=$!
elif [[ "$tracker" == 1 ]]; then
  echo "Tracker: one is already running, leaving it alone."
  [[ "$room" != storybound ]] && echo "         It may be on another room: to see it in this game, stop it and run this again (room $room)."
fi
if [[ "$browser" == 1 ]]; then
  if command -v open >/dev/null 2>&1; then open "$web/$query"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$web/$query" >/dev/null 2>&1 || true
  fi
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
  if [[ -n "$tunnel_pid" ]] && ! kill -0 "$tunnel_pid" 2>/dev/null; then
    tunnel_pid=""
    echo "demo: the tunnel stopped, so phones on other networks are cut off. Log: $logs/tunnel.log"
  fi
  if [[ -n "$web_pid" ]] && ! kill -0 "$web_pid" 2>/dev/null; then
    web_pid=""
    echo "demo: the game server stopped. Log: $logs/frontend.log"
  fi
  sleep 1
done
