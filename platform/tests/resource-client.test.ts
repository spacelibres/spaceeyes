import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceClient } from '../resource-client.ts';

test('default browser fetch keeps its global receiver', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = function () {
      assert.equal(this, globalThis);
      return Promise.resolve(new Response(new Uint8Array([1])));
    };
    const client = new ResourceClient([{ id: 'x', path: '/x', maxBytes: 1 }]);
    assert.deepEqual([...await client.read('x')], [1]);
  } finally { globalThis.fetch = original; }
});

test('resource catalog constrains fetches and cache copies cannot mutate stored bytes', async () => {
  let calls = 0;
  const client = new ResourceClient([{ id: 'earth.segment', path: '/data/earth.dyn', maxBytes: 8 }], {
    fetch: async () => { calls++; return new Response(new Uint8Array([1, 2])); },
    cacheBytes: 8,
  });
  await assert.rejects(client.read('missing'), /unknown/);
  const first = await client.read('earth.segment'); first[0] = 99;
  assert.deepEqual([...await client.read('earth.segment')], [1, 2]);
  assert.equal(calls, 1);
  assert.throws(() => new ResourceClient([{ id: 'bad', path: '//remote/data', maxBytes: 8 }]), /path/);
});

test('cancelled late response is rejected and never cached; HTTP failures are explicit', async () => {
  let finish!: (response: Response) => void;
  const controller = new AbortController();
  let calls = 0;
  const client = new ResourceClient([{ id: 'segment', path: '/data/segment', maxBytes: 8 }], {
    fetch: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
  });
  const pending = client.read('segment', controller.signal);
  controller.abort(); finish(new Response(new Uint8Array([7])));
  await assert.rejects(pending, { name: 'AbortError' });
  const next = client.read('segment'); finish(new Response(null, { status: 404 }));
  await assert.rejects(next, /HTTP 404/); assert.equal(calls, 2);
});

test('streamed size limits, redirect rejection and cache budget are enforced', async () => {
  let calls = 0;
  const client = new ResourceClient([{ id: 'segment', path: '/data/segment', maxBytes: 2 }], {
    fetch: async () => { calls++; return new Response(new Uint8Array(calls === 1 ? [1, 2, 3] : [1, 2])); },
    cacheBytes: 1,
  });
  await assert.rejects(client.read('segment'), /size/);
  await client.read('segment'); await client.read('segment'); assert.equal(calls, 3);
  const redirected = new ResourceClient([{ id: 'x', path: '/x', maxBytes: 2 }], {
    fetch: async () => { const result = new Response(); Object.defineProperty(result, 'redirected', { value: true }); return result; },
  });
  await assert.rejects(redirected.read('x'), /redirect/);
});

test('clearing resources invalidates in-flight results instead of repopulating cache', async () => {
  let finish!: (response: Response) => void;
  const client = new ResourceClient([{ id: 'x', path: '/x', maxBytes: 2 }], {
    fetch: () => new Promise(resolve => { finish = resolve; }),
  });
  const pending = client.read('x');
  client.clear(); finish(new Response(new Uint8Array([1])));
  await assert.rejects(pending, /invalidated/);
});

test('aborted cache reads fail and LRU eviction stays inside the total budget', async () => {
  const seen: string[] = [];
  const client = new ResourceClient(['a', 'b', 'c'].map(id => ({ id, path: `/${id}`, maxBytes: 2 })), {
    cacheBytes: 4,
    fetch: async path => { seen.push(String(path)); return new Response(new Uint8Array([1, 2])); },
  });
  await client.read('a'); await client.read('b'); await client.read('a'); await client.read('c');
  await client.read('a'); assert.equal(seen.length, 3);
  await client.read('b'); assert.equal(seen.length, 4);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.read('b', controller.signal), { name: 'AbortError' });
});
