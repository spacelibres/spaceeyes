#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 SPACEEYES contributors
"""Enforce the repository's current version and acyclic core dependency rules."""
from pathlib import Path
import re
import json
import tomllib

root = Path(__file__).resolve().parents[1]
version = (root / 'VERSION').read_text().strip()
workspace = tomllib.loads((root / 'Cargo.toml').read_text())
assert workspace['workspace']['package']['version'] == version, 'workspace/VERSION mismatch'
assert workspace['workspace']['package']['license'] == 'MIT', 'workspace license must be MIT'
license_text = (root / 'LICENSE').read_text()
assert license_text.startswith('MIT License\n') and 'SPACEEYES contributors' in license_text, 'missing MIT license or copyright notice'
packages = {}
for member in workspace['workspace']['members']:
    folder = (root / member).resolve()
    manifest = tomllib.loads((folder / 'Cargo.toml').read_text())
    assert manifest['package'].get('license') == {'workspace': True}, f'{member}: must inherit the MIT license'
    declared = manifest['package']['version']
    assert declared == {'workspace': True} or declared == version, f'{member}: version mismatch'
    packages[folder] = manifest
for path in [root / 'README.md', *sorted((root / 'docs').rglob('*.md'))]:
    match = re.search(r'(?:项目)?版本：\s*(\d+\.\d+\.\d+)', path.read_text())
    assert match and match[1] == version, f'{path.relative_to(root)}: version declaration mismatch'
changelog = (root / 'CHANGELOG.md').read_text()
assert f'## [{version}]' in changelog and '提交关联' in changelog, 'missing changelog/version association'
# Only production dependencies form the core architecture; tests must not become hidden normal dependencies.
graph = {}
for folder, manifest in packages.items():
    dependencies = [value for value in manifest.get('dependencies', {}).values()
                    if isinstance(value, dict) and 'path' in value]
    graph[folder] = [(folder / item['path']).resolve() for item in dependencies]
    assert all(dep in packages for dep in graph[folder]), f'{folder}: unknown path dependency'
visiting, visited = set(), set()
def walk(node):
    assert node not in visiting, f'cyclic production dependency: {node.relative_to(root)}'
    if node in visited:
        return
    visiting.add(node)
    for dep in graph[node]:
        walk(dep)
    visiting.remove(node)
    visited.add(node)
for node in graph:
    walk(node)
for name in ['foundation', 'geometry', 'time', 'scene', 'spatial', 'resources', 'rendering', 'snapshot', 'simulation']:
    assert root / 'crates/engine' not in graph[root / f'crates/{name}'], f'{name}: reverse Engine dependency'
root_package=json.loads((root / 'package.json').read_text())
assert root_package['version']==version and root_package['license']=='MIT'
lock=json.loads((root / 'package-lock.json').read_text())
assert lock['version']==version and lock['packages']['']['version']==version
assert root_package['workspaces']==['packages/core-sdk', 'packages/nasa-dynamo', 'apps/web'], 'unexpected JS workspace: review architecture'
for member in root_package['workspaces']:
    package=json.loads((root / member / 'package.json').read_text())
    assert package['version']==version and package['license']=='MIT', f'{member}: metadata mismatch'
    assert lock['packages'][member]['version']==version and lock['packages'][member]['license']=='MIT'
    guide='SKILL.md' if member=='packages/core-sdk' else 'README.md'
    assert f'版本：{version}' in (root / member / guide).read_text(), f'{member}: guide/version mismatch'
source_files = [p for folder in packages for p in folder.rglob('*.rs')]
source_files += list((root / 'proto').rglob('*.proto')) + list((root / 'crates/rendering/src').glob('*.wgsl'))
source_files += list((root / 'tools').glob('*.sh')) + list((root / 'tools').glob('*.py'))
source_files += list((root / 'packages/core-sdk/src').rglob('*.ts')) + list((root / 'packages/core-sdk/test').rglob('*.ts'))
source_files += list((root / 'packages/nasa-dynamo/src').rglob('*.ts')) + list((root / 'packages/nasa-dynamo/test').rglob('*.ts'))
for folder in ['apps/web/app','apps/web/lib','apps/web/tests']:
    source_files += [p for p in (root / folder).rglob('*') if p.suffix in {'.ts','.tsx','.css'}]
source_files += [root / 'apps/web/next.config.mjs', root / 'apps/web/playwright.config.ts']
for path in source_files:
    assert any('SPDX-License-Identifier: MIT' in line for line in path.read_text().splitlines()[:5]), f'{path.relative_to(root)}: missing MIT SPDX identifier'
print(f'Policy passed: uniform {version}; {len(packages)} packages; production dependencies acyclic; MIT metadata/SPDX consistent; TS workspace/SDK skill version aligned.')
