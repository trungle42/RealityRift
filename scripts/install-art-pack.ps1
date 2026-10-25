param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ZipPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$gitRoot = (& git -C $repoRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($gitRoot.Trim()) -ne [IO.Path]::GetFullPath($repoRoot)) {
    throw 'Refusing to run: scripts must be inside the Storybound repository.'
}

$archivePath = (Resolve-Path -LiteralPath $ZipPath).Path
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw "Art pack zip not found: $archivePath"
}
$models = [IO.Path]::GetFullPath((Join-Path $repoRoot 'frontend/public/models'))
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or
            -not ($name.StartsWith('assetyard/') -or $name.StartsWith('polyhaven/'))) {
            continue
        }
        # Zip external attributes store Unix file type bits in the high word.
        $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xF000
        if ($unixMode -eq 0xA000) {
            Write-Output "SKIP symlink: $name"
            continue
        }
        $destination = [IO.Path]::GetFullPath((Join-Path $models ($name.Replace('/', [IO.Path]::DirectorySeparatorChar))))
        if (-not $destination.StartsWith($models + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing path outside models folder: $name"
        }
        if ($name.EndsWith('/')) {
            [IO.Directory]::CreateDirectory($destination) | Out-Null
            continue
        }
        $parent = [IO.Path]::GetDirectoryName($destination)
        [IO.Directory]::CreateDirectory($parent) | Out-Null
        if (Test-Path -LiteralPath $destination) {
            Write-Output "SKIP existing (never overwrite): frontend/public/models/$name"
            continue
        }
        $inputStream = $entry.Open()
        try {
            $outputStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
        Write-Output "INSTALLED frontend/public/models/$name"
    }
} finally { $archive.Dispose() }

$expected = @(
    'assetyard/ashfen-ranger.glb',
    'assetyard/hollow-warden.glb',
    'assetyard/vale-shieldmaiden.glb',
    'assetyard/arming-sword.glb',
    'assetyard/reach-shrine.glb',
    'assetyard/wayfarer-lantern.glb',
    'assetyard/gloom-stalker.glb',
    'assetyard/ashfen-dragon.glb',
    'polyhaven/fern_02/fern_02.gltf',
    'polyhaven/rock_moss_set_01/rock_moss_set_01.gltf'
)
foreach ($relative in $expected) {
    $file = Join-Path $models ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
    $state = if (Test-Path -LiteralPath $file -PathType Leaf) { 'OK' } else { 'MISSING' }
    Write-Output "$state`: frontend/public/models/$relative"
}

foreach ($path in @('frontend/public/models/assetyard/ashfen-ranger.glb', 'frontend/public/models/polyhaven/fern_02/fern_02.gltf')) {
    & git -C $repoRoot check-ignore -q -- $path
    if ($LASTEXITCODE -ne 0) { throw "Expected art path is not ignored: $path" }
}
Write-Output 'Git status (no files were staged by this script):'
& git -C $repoRoot status --short
