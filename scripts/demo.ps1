# Storybound demo in one command (Windows PowerShell): the backend (reachable from the phone), the game, and the cv_2 tracker
# window. Whatever is already running is left alone, and Ctrl-C stops only what this script started.
#
#   .\scripts\demo.ps1                                backend :8000, game :5173, tracker window
#   .\scripts\demo.ps1 -NoTracker                     no webcam tracker (keyboard and phone only)
#   .\scripts\demo.ps1 -ApiPort 8020 -WebPort 5220    other ports (the game and tracker are pointed at that backend)
#
# Backend and game logs go to a temporary folder (printed at start); the tracker prints slashes and jumps here.
# The Gemini key stays in backend\.env, which this script never reads: the backend loads it itself.
param(
    [switch]$NoTracker,
    [int]$ApiPort = 8000,
    [int]$WebPort = 5173
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$api = "http://localhost:$ApiPort"
$web = "http://localhost:$WebPort"
# Only these processes are ever stopped: each one was started by this script.
$started = [ordered]@{}

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
if ($startBackend -and -not (Test-Path $backendPy)) {
    throw 'backend\.venv is missing. Set it up once: cd backend; py -m venv .venv; .venv\Scripts\pip install -r requirements.txt'
}
if ($startWeb) {
    if (-not (Test-Path $viteJs)) { throw 'frontend\node_modules is missing. Install it once: cd frontend; npm install' }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js (node) is not on PATH. Install Node 20.19+ and reopen the terminal.' }
}
if ($startTracker -and -not (Test-Path $trackerPy)) {
    throw 'cv_2\.venv is missing. Set it up once (see cv_2\README.md; Windows on ARM needs the x86_64 Python), or run with -NoTracker.'
}

$logs = Join-Path ([IO.Path]::GetTempPath()) ("storybound-demo-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
if ($startBackend -or $startWeb) { New-Item -ItemType Directory -Path $logs | Out-Null }
$savedApiUrl = $env:VITE_API_URL

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

    $lanIp = $null
    try { $lanIp = (Invoke-RestMethod -Uri "$api/joystick/info" -TimeoutSec 2).lan_ip } catch { }
    $story = 'scripted story, no Gemini key loaded'
    try { if ((Invoke-RestMethod -Uri "$api/api/health" -TimeoutSec 2).gemini) { $story = 'Gemini storyteller' } } catch { }
    Write-Host ''
    Write-Host "  Game:            $web/   ($story)"
    if ($lanIp) {
        Write-Host "  Phone joystick:  http://${lanIp}:$ApiPort/joystick   (phone on the same Wi-Fi or hotspot)"
    } else {
        Write-Host "  Phone joystick:  no network address found. Join a Wi-Fi or hotspot, then open http://<laptop-ip>:$ApiPort/joystick"
    }
    if (-not $startBackend) { Write-Host '                   (if the phone cannot open it, that backend was started without --host 0.0.0.0)' }
    if ($started.Count -gt 0) { Write-Host "  Logs:            $logs" }
    Write-Host ''

    if ($startTracker) {
        Write-Host 'Tracker: starting the webcam window ...'
        $started['tracker'] = Start-Process -FilePath $trackerPy -ArgumentList @('-m', 'tools.publish', '--window', '--api', $api) `
            -WorkingDirectory (Join-Path $repoRoot 'cv_2') -NoNewWindow -PassThru
    } elseif (-not $NoTracker) {
        Write-Host 'Tracker: one is already running, leaving it alone.'
    }

    Write-Host 'Running. Press Ctrl-C to stop what this script started.'
    $reported = @{}
    while ($true) {
        foreach ($name in @($started.Keys)) {
            if ($started[$name].HasExited -and -not $reported[$name]) {
                $reported[$name] = $true
                if ($name -eq 'tracker') { Write-Host 'demo: the tracker stopped (its messages are above). The backend and game keep running; Ctrl-C to stop.' }
                else { Write-Host "demo: the $name stopped. Logs: $logs" }
            }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    $env:VITE_API_URL = $savedApiUrl
    if ($started.Count -gt 0) {
        Write-Host ''
        Write-Host 'Stopping what this script started...'
        foreach ($process in $started.Values) {
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
        }
    }
}
