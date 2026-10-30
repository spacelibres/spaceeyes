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
