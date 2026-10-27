#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
node -e 'if(Number(process.versions.node.split(".")[0])<22) throw Error("Node >=22 required; see .node-version")'
wasm_bindgen_version=$(python3 - <<'PY'
import tomllib
with open('Cargo.lock','rb') as file:
    print(next(p['version'] for p in tomllib.load(file)['package'] if p['name']=='wasm-bindgen'))
PY
)
if [[ "$(wasm-bindgen --version 2>/dev/null || true)" != "wasm-bindgen $wasm_bindgen_version" ]]; then
  cargo install wasm-bindgen-cli --version "$wasm_bindgen_version" --locked -j 4
fi
npm ci --ignore-scripts
