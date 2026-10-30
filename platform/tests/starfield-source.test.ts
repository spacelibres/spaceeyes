import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { StarfieldSource } from "../starfield-source.ts";
const bytes = new Uint8Array(27);
const view = new DataView(bytes.buffer);
view.setInt32(0, 1, true);
view.setFloat32(4, 2, true);
view.setFloat32(8, 1, true);
bytes.set([255, 128, 64], 12);
view.setFloat32(23, 1e15, true);
const entries = Array.from({ length: 7 }, (_, i) => ({
  file: i === 0 ? "stars.0.bin" : i === 6 ? "galaxies.0.bin" : `stars.${i}.bin`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
}));
function fixture() {
  const layers = new Map();
  const controller = new AbortController();
  const ctx = {
    signal: controller.signal,
    onDispose() {},
    visual: {
      starfield(id: string, spec: unknown) {
        if (spec) layers.set(id, spec);
        else layers.delete(id);
      },
    },
  } as any;
  return { layers, ctx, controller };
}
test("starfield source loads all seven layers with two reads and reuses verified cache after toggle", async () => {
  const { layers, ctx } = fixture();
  let reads = 0,
    active = 0,
    peak = 0;
  const source = new StarfieldSource(ctx, () => {}, {
    entries,
    fetch: async () => {
      reads++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return new Response(bytes);
    },
  });
  await source.enable(true);
  assert.equal(layers.size, 7);
  assert.equal(source.status().pointCount, 7);
  assert.equal(source.status().readyLayers, 7);
  assert.ok(peak <= 2);
  await source.enable(false);
  assert.equal(layers.size, 0);
  await source.enable(true);
  assert.equal(reads, 7);
  assert.equal(layers.size, 7);
  source.dispose();
  assert.equal(layers.size, 0);
});
test("disabled source does not publish delayed reads or begin queued work", async () => {
  const { layers, ctx } = fixture();
  let calls = 0;
  const releases: (() => void)[] = [];
  const source = new StarfieldSource(ctx, () => {}, {
    entries,
    fetch: async () => {
      calls++;
      await new Promise<void>((resolve) => releases.push(resolve));
      return new Response(bytes);
    },
  });
  const pending = source.enable(true);
  await new Promise((resolve) => setImmediate(resolve));
  await source.enable(false);
  releases.forEach((resolve) => resolve());
  await pending;
  assert.equal(calls, 2);
  assert.equal(layers.size, 0);
  assert.equal(source.status().enabled, false);
});
test("hash mismatch is isolated from good layers and explicit retry recovers", async () => {
  const { layers, ctx } = fixture();
  let corrupt = true;
  const source = new StarfieldSource(ctx, () => {}, {
    entries,
    fetch: async (input) => {
      const output = bytes.slice();
      if (corrupt && String(input).includes("stars.0.bin")) output[12] = 254;
      return new Response(output);
    },
  });
  await source.enable(true);
  assert.equal(layers.size, 6);
  assert.match(source.status().error, /SHA256/);
  corrupt = false;
  await source.retry();
  assert.equal(layers.size, 7);
  assert.equal(source.status().error, "");
  source.dispose();
});

test("LOD fetches bounded stellar prefixes, preserves raw samples and separates galaxies", async () => {
  const { layers, ctx } = fixture();
  let reads = 0;
  const source = new StarfieldSource(ctx, () => {}, {
    entries,
    fetch: async () => {
      reads++;
      return new Response(bytes);
    },
  });
  await assert.rejects(source.setLod(7));
  await source.setLod(0);
  await source.enable(true);
  assert.equal(reads, 2);
  assert.equal(layers.size, 2);
  assert.equal(layers.get("stars.0.bin").kind, "star");
  assert.equal(layers.get("galaxies.0.bin").kind, "galaxy");
  await source.setLod(6);
  assert.equal(reads, 7);
  assert.equal(layers.size, 7);
  await source.setLod(0);
  assert.equal(reads, 7);
  await source.enable(false);
  assert.equal(layers.size, 0);
  source.dispose();
  await assert.rejects(source.enable(true));
});
