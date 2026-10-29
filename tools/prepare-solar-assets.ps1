param([switch]$Offline)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$cacheRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'validation/.cache/solar-assets'))
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'validation/solar-assets.json') -Raw | ConvertFrom-Json -AsHashtable
$entries = [Collections.Generic.List[object]]::new()
foreach ($id in $manifest.bodies.Keys) {
    if ($id -notmatch '^[a-z]+$') { throw 'Invalid body identifier' }
    $faces = @($manifest.bodies[$id].faces)
    if ($faces.Count -ne 6 -or @($faces.face | Sort-Object -Unique).Count -ne 6) { throw "Incomplete faces: $id" }
    foreach ($face in $faces) {
        if ($face.face -notin 0..5 -or $face.path -notmatch "^assets/planets/$id/(color_[0-9]+_[0-5]\.(png|jpg))$") { throw 'Invalid face path' }
        $filename = $Matches[1]
        if ($face.source -ne "https://eyes.nasa.gov/assets/static/maps/$id/$filename") { throw 'Invalid face source' }
        $entries.Add(@{ descriptor = $face; relative = "$id/$filename" })
    }
}
if (@($manifest.rings).Count -ne 2) { throw 'Incomplete Saturn ring resources' }
foreach ($ring in $manifest.rings) {
    if ($ring.name -notin @('top', 'bottom')) { throw 'Invalid ring identifier' }
    $filename = "saturn_rings_$($ring.name).png"
    if ($ring.source -ne "https://eyes.nasa.gov/assets/static/sprites/$filename" -or $ring.path -ne "assets/planet-rings/$filename") { throw 'Invalid ring source' }
    $entries.Add(@{ descriptor = $ring; relative = "rings/$filename" })
}
foreach ($entry in $entries) {
    $descriptor = $entry.descriptor
    if ($descriptor.bytes -lt 1 -or $descriptor.bytes -gt 16MB -or $descriptor.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid pinned identity' }
    $file = [IO.Path]::GetFullPath((Join-Path $cacheRoot $entry.relative))
    if (-not $file.StartsWith($cacheRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cache path escape' }
    if (-not (Test-Path -LiteralPath $file)) {
        if ($Offline) { throw "Missing pinned texture: $($entry.relative)" }
        New-Item -ItemType Directory -Path (Split-Path $file -Parent) -Force | Out-Null
        $download = $file + '.download'
        Invoke-WebRequest -Uri $descriptor.source -OutFile $download -TimeoutSec 45 -MaximumRedirection 0
        if ((Get-Item -LiteralPath $download).Length -ne $descriptor.bytes -or (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $descriptor.sha256) { throw "Downloaded identity mismatch: $($entry.relative)" }
        Move-Item -LiteralPath $download -Destination $file
    }
    if ((Get-Item -LiteralPath $file).Length -ne $descriptor.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $descriptor.sha256) { throw "Cached identity mismatch: $($entry.relative)" }
}
Write-Output "Verified $($manifest.bodies.Count) complete celestial surfaces and $(@($manifest.rings).Count) ring textures ($($entries.Count) pinned files)."
