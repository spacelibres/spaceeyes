import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('CLI emits auditable reports and exits nonzero for a changed sample', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spaceeyes-validation-'));
  try {
    const bytes = Buffer.alloc(27);
    bytes.writeInt32LE(1);
    const manifest = join(root, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ artifacts: [{
      file: 'stars.bin', kind: 'point-cloud', bytes: 27,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      source: 'synthetic test fixture',
    }] }));
    await writeFile(join(root, 'stars.bin'), bytes);
    const run = () => spawnSync(process.execPath,
      [fileURLToPath(new URL('../verify.ts', import.meta.url)),
        '--samples', root, '--manifest', manifest], { encoding: 'utf8' });
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    let report = JSON.parse(result.stdout);
    assert.equal(report.passed, true);
    assert.equal(report.artifacts[0].checks.records, 1);
    await writeFile(join(root, 'stars.bin'), Buffer.alloc(27));
    result = run();
    assert.equal(result.status, 1);
    report = JSON.parse(result.stdout);
    assert.equal(report.passed, false);
    assert.match(report.artifacts[0].error, /SHA-256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
