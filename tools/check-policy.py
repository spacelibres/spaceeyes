#!/usr/bin/env python3
"""Enforce the repository's current version and acyclic core dependency rules."""
from pathlib import Path
import re
import tomllib

root = Path(__file__).resolve().parents[1]
version = (root / 'VERSION').read_text().strip()
workspace = tomllib.loads((root / 'Cargo.toml').read_text())
assert workspace['workspace']['package']['version'] == version, 'workspace/VERSION mismatch'
packages = {}
for member in workspace['workspace']['members']:
    folder = (root / member).resolve()
    manifest = tomllib.loads((folder / 'Cargo.toml').read_text())
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
for name in ['foundation', 'time', 'scene', 'spatial', 'resources', 'rendering', 'snapshot', 'simulation']:
    assert root / 'crates/engine' not in graph[root / f'crates/{name}'], f'{name}: reverse Engine dependency'
print(f'Policy passed: uniform {version}; {len(packages)} packages; production dependencies acyclic.')
