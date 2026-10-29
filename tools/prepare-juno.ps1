param([switch]$Offline)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $projectRoot 'validation/juno-assets.json') -Raw | ConvertFrom-Json
$destination = Join-Path $projectRoot 'validation/.cache/juno-assets'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($entry in $manifest.files) {
    if ($entry.file -notmatch '^[A-Za-z0-9_.-]+$' -or $entry.file.Contains('..') -or
        $entry.source -cne ('https://eyes.nasa.gov/assets/static/models/sc_juno/' + $entry.file) -or
        $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $entry.bytes -le 0 -or $entry.bytes -gt 16777216) { throw 'Invalid pinned resource entry' }
    $path = Join-Path $destination $entry.file
    if (!(Test-Path -LiteralPath $path)) {
        if ($Offline) { throw "Missing cached resource: $($entry.file); run tools/prepare-juno.ps1 first." }
        Invoke-WebRequest -Uri $entry.source -OutFile $path -TimeoutSec 30
    }
    if ((Get-Item -LiteralPath $path).Length -ne $entry.bytes -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
        throw "Resource identity mismatch: $($entry.file). Investigate; do not silently update hashes."
    }
}
$model = Get-Content (Join-Path $destination 'Juno.gltf') -Raw | ConvertFrom-Json
$files = @($manifest.files.file)
foreach ($uri in @($model.buffers.uri) + @($model.images.uri)) {
    if ($uri -notmatch '^[A-Za-z0-9_.-]+$' -or $uri.Contains('..') -or $uri -cnotin $files) { throw 'Unpinned glTF dependency' }
}
Write-Output "Verified $($manifest.files.Count) pinned Juno resources; cached bytes are not committed."
