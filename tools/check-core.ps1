param([string]$Samples, [switch]$Renderer, [switch]$JunoAssets, [switch]$Workspace, [switch]$NativeCamera)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
function Invoke-Check([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Check failed: $Executable $($Arguments -join ' ')" }
}
Push-Location $projectRoot
try {
    Invoke-Check cargo @('fmt', '--manifest-path', 'core/Cargo.toml', '--check')
    Invoke-Check cargo @('test', '--manifest-path', 'core/Cargo.toml', '--locked', '--features', 'bevy-runtime')
    Invoke-Check cargo @('clippy', '--manifest-path', 'core/Cargo.toml', '--locked', '--features', 'bevy-runtime', '--all-targets', '--', '-D', 'warnings')
    if ($NativeCamera) {
        Invoke-Check cargo @('test', '--manifest-path', 'core/Cargo.toml', '--locked', '--features', 'browser-render', '--lib', 'renderer::')
    }
    Invoke-Check node @('--test', 'platform/tests/*.test.ts', 'validation/tests/*.test.ts')
    # Requires npm ci --prefix platform; never silently use a compiler from old code.
    Invoke-Check node @('platform/node_modules/typescript/bin/tsc', '--project', 'platform/tsconfig.json')
    Invoke-Check cargo @('build', '--manifest-path', 'core/Cargo.toml', '--locked', '--target', 'wasm32-unknown-unknown')
    Invoke-Check wasm-bindgen @('core/target/wasm32-unknown-unknown/debug/spaceeyes_core.wasm', '--target', 'nodejs', '--out-dir', 'core/pkg')
    Invoke-Check wasm-bindgen @('core/target/wasm32-unknown-unknown/debug/spaceeyes_core.wasm', '--target', 'web', '--out-dir', 'core/pkg-web')
    Invoke-Check node @('--test', 'platform/integration/wasm.test.ts')
    if ($Renderer) {
        Invoke-Check cargo @('build', '--manifest-path', 'core/Cargo.toml', '--locked', '--features', 'browser-render', '--target', 'wasm32-unknown-unknown', '--jobs', '2')
        Invoke-Check cargo @('clippy', '--manifest-path', 'core/Cargo.toml', '--locked', '--features', 'browser-render', '--target', 'wasm32-unknown-unknown', '--lib', '--', '-D', 'warnings')
        Invoke-Check wasm-bindgen @('core/target/wasm32-unknown-unknown/debug/spaceeyes_core.wasm', '--target', 'web', '--out-dir', 'core/pkg-web')
        Invoke-Check wasm-bindgen @('core/target/wasm32-unknown-unknown/debug/spaceeyes_core.wasm', '--target', 'nodejs', '--out-dir', 'core/pkg')
        Invoke-Check node @('--test', 'platform/integration/wasm.test.ts')
    }
    if ($Samples) {
        Invoke-Check node @('validation/verify.ts', '--samples', $Samples, '--output', 'validation/results/latest.json')
        $previousSamples = $env:SPACEEYES_SAMPLES
        try {
            $env:SPACEEYES_SAMPLES = (Resolve-Path -LiteralPath $Samples).Path
            Invoke-Check node @('--test', 'platform/integration/dyn-samples.test.ts')
        } finally { $env:SPACEEYES_SAMPLES = $previousSamples }
    } else {
        Write-Output 'Real resource samples not checked: supply -Samples DIRECTORY.'
    }
    if ($JunoAssets) {
        Invoke-Check pwsh @('-NoProfile', '-File', 'tools/prepare-juno.ps1', '-Offline')
    }
    if ($Workspace) {
        Invoke-Check node @('--test', 'web/lib/*.test.ts')
        Invoke-Check node @('web/node_modules/typescript/bin/tsc', '--project', 'web/tsconfig.json', '--noEmit')
        if ($JunoAssets) { Invoke-Check node @('web/scripts/prepare-assets.mjs') }
        Push-Location (Join-Path $projectRoot 'web')
        try { Invoke-Check node @('node_modules/next/dist/bin/next', 'build', '--webpack') }
        finally { Pop-Location }
    }
    Write-Output 'Core checks passed. Renderer switch checks build/export, not GPU pixels; browser evidence must be recorded separately.'
} finally { Pop-Location }
