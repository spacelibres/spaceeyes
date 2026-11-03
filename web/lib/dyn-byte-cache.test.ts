import { test } from "node:test";
import assert from "node:assert/strict";
import { DynByteCache } from "./dyn-byte-cache.ts";
const signal = () => new AbortController().signal;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test("exact URL reuse, defensive copies, absolute TTL and bounded LRU bytes", async () => {
  let now = 0,
    calls = 0;
  const cache = new DynByteCache({
    now: () => now,
    maxBytes: 4,
    maxEntries: 2,
    ttlMs: 30,
    fetcher: async () => {
      calls++;
      return new Response(new Uint8Array([1, 2]));
    },
  });
  const first = await cache.read("a", signal());
  first[0] = 99;
  now = 20;
  assert.deepEqual(await cache.read("a", signal()), new Uint8Array([1, 2]));
  assert.equal(calls, 1);
  now = 31;
  await cache.read("a", signal());
  assert.equal(calls, 2);
  await cache.read("b", signal());
  await cache.read("a", signal());
  await cache.read("c", signal());
  assert.deepEqual(cache.diagnostics, { entries: 2, bytes: 4, pending: 0 });
  await cache.read("b", signal());
  assert.equal(calls, 5);
});
test("singleflight caller abort is independent; last owner abort cancels upstream", async () => {
  let calls = 0,
    upstream: AbortSignal | undefined,
    release: ((response: Response) => void) | undefined;
  const cache = new DynByteCache({
    fetcher: async (_url, init) => {
      calls++;
      upstream = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
  });
  const a = new AbortController(),
    b = new AbortController();
  const one = cache.read("a", a.signal),
    two = cache.read("a", b.signal);
  const rejected = assert.rejects(one, { name: "AbortError" });
  await flush();
  a.abort();
  await rejected;
  assert.equal(upstream?.aborted, false);
  release!(new Response(new Uint8Array([7])));
  assert.deepEqual(await two, new Uint8Array([7]));
  assert.equal(calls, 1);
  const c = new AbortController();
  const three = cache.read("b", c.signal);
  const rejectedLast = assert.rejects(three, { name: "AbortError" });
  await flush();
  c.abort();
  await rejectedLast;
  assert.equal(upstream?.aborted, true);
  release!(new Response(new Uint8Array([8])));
  await flush();
  assert.equal(cache.diagnostics.entries, 1);
});
test("clear invalidates late completion and starts an independent generation", async () => {
  const releases: ((r: Response) => void)[] = [];
  const cache = new DynByteCache({
    fetcher: async () => new Promise<Response>((r) => releases.push(r)),
  });
  const old = cache.read("a", signal());
  const rejected = assert.rejects(old, { name: "AbortError" });
  await flush();
  cache.clear();
  const next = cache.read("a", signal());
  await flush();
  releases[1](new Response(new Uint8Array([2])));
  await next;
  releases[0](new Response(new Uint8Array([1])));
  await rejected;
  assert.deepEqual(await cache.read("a", signal()), new Uint8Array([2]));
});
test("failed HTTP, oversized bodies and evicted invalid science are fetched again", async () => {
  let calls = 0;
  const cache = new DynByteCache({
    maxResponseBytes: 2,
    fetcher: async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 503 })
        : new Response(new Uint8Array(calls === 2 ? [1, 2, 3] : [1]));
    },
  });
  await assert.rejects(cache.read("a", signal()), /HTTP 503/);
  await assert.rejects(cache.read("a", signal()), /byte budget/);
  await cache.read("a", signal());
  cache.evict("a");
  await cache.read("a", signal());
  assert.equal(calls, 4);
});
test("last owner cancels an active body reader without retaining partial bytes", async () => {
  let canceled = false;
  const cache = new DynByteCache({
    fetcher: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
      ),
  });
  const controller = new AbortController();
  const pending = cache.read("a", controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await flush();
  controller.abort();
  await rejected;
  await flush();
  assert.equal(canceled, true);
  assert.equal(cache.diagnostics.bytes, 0);
});
test("32 upstream waits, four body readers and 512 unique pending owners stay bounded and cancellable", async () => {
  let fetches = 0,
    readers = 0,
    canceled = 0;
  const releases: (() => void)[] = [];
  const cache = new DynByteCache({
    fetcher: async () => {
      fetches++;
      return new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              readers++;
              return new Promise<void>((resolve) =>
                releases.push(() => {
                  controller.enqueue(new Uint8Array([1]));
                  controller.close();
                  resolve();
                }),
              );
            },
            cancel() {
              canceled++;
            },
          },
          { highWaterMark: 0 },
        ),
      );
    },
  });
  const controller = new AbortController();
  const jobs = Array.from({ length: 512 }, (_, i) =>
    cache.read(String(i), controller.signal),
  );
  const settled = Promise.allSettled(jobs);
  await flush();
  assert.equal(fetches, 32);
  assert.equal(readers, 4);
  assert.equal(cache.diagnostics.pending, 512);
  await assert.rejects(
    cache.read("overflow", signal()),
    /pending request budget/,
  );
  controller.abort();
  const results = await settled;
  assert.ok(results.every((r) => r.status === "rejected"));
  await flush();
  assert.equal(cache.diagnostics.pending, 0);
  assert.equal(fetches, 32);
  assert.equal(canceled, 32);
});

