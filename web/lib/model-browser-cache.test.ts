import { test } from "node:test";
import assert from "node:assert/strict";
import { modelRequestEligible, modelCacheResult, wasmRequestEligible, wasmCacheResult } from "../public/model-cache-worker.js";

const origin = "https://example.test";
const request = (path: string) => new Request(origin + path);
function fakeCache() {
  const values = new Map<string, Response>();
  return {
    async match(r: Request) { return values.get(r.url)?.clone(); },
    async put(r: Request, response: Response) { values.set(r.url, response.clone()); },
    async keys() { return [...values.keys()].map(url => new Request(url)); },
    async delete(r: Request) { return values.delete(r.url); },
  } as unknown as Cache;
}

test("only same-origin model GETs are eligible, never DYN, ranges or arbitrary URLs", () => {
  assert.equal(modelRequestEligible(request("/assets/eyes/sc_juno/model.glb"), origin), true);
  assert.equal(modelRequestEligible(request("/assets/eyes/sc_jwst/model-phase-2.glb"), origin), true);
  assert.equal(modelRequestEligible(request("/api/solar-dyn/earth?epoch=1"), origin), false);
  assert.equal(modelRequestEligible(new Request(origin + "/assets/eyes/sc_juno/model.glb", { headers: { range: "bytes=0-9" } }), origin), false);
  assert.equal(modelRequestEligible(new Request("https://other.test/assets/eyes/sc_juno/model.glb"), origin), false);
});

test("a fresh cached model avoids a second fetch, expires, and failures are never stored", async () => {
  const cache = fakeCache(), input = request("/assets/eyes/sc_juno/model.glb");
  let calls = 0, now = 10_000;
  const fetcher = async () => { calls++; return new Response("model", {headers:{"cache-control":"private, max-age=2", "content-type":"model/gltf-binary"}}); };
  let result = await modelCacheResult(input, cache, fetcher, () => now);
  assert.equal(await result.response.text(), "model"); await result.stored;
  result = await modelCacheResult(input, cache, fetcher, () => now + 1000);
  assert.equal(await result.response.text(), "model"); await result.stored;
  assert.equal(calls, 1);
  now += 3000;
  result = await modelCacheResult(input, cache, fetcher, () => now); await result.stored;
  assert.equal(calls, 2);
  const failed = await modelCacheResult(request("/assets/eyes/sc_other/model.glb"), cache, async () => new Response("bad",{status:502}), () => now);
  await failed.stored;
  assert.equal(await cache.match(request("/assets/eyes/sc_other/model.glb")), undefined);
});

test("no-cache responses are not stored and the oldest entry is evicted when the budget fills", async () => {
  const cache = fakeCache(), old = request("/assets/eyes/sc_old/model.glb"), current = request("/assets/eyes/sc_new/model.glb");
  await cache.put(old, new Response("old", {headers:{"x-spaceeyes-size": String(256 * 1024 * 1024), "x-spaceeyes-stored-at":"1"}}));
  const noCache = await modelCacheResult(current, cache, async () => new Response("new", {headers:{"cache-control":"no-cache, max-age=3600"}}), () => 1000);
  await noCache.stored;
  assert.equal(await cache.match(current), undefined);
  const allowed = await modelCacheResult(current, cache, async () => new Response("new", {headers:{"cache-control":"private, max-age=3600"}}), () => 1000);
  await allowed.stored;
  assert.equal(await cache.match(old), undefined);
  assert.equal(await (await cache.match(current))?.text(), "new");
});

test("WASM reuses cached bytes after HEAD validates the ETag; changed versions replace it", async () => {
  const cache = fakeCache(), wasm = request("/wasm/spaceeyes_core_bg.wasm");
  assert.equal(wasmRequestEligible(wasm, origin), true);
  assert.equal(wasmRequestEligible(request("/api/solar-dyn/earth?epoch=1"), origin), false);
  let calls = 0;
  const fetcher = async (r: Request) => {
    calls++;
    if (calls === 1) return new Response("v1", {headers:{etag:'"v1"',"cache-control":"public, max-age=0","content-type":"application/wasm"}});
    if (calls === 2 || calls === 3) {
      assert.equal(r.method, "HEAD");
      return new Response(null, {headers:{etag:calls === 2 ? '"v1"' : '"v2"',"cache-control":"public, max-age=0"}});
    }
    assert.equal(r.method, "GET");
    return new Response("v2", {headers:{etag:'"v2"',"cache-control":"public, max-age=0","content-type":"application/wasm"}});
  };
  let result = await wasmCacheResult(wasm, cache, fetcher); assert.equal(await result.response.text(), "v1"); await result.stored;
  result = await wasmCacheResult(wasm, cache, fetcher); assert.equal(await result.response.text(), "v1"); await result.stored;
  result = await wasmCacheResult(wasm, cache, fetcher); assert.equal(await result.response.text(), "v2"); await result.stored;
  assert.equal(await (await cache.match(wasm))?.text(), "v2");
});
