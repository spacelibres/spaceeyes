#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source tools/dev-env.sh
case "${1:-}" in ""|--check) ;; *) echo "Usage: bash tools/generate-ts.sh [--check]" >&2; exit 2 ;; esac
generated_tmp=$(mktemp -d)
trap 'rm -rf -- "$generated_tmp"' EXIT
mapfile -t schema_files < <(python3 - <<'PY'
from pathlib import Path
import sys
sys.stdout.reconfigure(newline='\n')
for path in sorted(Path('proto').rglob('*.proto')):
    print(path.as_posix())
PY
)
(( ${#schema_files[@]} > 0 )) || { echo 'No Proto inputs found' >&2; exit 1; }
plugin_path="$PWD/node_modules/.bin/protoc-gen-es"
case "$(uname -s)" in MINGW*|MSYS*) plugin_path="$plugin_path.cmd" ;; esac
cargo run --quiet -p spaceeyes-protocol-adapter --example protoc --locked -- \
  -I proto "--plugin=protoc-gen-es=$plugin_path" \
  "--es_out=$generated_tmp" --es_opt=target=ts,import_extension=js "${schema_files[@]}"
python3 - "$generated_tmp" "${1:-}" <<'PY'
from pathlib import Path
import shutil, sys
source=Path(sys.argv[1]); destination=Path('packages/core-sdk/src/gen')
header='// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 SPACEEYES contributors\n'
for path in source.rglob('*.ts'):
    content=path.read_text()
    if not any("SPDX-License-Identifier: MIT" in line for line in content.splitlines()[:5]):
        content=header+content
    path.write_text(content.rstrip()+'\n')
files={p.relative_to(source):p.read_bytes() for p in source.rglob('*.ts')}
if sys.argv[2]=='--check':
    existing={p.relative_to(destination):p.read_bytes() for p in destination.rglob('*') if p.is_file()}
    assert files==existing, 'Generated TS differs from proto; run bash tools/generate-ts.sh'
    print(f'Generated Proto types match: {len(files)} files.')
else:
    if destination.exists(): shutil.rmtree(destination)
    shutil.copytree(source,destination)
    print(f'Generated {len(files)} Proto TS files.')
PY
