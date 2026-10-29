import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

type Route = { url: URL; mime: string; delayMs?: number };
export async function createFixtureServer() {
  const routes = new Map<string, Route>([
    ['/', { url: new URL('../core/tests/browser/index.html', import.meta.url), mime: 'text/html; charset=utf-8' }],
    ['/spaceeyes_core.js', { url: new URL('../core/pkg-web/spaceeyes_core.js', import.meta.url), mime: 'text/javascript' }],
    ['/spaceeyes_core_bg.wasm', { url: new URL('../core/pkg-web/spaceeyes_core_bg.wasm', import.meta.url), mime: 'application/wasm' }],
  ]);
  const pack = JSON.parse(await readFile(new URL('../validation/juno-assets.json', import.meta.url), 'utf8'));
  for (const entry of pack.files) {
    if (typeof entry.file !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(entry.file) || entry.file.includes('..')) throw new Error('invalid fixture path');
    const extension = entry.file.split('.').at(-1);
    const mime = ({ gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg' } as Record<string, string>)[extension!] ?? 'application/octet-stream';
    const url = new URL(`../validation/.cache/juno-assets/${entry.file}`, import.meta.url);
    routes.set(`/assets/models/juno/${entry.file}`, { url, mime });
    // Delayed allowlisted copies exercise unload-before-ready, never arbitrary URLs.
    routes.set(`/assets/models/juno-slow/${entry.file}`, { url, mime, delayMs: 2000 });
    routes.set(`/assets/models/juno-slow-release/${entry.file}`, { url, mime, delayMs: 2000 });
  }
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    const route = routes.get(request.url ?? '');
    if (!route) { response.writeHead(404).end(); return; }
    try {
      const path = fileURLToPath(route.url);
      const metadata = await stat(path);
      if (route.delayMs) await delay(route.delayMs);
      if (response.destroyed) return;
      response.writeHead(200, { 'content-type': route.mime, 'content-length': metadata.size, 'cache-control': 'no-store' });
      if (request.method === 'HEAD') { response.end(); return; }
      await pipeline(createReadStream(path), response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.writeHead((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500).end();
      else response.destroy();
    }
  });
}
