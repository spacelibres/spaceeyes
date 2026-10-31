import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import dependencies from "../../validation/eyes-dependencies.json" with { type: "json" };
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { EyesAssetService } from "./eyes-assets.ts";
test("asset service rejects unknown objects and paths before network and honors cancellation", async () => {
  let calls = 0;
  const cache = await mkdtemp(join(tmpdir(), "eyes-assets-"));
  try {
    const service = new EyesAssetService({
      cacheDirectory: cache,
      fetch: async () => {
        calls++;
        throw Error("network");
      },
    });
    await assert.rejects(service.get("unknown-object", "model.glb"), /Unknown/);
    await assert.rejects(service.get("__proto__", "model.glb"), /Unknown/);
    await assert.rejects(service.get("sc_juno", "../secret"), /path/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      service.get("sc_juno", "model.glb", controller.signal),
      { name: "AbortError" },
    );
    assert.equal(calls, 0);
  } finally {
    assert.equal(dirname(resolve(cache)), resolve(tmpdir()));
    assert.ok(basename(cache).startsWith("eyes-assets-"));
    await rm(cache, { recursive: true, force: true });
  }
});

test("changed dependency bytes are refused even when buffer lengths still match the glTF declaration", async () => {
  const cache = await mkdtemp(join(tmpdir(), "eyes-assets-"));
  const manifest = await readFile(
    new URL("./fixtures/eyes-generic-model.gltf", import.meta.url),
  );
  const service = new EyesAssetService({
    cacheDirectory: cache,
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith("generic_asteroid_1.gltf"))
        return new Response(manifest);
      const source = (dependencies.files as Record<string, { bytes: number }>)[
        url
      ];
      assert.ok(source);
      return new Response(new Uint8Array(source.bytes));
    },
  });
  try {
    await assert.rejects(
      service.get("adrastea", "model.glb"),
      /SHA256 mismatch/,
    );
  } finally {
    assert.equal(dirname(resolve(cache)), resolve(tmpdir()));
    assert.ok(basename(cache).startsWith("eyes-assets-"));
    await rm(cache, { recursive: true, force: true });
  }
});

test("shared model fetch stays alive for another subscriber and cancels when the last leaves", async () => {
  const cache = await mkdtemp(join(tmpdir(), "eyes-assets-"));
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  let calls = 0;
  const service = new EyesAssetService({
    cacheDirectory: cache,
    fetch: async (_input, options) => {
      calls++;
      started();
      return new Promise<Response>((_resolve, reject) =>
        options!.signal!.addEventListener(
          "abort",
          () => reject(options!.signal!.reason),
          { once: true },
        ),
      );
    },
  });
  try {
    const a = new AbortController(),
      b = new AbortController();
    const one = service
      .get("sc_juno", "model.glb", a.signal)
      .catch((e) => e.name);
    const two = service
      .get("sc_juno", "model.glb", b.signal)
      .catch((e) => e.name);
    await ready;
    a.abort();
    assert.equal(await one, "AbortError");
    assert.equal(calls, 1);
    b.abort();
    assert.equal(await two, "AbortError");
  } finally {
    assert.equal(dirname(resolve(cache)), resolve(tmpdir()));
    assert.ok(basename(cache).startsWith("eyes-assets-"));
    await rm(cache, { recursive: true, force: true });
  }
});

test("cancelled scene requests free queue capacity before slow active downloads finish", async () => {
  const { eyesDefinitions } = await import("../../platform/eyes-catalog.ts");
  const cache = await mkdtemp(join(tmpdir(), "eyes-assets-"));
  const controllers: AbortController[] = [];
  const requests: Promise<unknown>[] = [];
  let running = 0;
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  const service = new EyesAssetService({
    cacheDirectory: cache,
    fetch: async (_input, init) => {
      if (++running === 2) started();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    },
  });
  const request = (id: string, file = "face-0.png") => {
    const controller = new AbortController();
    controllers.push(controller);
    const result = service
      .get(id, file, controller.signal)
      .catch((error) => error);
    requests.push(result);
    return { controller, result };
  };
  try {
    request("io");
    request("moon");
    await ready;
    const queued = Object.keys(eyesDefinitions)
      .filter((id) => id !== "io" && id !== "moon")
      .slice(0, 64)
      .map((id) => request(id));
    await new Promise<void>((done) => setImmediate(done));
    for (const item of queued) item.controller.abort();
    await Promise.all(queued.map((item) => item.result));
    await new Promise<void>((done) => setImmediate(done));
    let outcome: unknown;
    const current = request("io", "face-1.png");
    void current.result.then((value) => {
      outcome = value;
    });
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(
      outcome,
      undefined,
      "new scene must queue instead of failing against cancelled backlog",
    );
    assert.equal(
      running,
      2,
      "cancelled queued requests must never start a source download",
    );
    current.controller.abort();
    assert.equal((await current.result).name, "AbortError");
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.all(requests);
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(dirname(resolve(cache)), resolve(tmpdir()));
    assert.ok(basename(cache).startsWith("eyes-assets-"));
    await rm(cache, { recursive: true, force: true });
  }
});

test(
  "scene queue keeps FIFO delivery and transfers only one slot after cancellation",
  { timeout: 5000 },
  async () => {
    const cache = await mkdtemp(join(tmpdir(), "eyes-assets-"));
    const calls: string[] = [];
    const releases: (() => void)[] = [];
    let twoStarted!: () => void, thirdStarted!: () => void;
    const two = new Promise<void>((done) => {
      twoStarted = done;
    });
    const third = new Promise<void>((done) => {
      thirdStarted = done;
    });
    const service = new EyesAssetService({
      cacheDirectory: cache,
      fetch: async (input) => {
        calls.push(String(input));
        if (calls.length === 2) twoStarted();
        if (calls.length === 3) thirdStarted();
        await new Promise<void>((done) => releases.push(done));
        return new Response("missing", { status: 404 });
      },
    });
    const requests: Promise<unknown>[] = [];
    const get = (id: string, signal?: AbortSignal) => {
      const p = service.get(id, "face-0.png", signal).catch((error) => error);
      requests.push(p);
      return p;
    };
    try {
      const first = get("io"),
        second = get("moon");
      await two;
      const cancelled = new AbortController();
      const stale = get("callisto", cancelled.signal);
      const current = get("ganymede");
      await new Promise<void>((done) => setImmediate(done));
      cancelled.abort();
      assert.equal((await stale).name, "AbortError");
      releases[0]();
      // Cache I/O may deliver Moon before Io; release whichever download started first.
      await Promise.race([first, second]);
      await third;
      assert.equal(calls.length, 3);
      assert.ok(calls[2].includes("/ganymede/"));
      assert.ok(calls.every((url) => !url.includes("/callisto/")));
      releases[1]();
      releases[2]();
      assert.match(String(await first), /HTTP 404/);
      assert.match(String(await second), /HTTP 404/);
      assert.match(String(await current), /HTTP 404/);
    } finally {
      for (const release of releases) release();
      await Promise.all(requests);
      assert.equal(dirname(resolve(cache)), resolve(tmpdir()));
      assert.ok(basename(cache).startsWith("eyes-assets-"));
      await rm(cache, { recursive: true, force: true });
    }
  },
);
