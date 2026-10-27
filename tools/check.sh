#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
python3 tools/check-policy.py
python3 tools/test_remote_ci.py
cargo fmt --all -- --check
cargo check --workspace --all-targets --locked -j 4
cargo build --workspace --all-features --locked -j 4
cargo clippy --workspace --all-targets --all-features --locked -j 4 -- -D warnings
cargo test --workspace --locked -j 4
cargo build -p spaceeyes-wasm --target wasm32-unknown-unknown --locked -j 4
bash tools/check-sdk.sh
bash tools/check-web.sh
if [[ "${1:-}" == --gpu ]]; then
  cargo test --workspace --all-features --locked -j 4
  cargo run -p spaceeyes-native --features gpu --locked -- /tmp/spaceeyes-frame.ppm
fi
