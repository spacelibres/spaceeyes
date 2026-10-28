// Serves only the explicit verification fixture and its generated WASM, never the workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const routes = new Map([
  ['/', ['../core/tests/browser/index.html', 'text/html; charset=utf-8']],
  ['/spaceeyes_core.js', ['../core/pkg-web/spaceeyes_core.js', 'text/javascript']],
  ['/spaceeyes_core_bg.wasm', ['../core/pkg-web/spaceeyes_core_bg.wasm', 'application/wasm']],
]);
const server = createServer(async (request, response) => {
  const route = routes.get(request.url ?? '');
  if (!route) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, { 'content-type': route[1], 'cache-control': 'no-store' }).end(bytes);
  } catch { response.writeHead(500).end('Build the browser-render WASM artifact first.'); }
});
server.listen(4173, '127.0.0.1', () => process.stdout.write('Core fixture: http://127.0.0.1:4173/\n'));
