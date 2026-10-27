#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
if [[ -z "${SPACEEYES_BROWSER_PATH:-}" ]] && ! command -v chromium >/dev/null 2>&1; then
  npm exec -- playwright install chromium
fi
