import test from "node:test";
import assert from "node:assert/strict";
import { starfieldFile } from "./starfield-server.ts";
test("unknown paths never fetch", async () => {
  await assert.rejects(
    starfieldFile("../stars.0.bin", new AbortController().signal, async () => {
      throw new Error("must not fetch");
    }),
    /Unknown/,
  );
});
test("untrusted bytes fail identity", async () => {
  await assert.rejects(
    starfieldFile(
      "galaxies.0.bin",
      new AbortController().signal,
      async () => new Response(new Uint8Array(4)),
    ),
    /identity/,
  );
});
import { createHash } from "node:crypto";
import { StarfieldService } from "./starfield-server.ts";
const bytes = new Uint8Array([1, 2, 3]);
const entries = Array.from({ length: 5 }, (_, i) => ({
  file: `stars.${i}.bin`,
  bytes: 3,
  sha256: createHash("sha256").update(bytes).digest("hex"),
}));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test(
  "immediate retry after rejected identity starts a fresh shared job",
  { timeout: 1000 },
  async () => {
    const service = new StarfieldService(entries);
    let calls = 0;
    const fetcher: typeof fetch = async () =>
      new Response(++calls === 1 ? new Uint8Array([3, 2, 1]) : bytes);
    await assert.rejects(
      service.get(entries[0].file, new AbortController().signal, fetcher),
      /identity/,
    );
    assert.deepEqual(
      await service.get(entries[0].file, new AbortController().signal, fetcher),
      bytes,
    );
    assert.equal(calls, 2);
  },
);
test("shared fetch survives one abort and valid bytes are cached", async () => {
  const service = new StarfieldService(entries);
  let calls = 0;
  let finish!: () => void;
  let upstream!: AbortSignal;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    upstream = init!.signal!;
    await new Promise<void>((r) => (finish = r));
    return new Response(bytes);
  };
  const a = new AbortController(),
    b = new AbortController();
  const first = service.get(entries[0].file, a.signal, fetcher),
    second = service.get(entries[0].file, b.signal, fetcher);
  a.abort();
  await assert.rejects(first);
  assert.equal(upstream.aborted, false);
  finish();
  assert.deepEqual(await second, bytes);
  assert.deepEqual(
    await service.get(entries[0].file, b.signal, fetcher),
    bytes,
  );
  assert.equal(calls, 1);
});
test("all subscribers cancel upstream, queued cancellation never fetches, concurrency stays two", async () => {
  const service = new StarfieldService(entries);
  let active = 0,
    peak = 0,
    calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((_, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => reject(init!.signal!.reason),
          { once: true },
        ),
      );
      throw new Error("unreachable");
    } finally {
      active--;
    }
  };
  const controllers = entries.map(() => new AbortController());
  const jobs = entries
    .slice(0, 3)
    .map((e, i) =>
      service.get(e.file, controllers[i].signal, fetcher).catch(() => {}),
    );
  controllers[2].abort();
  controllers[0].abort();
  jobs.push(
    service
      .get(entries[3].file, controllers[3].signal, fetcher)
      .catch(() => {}),
  );
  await tick();
  assert.equal(calls, 3);
  assert.equal(peak, 2);
  controllers[1].abort();
  controllers[3].abort();
  await Promise.all(jobs);
  await tick();
  assert.equal(active, 0);
  assert.equal(calls, 3);
});
