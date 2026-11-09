// Browser-only cache for large generated spacecraft models. DYN is deliberately
// excluded: its identity and validity depend on the requested epoch and source.
const CACHE_NAME = 'spaceeyes-models-v1';
const CACHE_PREFIX = 'spaceeyes-models-';
const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 128;
let activeWrites = 0;
let writeQueue = Promise.resolve();

export function modelRequestEligible(request, origin) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === origin && !url.search &&
    /^\/assets\/eyes\/[a-zA-Z0-9_-]+\/model(?:-phase-\d+)?\.glb$/.test(url.pathname) &&
    !request.headers.has('range') && !request.headers.has('authorization') &&
    !['no-store', 'reload', 'no-cache'].includes(request.cache);
}

export function wasmRequestEligible(request, origin) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === origin && !url.search &&
    url.pathname === '/wasm/spaceeyes_core_bg.wasm' &&
    !request.headers.has('range') && !request.headers.has('authorization') &&
    !['no-store', 'reload', 'no-cache'].includes(request.cache);
}

function freshness(response) {
  const value = response.headers.get('cache-control') ?? '';
  if (response.status !== 200 || /(?:^|,)\s*(?:no-store|no-cache)\b/i.test(value)) return 0;
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(value);
  return match ? Math.min(Number(match[1]), 3600) * 1000 : 0;
}

async function boundedBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MODEL_BYTES) { await reader.cancel(); return undefined; }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return { parts, size };
}

function storeResponse(request, cache, response, now) {
  if (activeWrites >= 2) return Promise.resolve();
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_MODEL_BYTES) return Promise.resolve();
  activeWrites++;
  const copy = response.clone();
  const stored = (async () => {
    const body = await boundedBody(copy);
    if (!body || body.size === 0) return;
    const headers = new Headers(copy.headers);
    headers.delete('content-encoding'); headers.delete('transfer-encoding');
    headers.set('content-length', String(body.size));
    headers.set('x-spaceeyes-stored-at', String(now()));
    headers.set('x-spaceeyes-size', String(body.size));
    const record = new Response(new Blob(body.parts), {status:200, headers});
    const write = writeQueue.catch(() => {}).then(async () => {
      const keys = await cache.keys();
      let total = 0; const existing = [];
      for (const key of keys) {
        if (key.url === request.url) continue;
        const item = await cache.match(key);
        const size = Number(item?.headers.get('x-spaceeyes-size'));
        if (!Number.isSafeInteger(size) || size < 1) { await cache.delete(key); continue; }
        existing.push({ key, size }); total += size;
      }
      while (existing.length && (total + body.size > MAX_CACHE_BYTES || existing.length >= MAX_ENTRIES)) {
        const oldest = existing.shift(); await cache.delete(oldest.key); total -= oldest.size;
      }
      await cache.put(request, record);
    });
    writeQueue = write.catch(() => {});
    await write;
  })().catch(() => {}).finally(() => { activeWrites--; });
  return stored;
}

export async function modelCacheResult(request, cache, fetcher, now = Date.now) {
  const cached = await cache.match(request).catch(() => undefined);
  if (cached) {
    const storedAt = Number(cached.headers.get('x-spaceeyes-stored-at'));
    const age = now() - storedAt;
    if (storedAt > 0 && age >= 0 && age < freshness(cached))
      return { response: cached, stored: Promise.resolve() };
  }
  const response = await fetcher(request);
  return { response, stored: freshness(response) ? storeResponse(request, cache, response, now) : Promise.resolve() };
}

export async function wasmCacheResult(request, cache, fetcher) {
  const cached = await cache.match(request).catch(() => undefined);
  const etag = cached?.headers.get('etag');
  if (etag) {
    // Chromium attaches no-cache to conditional fetches, and Next's static
    // server then returns 200 with the entire WASM. A HEAD validates the same
    // server ETag without transferring the body, including behind Caddy.
    const head = await fetcher(new Request(request, { method: 'HEAD', cache: 'no-store' }));
    const policy = head.headers.get('cache-control') ?? '';
    if (head.status === 200 && head.headers.get('etag') === etag &&
        !/(?:^|,)\s*no-store\b/i.test(policy))
      return { response: cached, stored: Promise.resolve() };
  }
  const response = await fetcher(request);
  const policy = response.headers.get('cache-control') ?? '';
  const canStore = response.status === 200 && response.headers.has('etag') &&
    !/(?:^|,)\s*no-store\b/i.test(policy) &&
    (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/wasm';
  return { response, stored: canStore ? storeResponse(request, cache, response, Date.now) : Promise.resolve() };
}

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    await self.clients.claim();
  })()));
  self.addEventListener('fetch', event => {
    const model = modelRequestEligible(event.request, self.location.origin);
    const wasm = wasmRequestEligible(event.request, self.location.origin);
    if (!model && !wasm) return;
    const result = caches.open(CACHE_NAME).then(
      cache => model ? modelCacheResult(event.request, cache, request => fetch(request)) : wasmCacheResult(event.request, cache, request => fetch(request)),
      () => ({ response: fetch(event.request), stored: Promise.resolve() }),
    );
    event.respondWith(result.then(value => value.response));
    event.waitUntil(result.then(value => value.stored).catch(() => {}));
  });
}
