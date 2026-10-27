#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export CARGO_HOME="${CARGO_HOME:-/workspace/.spaceeyes-tools/cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-/workspace/.spaceeyes-tools/rustup}"
export PATH="$CARGO_HOME/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/spaceeyes-rustup.sh
  sh /tmp/spaceeyes-rustup.sh -y --no-modify-path --profile minimal --default-toolchain stable --component rustfmt --component clippy
fi
rustup component add rustfmt clippy
rustup target add wasm32-unknown-unknown
cargo fetch --locked
# Rootless Debian cloud setup. APT verifies signed metadata and archive checksums.
if [[ -f /etc/debian_version && ! -f /workspace/.spaceeyes-tools/mesa/lvp-local.json ]] && rg -q '^VERSION_CODENAME=trixie$' /etc/os-release; then
  apt_root=/workspace/.spaceeyes-tools/apt
  mkdir -p "$apt_root/lists/partial" "$apt_root/cache/archives/partial" "$apt_root/conf.d" "$apt_root/log"
  cat > "$apt_root/config" <<'EOF'
Dir::Etc::parts "/workspace/.spaceeyes-tools/apt/conf.d";
Dir::State::lists "/workspace/.spaceeyes-tools/apt/lists";
Dir::Cache "/workspace/.spaceeyes-tools/apt/cache";
Dir::Log "/workspace/.spaceeyes-tools/apt/log";
Dir::Etc::sourcelist "/workspace/.spaceeyes-tools/apt/sources.list";
Dir::Etc::sourceparts "-";
APT::Sandbox::User "agent";
APT::Update::Error-Mode "any";
EOF
  cat > "$apt_root/sources.list" <<'EOF'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
EOF
  APT_CONFIG="$apt_root/config" apt-get update
  APT_CONFIG="$apt_root/config" apt-get -o Debug::NoLocking=true --download-only -y --no-install-recommends install mesa-vulkan-drivers
  mkdir -p /workspace/.spaceeyes-tools/mesa
  for archive in "$apt_root"/cache/archives/*.deb; do
    dpkg-deb -x "$archive" /workspace/.spaceeyes-tools/mesa
  done
  python3 - <<'PY'
import json
from pathlib import Path
root = Path('/workspace/.spaceeyes-tools/mesa')
source = next(root.glob('usr/share/vulkan/icd.d/lvp_icd*.json'))
manifest = json.loads(source.read_text())
library = next(root.glob('usr/lib/*/libvulkan_lvp.so'))
manifest['ICD']['library_path'] = str(library)
(root / 'lvp-local.json').write_text(json.dumps(manifest))
PY
fi
source tools/dev-env.sh
cargo build --workspace --locked -j 4
