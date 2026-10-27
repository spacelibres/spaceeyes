#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
export CARGO_TARGET_DIR="$PWD/target"
export NEXT_TELEMETRY_DISABLED=1
cargo build -p spaceeyes-wasm --features browser --target wasm32-unknown-unknown --locked -j 4
wasm-bindgen target/wasm32-unknown-unknown/debug/spaceeyes_wasm.wasm --target web --out-dir apps/web/public/wasm
npm run build
npm run build --workspace @spaceeyes/web
