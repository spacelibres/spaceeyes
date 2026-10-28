param([string]$Samples)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
function Invoke-Check([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Check failed: $Executable $($Arguments -join ' ')" }
}
Push-Location $projectRoot
try {
    Invoke-Check cargo @('fmt', '--manifest-path', 'core/Cargo.toml', '--check')
    Invoke-Check cargo @('test', '--manifest-path', 'core/Cargo.toml', '--locked')
    Invoke-Check cargo @('clippy', '--manifest-path', 'core/Cargo.toml', '--locked', '--all-targets', '--', '-D', 'warnings')
    Invoke-Check node @('--test', 'platform/tests/*.test.ts', 'validation/tests/*.test.ts')
    # Requires npm ci --prefix platform; never silently use a compiler from old code.
    Invoke-Check node @('platform/node_modules/typescript/bin/tsc', '--project', 'platform/tsconfig.json')
    Invoke-Check cargo @('build', '--manifest-path', 'core/Cargo.toml', '--locked', '--target', 'wasm32-unknown-unknown')
    Invoke-Check wasm-bindgen @('core/target/wasm32-unknown-unknown/debug/spaceeyes_core.wasm', '--target', 'nodejs', '--out-dir', 'core/pkg')
    Invoke-Check wasm-bindgen @('core/target/wasm32-unknown-unknown/debug/spaceeyes_core.wasm', '--target', 'web', '--out-dir', 'core/pkg-web')
    Invoke-Check node @('--test', 'platform/integration/wasm.test.ts')
    if ($Samples) {
        Invoke-Check node @('validation/verify.ts', '--samples', $Samples, '--output', 'validation/results/latest.json')
    } else {
        Write-Output 'Real resource samples not checked: supply -Samples DIRECTORY.'
    }
    Write-Output 'Core checks passed. Browser rendering and GPU are not covered by this command.'
} finally { Pop-Location }
