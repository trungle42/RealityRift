# Storybound demo in one command (Windows PowerShell): the backend (reachable from the phone), the game, and the cv_2 tracker
# (no window of its own: its camera picture shows inside the game), then the game opens in the default browser.
# Whatever is already running is left alone, and Ctrl-C stops only what this script started.
#
#   .\scripts\demo.ps1                                backend :8000, game :5173, tracker, browser
#   .\scripts\demo.ps1 -NoTracker -NoBrowser          no webcam tracker / do not open the browser
#   .\scripts\demo.ps1 -Tune                          first tune the tracker's colours to this camera and room (no keys)
#   .\scripts\demo.ps1 -Jump rise                     the tracker fires a jump on the way up, not at the landing (experiment)
#   .\scripts\demo.ps1 -Tunnel                        phones join over the internet (cloudflared), for Wi-Fi that blocks them
#   .\scripts\demo.ps1 -Color red,blue,yellow         wand colour per player, in order (default yellow): the camera tracks only these
#   .\scripts\demo.ps1 -Color blue -Name Rishaan -Join https://<words>.trycloudflare.com -Room abcdef
#                                                     join a teammate's game: your own backend, game, tracker and phone; your hero in theirs
#   .\scripts\demo.ps1 -Tunnel -Color red -Name Trung  host one: prints the line each teammate runs
#   .\scripts\demo.ps1 -ApiPort 8020 -WebPort 5220    other ports (the game and tracker are pointed at that backend)
#
# Backend and game logs go to a temporary folder (printed at start); the tracker prints slashes and jumps here.
# The Gemini key stays in backend\.env, which this script never reads: the backend loads it itself.
param(
    [switch]$NoTracker,
    [switch]$NoBrowser,
    [switch]$Tune,
    [switch]$Tunnel,
    [string]$Room = '',
    # string[]: typed in PowerShell, -Color red,blue arrives as an array (a [string] would turn it into "red blue");
    # through powershell -File it arrives as the one string "red,blue". Both are joined and split on commas below.
    [string[]]$Color = @(),
    [string]$Name = '',
    [string]$Join = '',
    [string]$Jump = '',
    [int]$ApiPort = 8000,
    [int]$WebPort = 5173
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# 127.0.0.1, not localhost: the backend listens on IPv4 only, and on some Windows laptops localhost tries IPv6 (::1) first and
# takes ~2 s to fall back, longer than the 2 s health check (so a running backend looked absent) and the tracker's 1 s connect.
$api = "http://127.0.0.1:$ApiPort"
$web = "http://localhost:$WebPort"
# Only these processes are ever stopped: each one was started by this script.
$started = [ordered]@{}
$publicUrl = $null
$publicUrlFile = Join-Path $repoRoot 'backend\.public_url'
# Written while this launcher runs (its pid, room and game link) and removed when it stops, so a second launcher can tell.
$lockFile = Join-Path $repoRoot 'backend\.demo_running'
$locked = $false

# The room code the game, the phones and the tracker share. With -Tunnel the phone page is on the internet, so each launch
# gets a fresh random one (6 letters, in the QR link) that a stranger cannot guess; -Room picks one instead.
# -Join: a teammate's laptop. The host's tunnel link is the meeting point (the presence relay); the room is the host's.
$presence = ''
if ($Join) {
    $m = [regex]::Match($Join, '^(https?)://([A-Za-z0-9.-]+(:[0-9]+)?)')
    if (-not $m.Success) { throw "-Join takes the host's link, e.g. https://<words>.trycloudflare.com" }
    $presence = $(if ($m.Groups[1].Value -eq 'https') { 'wss://' } else { 'ws://' }) + $m.Groups[2].Value
    if (-not $Room) { $r = [regex]::Match($Join, '[?&]room=([A-Za-z0-9_-]+)'); if ($r.Success) { $Room = $r.Groups[1].Value } }
    if (-not $Room -or $Room -eq 'storybound') { throw "-Join needs the host's room code: -Room <code> (printed by the host's demo -Tunnel)" }
}
if (-not $Room) {
    $Room = 'storybound'
    if ($Tunnel) {
        $letters = 'abcdefghjkmnpqrstuvwxyz'
        $bytes = New-Object byte[] 6
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $Room = -join ($bytes | ForEach-Object { $letters[$_ % $letters.Length] })
    }
}
if ($Room -notmatch '^[A-Za-z0-9_-]{1,32}$') { throw '-Room must be 1-32 letters, digits, - or _' }
# Wand colours, one per player in order (player 1's first). The tracker detects only these (YT_COLORS), and the game is told
# the order (?wand=), so each colour drives its own hero. With more than one person in view a whole-picture jump is ambiguous,
# so jump detection is off then.
if (-not $Color) { $Color = @($(if ($env:YT_COLORS) { $env:YT_COLORS } else { 'yellow' })) }
$colorList = @(($Color -join ',').ToLower().Replace(' ', '').Split(',') | Where-Object { $_ })
if ($colorList.Count -eq 0) { throw '-Color needs at least one colour' }
foreach ($c in $colorList) { if ($c -notin @('red', 'blue', 'yellow')) { throw "-Color takes red, blue and yellow (got '$c')" } }
if (@($colorList | Select-Object -Unique).Count -ne $colorList.Count) { throw '-Color lists a colour twice' }
$colors = $colorList -join ','
# $jumpOn, not $jump: PowerShell variables ignore case, so $jump would be the -Jump parameter (full or rise) itself.
$jumpOn = if ($colorList.Count -gt 1) { '0' } else { '1' }
# -Jump rise: the tracker fires a jump on the way up instead of at the landing (an experiment; see cv_2 JumpDetector).
if (-not $Jump) { $Jump = if ($env:YT_JUMP_MODE) { $env:YT_JUMP_MODE } else { 'full' } }
$Jump = $Jump.ToLower()
if ($Jump -notin @('full', 'rise')) { throw "-Jump takes full or rise (got '$Jump')" }
$query = if ($Room -ne 'storybound') { "?room=$Room&wand=$colors" } else { "?wand=$colors" }
# Networked play (presence): this laptop's game shows the other laptops' heroes. Hosting with -Tunnel or -Name turns it on (the
# host's own game meets the others on its own backend); -Join meets them on the host's.
if (-not $presence -and ($Tunnel -or $Name)) { $presence = "ws://localhost:$ApiPort" }
$gameQuery = $query
if ($presence) {
    if (-not $Name) { $Name = if ($env:USERNAME) { $env:USERNAME } else { 'Player' } }
    $Name = (($Name -replace '[^A-Za-z0-9 _-]', '').Trim())
    if ($Name.Length -gt 16) { $Name = $Name.Substring(0, 16) }
    if (-not $Name) { $Name = 'Player' }
    $gameQuery = "$query&presence=$presence&name=$($Name.Replace(' ', '%20'))"
}

function Test-Up([string]$Url) {
    try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Wait-Up([string]$Url, $Process, [string]$Name, [int]$Seconds, [string]$Log) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while (-not (Test-Up $Url)) {
        if ($Process.HasExited) { throw "$Name stopped while starting (port in use?). Log: $Log" }
        if ((Get-Date) -gt $deadline) { throw "$Name did not answer at $Url within $Seconds s. Log: $Log" }
        Start-Sleep -Milliseconds 500
    }
}

# Decide what to start, and check its setup, before starting anything.
$backendPy = Join-Path $repoRoot 'backend\.venv\Scripts\python.exe'
$viteJs = Join-Path $repoRoot 'frontend\node_modules\vite\bin\vite.js'
$trackerPy = Join-Path $repoRoot 'cv_2\.venv\Scripts\python.exe'
$startBackend = -not (Test-Up "$api/api/health")
$startWeb = -not (Test-Up "$web/")
$trackerRunning = $false
if (-not $NoTracker) {
    $trackerRunning = [bool](Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*-m tools.publish*' })
}
$startTracker = (-not $NoTracker) -and (-not $trackerRunning)

# One Storybound per laptop: a second launcher would make a second room (and tunnel) while the first one's tracker keeps
# publishing in the old room, so the game would have no camera. Refuse instead; never touch the other launcher's processes.
if (Test-Path $lockFile) {
    $lock = @{}
    foreach ($line in Get-Content $lockFile) { $kv = $line -split '=', 2; if ($kv.Count -eq 2) { $lock[$kv[0]] = $kv[1] } }
    $other = $null
    if ($lock['pid'] -match '^\d+$') { $other = Get-CimInstance Win32_Process -Filter "ProcessId = $($lock['pid'])" -ErrorAction SilentlyContinue }
    # Run as .\scripts\demo.ps1 inside a PowerShell window, the process is that PowerShell, so trust a live PowerShell pid.
    if ($other -and $other.Name -in @('powershell.exe', 'pwsh.exe')) {
        throw "Storybound is already running (room $($lock['room']), started by another demo.ps1, pid $($lock['pid'])). Press Ctrl-C there first, or open its game: $($lock['game'])   (if nothing is running, delete backend\.demo_running)"
    }
    Remove-Item $lockFile -ErrorAction SilentlyContinue   # left by a launcher that is gone
}
if ($trackerRunning) {
    $line = [string](@(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*-m tools.publish*' })[0].CommandLine)
    $rm = [regex]::Match($line, '--room\s+"?([A-Za-z0-9_-]+)')
    $runningRoom = if ($rm.Success) { $rm.Groups[1].Value } else { 'storybound' }
    if ($runningRoom -ne $Room) { throw "A tracker is already running in room $runningRoom, but this launch uses room $Room, so the game would have no camera. Stop that tracker (Ctrl-C in its window) and run this again, or add -NoTracker." }
}
if ($Tunnel -and @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object { $_.CommandLine -like "*127.0.0.1:$ApiPort*" }).Count -gt 0) {
    throw "A tunnel to this backend is already running (another launcher's). Press Ctrl-C in that launcher first."
}
if ($startBackend -and -not (Test-Path $backendPy)) {
    throw 'backend\.venv is missing. Set it up once: cd backend; py -m venv .venv; .venv\Scripts\pip install -r requirements.txt'
}
if ($startWeb) {
    if (-not (Test-Path $viteJs)) { throw 'frontend\node_modules is missing. Install it once: cd frontend; npm.cmd install' }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js (node) is not on PATH. Install Node 20.19+ and reopen the terminal.' }
}
$cloudflared = $null
if ($Tunnel) {
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cloudflared) { throw '-Tunnel needs cloudflared. Install it once: winget install --id Cloudflare.cloudflared' }
}
if ($startTracker -and -not (Test-Path $trackerPy)) {
    throw 'cv_2\.venv is missing. Set it up once (see cv_2\README.md; Windows on ARM needs the x86_64 Python), or run with -NoTracker.'
}

# -Tune: the colour setup (cv_2 tools.autotune) needs the camera to itself, so it runs first, before the tracker starts.
if ($Tune) {
    $publishRunning = [bool](Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*-m tools.publish*' })
    if ($publishRunning) { throw '-Tune needs the camera, but a tracker (python -m tools.publish) is already running. Stop it (Ctrl-C in its window), then run .\scripts\demo.ps1 -Tune again.' }
    if (-not (Test-Path $trackerPy)) { throw 'cv_2\.venv is missing, so the colours cannot be tuned. Set it up once (see cv_2\README.md; Windows on ARM needs the x86_64 Python).' }
    Write-Host 'Colour setup: follow the prompts in the camera window (no keys to press) ...'
    Push-Location (Join-Path $repoRoot 'cv_2')
    $savedColors = $env:YT_COLORS; $env:YT_COLORS = $colors
    try { & $trackerPy -m tools.autotune --colors $colors; $tuneCode = $LASTEXITCODE } finally { Pop-Location; $env:YT_COLORS = $savedColors }
    if ($tuneCode -ne 0) { Write-Host 'demo: the colour setup did not finish; starting with the colours from before (cv_2\tuned.env if present, else the built-in ones).' }
}

$logs = Join-Path ([IO.Path]::GetTempPath()) ("storybound-demo-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
if ($startBackend -or $startWeb -or $Tunnel) { New-Item -ItemType Directory -Path $logs | Out-Null }
$savedApiUrl = $env:VITE_API_URL
Set-Content -Path $lockFile -Value @("pid=$PID", "room=$Room", "game=$web/$gameQuery") -Encoding ascii
$locked = $true

try {
    if ($startBackend) {
        Write-Host "Backend: starting on port $ApiPort, open to the local network for the phone ..."
        $log = Join-Path $logs 'backend.log'
        $started['backend'] = Start-Process -FilePath $backendPy -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', "$ApiPort") `
            -WorkingDirectory (Join-Path $repoRoot 'backend') -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $logs 'backend.err.log')
        Wait-Up "$api/api/health" $started['backend'] 'The backend' 30 $log
    } else {
        Write-Host "Backend: already running at $api, leaving it alone."
    }

    if ($startWeb) {
        Write-Host "Game: starting on port $WebPort ..."
        # The dev server `npm run dev` runs, started directly with node so there is one process to stop.
        $log = Join-Path $logs 'frontend.log'
        $env:VITE_API_URL = $api
        $started['game'] = Start-Process -FilePath 'node' -ArgumentList @($viteJs, '--port', "$WebPort", '--strictPort') `
            -WorkingDirectory (Join-Path $repoRoot 'frontend') -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $logs 'frontend.err.log')
        Wait-Up "$web/" $started['game'] 'The game' 30 $log
    } else {
        Write-Host "Game: already running at $web, leaving it alone."
    }

    # -Tunnel: a Cloudflare quick tunnel to the backend. Its requests arrive from 127.0.0.1, so the backend locks them down by
    # their Cloudflare headers (backend\app\tunnel.py): only the phone page and a phone's socket. Never open one to a backend
    # without that lockdown (an older one still running), or the API and the camera relay would be on the internet.
    if ($Tunnel) {
        $code = 0
        try { Invoke-WebRequest -Uri "$api/api/health" -Headers @{ 'cf-ray' = 'demo-check' } -UseBasicParsing -TimeoutSec 3 | Out-Null; $code = 200 }
        catch { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } }
        if ($code -ne 403) { throw "The backend at $api does not lock down tunnel requests (it runs older code). Stop it, then run .\scripts\demo.ps1 -Tunnel again." }
        Write-Host 'Tunnel: starting cloudflared so phones can join from any network ...'
        $tunnelLog = Join-Path $logs 'tunnel.log'
        $started['tunnel'] = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$ApiPort", '--no-autoupdate') `
            -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $logs 'tunnel.out.log') -RedirectStandardError $tunnelLog
        $deadline = (Get-Date).AddSeconds(40)
        while (-not $publicUrl) {
            if ($started['tunnel'].HasExited) { throw "cloudflared stopped while starting. Log: $tunnelLog" }
            if ((Get-Date) -gt $deadline) { throw "cloudflared printed no tunnel address within 40 s. Log: $tunnelLog" }
            Start-Sleep -Milliseconds 500
            $text = (Get-Content -Raw -ErrorAction SilentlyContinue $tunnelLog) + (Get-Content -Raw -ErrorAction SilentlyContinue (Join-Path $logs 'tunnel.out.log'))
            $match = [regex]::Match([string]$text, 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com')
            if ($match.Success) { $publicUrl = $match.Value }
        }
        Set-Content -Path $publicUrlFile -Value $publicUrl -Encoding ascii
        $seen = $null
        try { $seen = (Invoke-RestMethod -Uri "$api/joystick/info" -TimeoutSec 2).public_url } catch { }
        if ($seen -ne $publicUrl) {
            Write-Host "demo: the backend at $api does not see the tunnel address (started from another folder?): the game's QR code shows"
            Write-Host '      the Wi-Fi address. Give the phones the tunnel link below instead.'
        }
    }

    $lanIp = $null
    try { $lanIp = (Invoke-RestMethod -Uri "$api/joystick/info" -TimeoutSec 2).lan_ip } catch { }
    $story = 'scripted story, no Gemini key loaded'
    try { if ((Invoke-RestMethod -Uri "$api/api/health" -TimeoutSec 2).gemini) { $story = 'Gemini storyteller' } } catch { }
    Write-Host ''
    Write-Host "  Game:            $web/$gameQuery   ($story)"
    if ($publicUrl) {
        Write-Host "  Phone joystick:  $publicUrl/joystick$query   (any network; or scan the QR code in the game)"
        Write-Host "  Room:            $Room   (new each launch; up to 3 phones)"
        if (-not $Join) {
            Write-Host "  Teammates' laptops (each its own game, tracker and phone; up to 3 players): send each one their line"
            foreach ($c in @('red', 'blue', 'yellow')) {
                if ($colorList -contains $c) { continue }
                Write-Host "    ${c}:  powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1 -Color $c -Name <name> -Join $publicUrl -Room $Room"
                Write-Host "          macOS: ./scripts/demo.sh --color $c --name <name> --join $publicUrl --room $Room"
            }
        }
    } elseif ($lanIp) {
        Write-Host "  Phone joystick:  http://${lanIp}:$ApiPort/joystick$query   (phone on the same Wi-Fi or hotspot)"
    } else {
        Write-Host "  Phone joystick:  no network address found. Join a Wi-Fi or hotspot, then open http://<laptop-ip>:$ApiPort/joystick"
    }
    if (-not $startBackend) { Write-Host '                   (if the phone cannot open it, that backend was started without --host 0.0.0.0)' }
    if ($started.Count -gt 0) { Write-Host "  Logs:            $logs" }
    Write-Host ''

    if ($startTracker) {
        Write-Host "Tracker: starting; its camera picture shows in the game's wand panel ..."
        Write-Host "         Colours: $colors (players 1-3 in that order)$(if ($jumpOn -eq '0') { '; jump is off with several players in view' } else { "; jump: $Jump" })"
        $savedColors = $env:YT_COLORS; $savedJump = $env:YT_JUMP; $savedMode = $env:YT_JUMP_MODE
        $env:YT_COLORS = $colors; $env:YT_JUMP = $jumpOn; $env:YT_JUMP_MODE = $Jump
        $started['tracker'] = Start-Process -FilePath $trackerPy -ArgumentList @('-m', 'tools.publish', '--api', $api, '--room', $Room) `
            -WorkingDirectory (Join-Path $repoRoot 'cv_2') -NoNewWindow -PassThru
        $env:YT_COLORS = $savedColors; $env:YT_JUMP = $savedJump; $env:YT_JUMP_MODE = $savedMode
    } elseif (-not $NoTracker) {
        Write-Host 'Tracker: one is already running, leaving it alone.'
        if ($Room -ne 'storybound') { Write-Host "         It may be on another room: to see it in this game, stop it and run this again (room $Room)." }
    }
    if (-not $NoBrowser) { Start-Process "$web/$gameQuery" }

    Write-Host 'Running. Press Ctrl-C to stop what this script started.'
    $reported = @{}
    while ($true) {
        # $key, not $name: PowerShell variables ignore case, so a loop over $name would overwrite the player's -Name.
        foreach ($key in @($started.Keys)) {
            if ($started[$key].HasExited -and -not $reported[$key]) {
                $reported[$key] = $true
                if ($key -eq 'tracker') { Write-Host 'demo: the tracker stopped (its messages are above). The backend and game keep running; Ctrl-C to stop.' }
                else { Write-Host "demo: the $key stopped. Logs: $logs" }
            }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    $env:VITE_API_URL = $savedApiUrl
    if ($locked -and (Test-Path $lockFile) -and ((Get-Content $lockFile) -contains "pid=$PID")) { Remove-Item $lockFile -ErrorAction SilentlyContinue }
    # The tunnel's URL file goes too, but only if it still holds this run's URL.
    if ($publicUrl -and (Test-Path $publicUrlFile) -and ((Get-Content -Raw $publicUrlFile).Trim() -eq $publicUrl)) { Remove-Item $publicUrlFile }
    if ($started.Count -gt 0) {
        Write-Host ''
        Write-Host 'Stopping what this script started...'
        foreach ($process in $started.Values) {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
        }
    }
}
