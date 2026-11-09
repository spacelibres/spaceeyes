import { statfs } from 'node:fs/promises';
import { pruneCache } from './cache-budget.mjs';

const root = process.env.SPACEEYES_CACHE_ROOT ?? '/opt/spaceeyes/shared/cache';
const gib = 1024 ** 3;
const fs = await statfs(root, { bigint: true });
const used = Number((fs.blocks - fs.bfree) * fs.bsize);
// Keep at least 2 GiB below the user's 20 GiB system-wide planning limit.
const target = Math.max(0, 6 * gib - Math.max(0, used - 18 * gib));
const result = await pruneCache(root, { maxBytes: target });
console.log(JSON.stringify({ used, target, ...result }));
if (result.overBudget || used > 20 * gib) process.exitCode = 2;
