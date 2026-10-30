import { test } from "node:test";
import assert from "node:assert/strict";
import { GalaxyService } from "./galaxy-server.ts";
test("unknown galaxy assets never request the source", async () => {
  let calls = 0;
  const service = new GalaxyService({
    directory: ".cache/test-galaxy-absent",
    fetch: async () => {
      calls++;
      throw Error("unexpected");
    },
  });
  await assert.rejects(
    service.get("../milkyway.webp", new AbortController().signal),
    /Unknown/,
  );
  assert.equal(calls, 0);
});
test(
  "shared source cancellation preserves the other subscriber and rejected identity can retry",
  { timeout: 3000 },
  async () => {
    let calls = 0,
      finish!: () => void,
      upstream!: AbortSignal,
      began!: () => void;
    let started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const service = new GalaxyService({
      directory: ".cache/test-galaxy-absent",
      fetch: async (_url, init) => {
        calls++;
        upstream = init!.signal!;
        const pending = new Promise<void>((resolve) => {
          finish = resolve;
        });
        began();
        await pending;
        return new Response(new Uint8Array(4));
      },
    });
    const a = new AbortController(),
      b = new AbortController();
    const first = service.get("milkyway.webp", a.signal),
      second = service.get("milkyway.webp", b.signal);
    await started;
    a.abort();
    await assert.rejects(first);
    assert.equal(upstream.aborted, false);
    finish();
    await assert.rejects(second, /identity/);
    started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const retry = service.get("milkyway.webp", new AbortController().signal);
    await started;
    finish();
    await assert.rejects(retry, /identity/);
    assert.equal(calls, 2);
  },
);
