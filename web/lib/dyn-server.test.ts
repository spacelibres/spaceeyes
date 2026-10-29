import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchDyn } from "./dyn-server.ts";
test("DYN rejects arbitrary identifiers before network", async () => {
  let called = false;
  await assert.rejects(
    fetchDyn("https://evil.test", new AbortController().signal, async () => {
      called = true;
      return new Response();
    }),
  );
  assert.equal(called, false);
});
test("DYN pinned source fetch policy and hash failure", async () => {
  await assert.rejects(
    fetchDyn(
      "earth-ori",
      new AbortController().signal,
      async (url, options) => {
        assert.equal(
          url,
          "https://eyes.nasa.gov/assets/dynamic/dynamo/earth/ori/def.dyn",
        );
        assert.equal(options?.cache, "no-store");
        assert.equal(options?.redirect, "error");
        return new Response(new Uint8Array(204));
      },
    ),
    /SHA256/,
  );
});
test("DYN surfaces HTTP and length failures", async () => {
  await assert.rejects(
    fetchDyn(
      "earth-orb",
      new AbortController().signal,
      async () => new Response(null, { status: 404 }),
    ),
    /HTTP/,
  );
  await assert.rejects(
    fetchDyn(
      "earth-ori",
      new AbortController().signal,
      async () => new Response(new Uint8Array(3)),
    ),
    /length/,
  );
});
test("DYN cancellation prevents request", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    fetchDyn("earth-ori", controller.signal, async () => {
      called = true;
      return new Response();
    }),
  );
  assert.equal(called, false);
});
test("DYN abort during streamed read discards result", async () => {
  const controller = new AbortController();
  await assert.rejects(
    fetchDyn(
      "earth-ori",
      controller.signal,
      async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              controller.abort();
              c.enqueue(new Uint8Array(204));
              c.close();
            },
          }),
        ),
    ),
  );
});

test("independent deadline cancels after fetch and discards body", async () => {
  const deadline = new AbortController();
  let cancelled = false;
  await assert.rejects(
    fetchDyn(
      "earth-ori",
      new AbortController().signal,
      async (_url, options) => {
        assert.ok(options?.signal);
        deadline.abort(new Error("deadline exceeded"));
        assert.equal(options?.signal?.aborted, true);
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
      deadline.signal,
    ),
    /deadline exceeded/,
  );
  assert.equal(cancelled, true);
});
test("independent deadline abort during read discards bytes", async () => {
  const deadline = new AbortController();
  await assert.rejects(
    fetchDyn(
      "earth-ori",
      new AbortController().signal,
      async () =>
        new Response(
          new ReadableStream({
            pull(c) {
              deadline.abort(new Error("deadline exceeded"));
              c.enqueue(new Uint8Array(204));
              c.close();
            },
          }),
        ),
      deadline.signal,
    ),
    /deadline exceeded/,
  );
});
