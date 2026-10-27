#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
# Source from the repository; use the provisioned toolchain without changing shell profiles.
if [[ -d /workspace/.spaceeyes-tools/cargo/bin ]]; then
  export CARGO_HOME="${CARGO_HOME:-/workspace/.spaceeyes-tools/cargo}"
  export RUSTUP_HOME="${RUSTUP_HOME:-/workspace/.spaceeyes-tools/rustup}"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
if [[ -z "${VK_DRIVER_FILES:-}" && -f /workspace/.spaceeyes-tools/mesa/lvp-local.json ]]; then
  export VK_DRIVER_FILES=/workspace/.spaceeyes-tools/mesa/lvp-local.json
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/spaceeyes-xdg-$UID}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export MESA_SHADER_CACHE_DIR="${MESA_SHADER_CACHE_DIR:-/tmp/spaceeyes-mesa-cache-$UID}"

if [[ -d /workspace/.spaceeyes-tools ]]; then
  export npm_config_cache="${npm_config_cache:-/workspace/.spaceeyes-tools/npm-cache}"
else
  export npm_config_cache="${npm_config_cache:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/spaceeyes-npm-cache-$UID}"
fi
