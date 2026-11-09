import { lstat, readdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const managed = ['nasa-dyn', 'nasa-static', 'eyes-assets', 'galaxy', 'next'];

// Approximate LRU under Linux relatime; fixed galaxy-lod and active temporary
// writes are outside this evictable budget. Never traverse symbolic links.
export async function pruneCache(root, { maxBytes, minAgeMs = 120_000, nowMs = Date.now() }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || minAgeMs < 0) throw Error('Invalid cache budget');
  root = resolve(root);
  const base = await lstat(root);
  if (!base.isDirectory() || base.isSymbolicLink()) throw Error('Invalid cache root');
  const files = [];
  async function visit(path) {
    let info;
    try { info = await lstat(path); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
    } else if (info.isFile() && !path.endsWith('.tmp') && !path.split(/[\\/]/).at(-1).startsWith('.')) {
      files.push({ path, size: info.size, accessed: info.atimeMs, modified: info.mtimeMs });
    }
  }
  for (const name of managed) await visit(join(root, name));
  let remainingBytes = files.reduce((n, f) => n + f.size, 0), removedBytes = 0;
  files.sort((a, b) => a.accessed - b.accessed || a.path.localeCompare(b.path));
  for (const file of files) {
    if (remainingBytes <= maxBytes) break;
    if (nowMs - file.modified < minAgeMs) continue;
    try { await unlink(file.path); remainingBytes -= file.size; removedBytes += file.size; }
    catch (e) { if (e.code !== 'ENOENT') throw e; remainingBytes -= file.size; }
  }
  return { remainingBytes, removedBytes, overBudget: remainingBytes > maxBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.argv[2];
  const maxBytes = Number(process.argv[3]);
  const result = await pruneCache(root, { maxBytes });
  console.log(JSON.stringify(result));
  if (result.overBudget) process.exitCode = 2;
}
