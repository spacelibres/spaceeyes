#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
export NEXT_TELEMETRY_DISABLED=1
cargo clippy -p spaceeyes-wasm --features browser --target wasm32-unknown-unknown --locked -j 4 -- -D warnings
npm exec -- prettier --check apps/web/package.json apps/web/tsconfig.json apps/web/next.config.mjs 'apps/web/app/*' 'apps/web/lib/*.ts' apps/web/playwright.config.ts 'apps/web/tests/*.ts'
npm exec -- tsc --target es2022 --module nodenext --moduleResolution nodenext --strict --types node --rootDir apps/web --outDir target/web-unit apps/web/lib/time.ts apps/web/tests/time.unit.ts
node --test target/web-unit/tests/time.unit.js
bash tools/build-web.sh
npm exec -- playwright test --config apps/web/playwright.config.ts
