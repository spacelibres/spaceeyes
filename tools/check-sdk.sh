#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
export CARGO_TARGET_DIR="$PWD/target"
node -e 'if(Number(process.versions.node.split(".")[0])<22) throw Error("Node >=22 required")'
wasm_bindgen_version=$(python3 - <<'PY'
import tomllib
with open('Cargo.lock','rb') as file:
    print(next(p['version'] for p in tomllib.load(file)['package'] if p['name']=='wasm-bindgen'))
PY
)
[[ "$(wasm-bindgen --version)" == "wasm-bindgen $wasm_bindgen_version" ]] || { echo 'Run bash tools/setup-sdk.sh to match wasm-bindgen.' >&2; exit 1; }
# CI runners need not provide rg. Keep that portability guarantee executable.
(
  rg() { echo 'Proto generation must not require ripgrep' >&2; return 127; }
  export -f rg
  bash tools/generate-ts.sh --check
)
npm exec -- prettier --check package.json package-lock.json packages/core-sdk/package.json packages/core-sdk/tsconfig.json packages/core-sdk/src/index.ts 'packages/core-sdk/test/*.ts'
cargo build -p spaceeyes-protocol-adapter --examples --locked -j 4
cargo build -p spaceeyes-wasm --target wasm32-unknown-unknown --locked -j 4
wasm-bindgen target/wasm32-unknown-unknown/debug/spaceeyes_wasm.wasm --target nodejs --out-dir target/sdk-wasm-node
printf '{"type":"commonjs"}\n' > target/sdk-wasm-node/package.json
wasm-bindgen target/wasm32-unknown-unknown/debug/spaceeyes_wasm.wasm --target web --out-dir target/sdk-wasm-web
npm test
