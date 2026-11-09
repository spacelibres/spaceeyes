import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneCache } from '../cache-budget.mjs';

test('reclaims oldest eligible cache files but never fixed galaxy tiles or recent writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spaceeyes-budget-'));
  try {
    for (const dir of ['nasa-dyn', 'nasa-static', 'galaxy-lod']) await mkdir(join(root, dir));
    const old = join(root, 'nasa-dyn', 'old.sedyn'), newer = join(root, 'nasa-static', 'new.bin');
    const fixed = join(root, 'galaxy-lod', 'keep.sehdr'), pending = join(root, 'nasa-dyn', '.pending.tmp');
    await Promise.all([old, newer, fixed, pending].map(p => writeFile(p, Buffer.alloc(10, 3))));
    await utimes(old, new Date(1000), new Date(1000));
    await utimes(newer, new Date(2000), new Date(2000));
    const result = await pruneCache(root, { maxBytes: 10, minAgeMs: 0, nowMs: 100_000 });
    assert.equal(result.removedBytes, 10);
    assert.equal(result.remainingBytes, 10);
    await assert.rejects(readFile(old), { code: 'ENOENT' });
    assert.equal((await readFile(newer)).length, 10);
    assert.equal((await readFile(fixed)).length, 10);
    assert.equal((await readFile(pending)).length, 10);
  } finally { await rm(root, { recursive: true, force: true }); }
});
