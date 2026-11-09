import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NasaStaticStore } from "./nasa-static-store.ts";
import { StarfieldService } from "./starfield-server.ts";

test("persistent resources survive restart and reject corrupt bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "spaceeyes-static-"));
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const entry = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const signal = new AbortController().signal;
  try {
    const store = new NasaStaticStore(root);
    assert.equal(await store.read(entry, signal), undefined);
    await assert.rejects(store.write(entry, new Uint8Array([4, 3, 2, 1]), signal), /identity/);
    await store.write(entry, bytes, signal);
    assert.deepEqual(await new NasaStaticStore(root).read(entry, signal), bytes);
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(store.read(entry, cancelled.signal), { name: "AbortError" });
    await assert.rejects(store.write(entry, bytes, cancelled.signal), { name: "AbortError" });
    await writeFile(join(root, entry.sha256 + ".bin"), new Uint8Array([4, 3, 2, 1]));
    await assert.rejects(store.read(entry, signal), /identity/);
    await assert.rejects(store.read({ ...entry, sha256: "../outside" }, signal), /identity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("starfield reads a persistent source offline after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "spaceeyes-stars-"));
  const bytes = new Uint8Array([8, 7, 6]);
  const entry = { file: "stars.0.bin", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const signal = new AbortController().signal;
  try {
    const first = new StarfieldService([entry], new NasaStaticStore(root));
    assert.deepEqual(await first.get(entry.file, signal, async () => new Response(bytes)), bytes);
    const second = new StarfieldService([entry], new NasaStaticStore(root));
    assert.deepEqual(await second.get(entry.file, signal, async () => { throw Error("network used"); }), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