test("foreground joins promote queued background network reads ahead of other background work", async () => {
  const started: string[] = [],
    headers = new Map<string, (response: Response) => void>();
  const controller = new AbortController(),
    cache = new DynByteCache({
      fetcher: async (input) => {
        const id = String(input);
        started.push(id);
        return new Promise<Response>((resolve) => headers.set(id, resolve));
      },
    });
  const active = Array.from({ length: 32 }, (_, i) =>
    cache.read(`active${i}`, controller.signal),
  );
  await flush();
  const background = cache.read("background", controller.signal, true),
    promoted = cache.read("promoted", controller.signal, true),
    foreground = cache.read("critical", controller.signal),
    joined = cache.read("promoted", controller.signal);
  await flush();
  assert.equal(started.length, 32);
  headers.get("active0")!(new Response(new Uint8Array([1])));
  await flush();
  assert.equal(started[32], "promoted");
  headers.get("active1")!(new Response(new Uint8Array([1])));
  await flush();
  assert.equal(started[33], "critical");
  controller.abort();
  await Promise.allSettled([
    ...active,
    background,
    promoted,
    foreground,
    joined,
  ]);
  for (const release of headers.values())
    release(new Response(new Uint8Array([1])));
});
test("foreground promotion also controls queued body readers without preempting four active readers", async () => {
  const reading: string[] = [],
    release = new Map<string, () => void>();
  const controller = new AbortController();
  const cache = new DynByteCache({
    fetcher: async (input) =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(stream) {
              const id = String(input);
              reading.push(id);
              return new Promise<void>((resolve) =>
                release.set(id, () => {
                  stream.enqueue(new Uint8Array([1]));
                  stream.close();
                  resolve();
                }),
              );
            },
          },
          { highWaterMark: 0 },
        ),
      ),
  });
  const active = Array.from({ length: 4 }, (_, i) =>
    cache.read(`active${i}`, controller.signal),
  );
  await flush();
  const background = cache.read("background", controller.signal, true),
    promoted = cache.read("promoted", controller.signal, true),
    foreground = cache.read("critical", controller.signal),
    joined = cache.read("promoted", controller.signal);
  await flush();
  assert.equal(reading.length, 4);
  release.get("active0")!();
  await flush();
  assert.equal(reading[4], "promoted");
  release.get("active1")!();
  await flush();
  assert.equal(reading[5], "critical");
  controller.abort();
  await Promise.allSettled([
    ...active,
    background,
    promoted,
    foreground,
    joined,
  ]);
});
test("background admission leaves bounded pending capacity for foreground source requests", async () => {
  const controller = new AbortController(),
    cache = new DynByteCache({
      fetcher: async (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal!.reason),
            { once: true },
          ),
        ),
    });
  const background = Array.from({ length: 448 }, (_, i) =>
    cache.read(String(i), controller.signal, true),
  );
  const settled = Promise.allSettled(background);
  await assert.rejects(
    cache.read("extra-background", controller.signal, true),
    /pending request budget/,
  );
  const foreground = cache.read("critical", controller.signal);
  const completed = Promise.allSettled([foreground]);
  assert.equal(cache.diagnostics.pending, 449);
  controller.abort();
  await settled;
  await completed;
  assert.equal(cache.diagnostics.pending, 0);
});
