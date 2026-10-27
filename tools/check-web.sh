#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
export NEXT_TELEMETRY_DISABLED=1
cargo clippy -p spaceeyes-wasm --features browser --target wasm32-unknown-unknown --locked -j 4 -- -D warnings
npm exec -- prettier --check apps/web/package.json apps/web/tsconfig.json apps/web/next.config.mjs 'apps/web/app/*' 'apps/web/lib/*.ts' apps/web/playwright.config.ts 'apps/web/tests/*.ts'
bash tools/build-web.sh
npm exec -- playwright test --config apps/web/playwright.config.ts
