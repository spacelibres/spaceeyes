import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NasaDynStore } from "./nasa-dyn-store.ts";
import { DynByteCache } from "./dyn-byte-cache.ts";

const url = "https://eyes.nasa.gov/assets/dynamic/dynamo/earth/sun/orb/def.dyn";
const signal = () => new AbortController().signal;

test("existing DYN mirror is read without network and stays untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "spaceeyes-dyn-"));
  try {
    const legacy = join(root, "legacy"), writable = join(root, "writable");
    await mkdir(join(legacy, "earth__sun__orb"), { recursive: true });
    await writeFile(join(legacy, "earth__sun__orb", "def.dyn"), new Uint8Array([1, 2, 3]));
    const store = new NasaDynStore({ root: writable, legacyRoot: legacy, offline: true });
    let calls = 0;
    const cache = new DynByteCache({ store, fetcher: async () => { calls++; throw Error("network used"); } });
    assert.deepEqual(await cache.read(url, signal()), new Uint8Array([1, 2, 3]));
    assert.equal(calls, 0);
    await assert.rejects(cache.read("https://eyes.nasa.gov/assets/dynamic/dynamo/earth/sun/orb/001.dyn", signal()), /local DYN unavailable/);
    await assert.rejects(store.read("https://example.com/x", signal()), /DYN source/);
    await assert.rejects(store.read("https://eyes.nasa.gov/assets/dynamic/dynamo/x/%2f/def.dyn", signal()), /DYN source/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("downloaded exact bytes survive restart and invalidation can refresh them", async () => {
  const root = await mkdtemp(join(tmpdir(), "spaceeyes-dyn-"));
  try {
    let calls = 0;
    const store = new NasaDynStore({ root });
    const fetcher: typeof fetch = async () => new Response(new Uint8Array([++calls]));
    const first = new DynByteCache({ store, fetcher });
    assert.deepEqual(await first.read(url, signal()), new Uint8Array([1]));
    const restarted = new DynByteCache({ store: new NasaDynStore({ root }), fetcher });
    assert.deepEqual(await restarted.read(url, signal()), new Uint8Array([1]));
    assert.equal(calls, 1);
    restarted.evict(url);
    assert.deepEqual(await restarted.read(url, signal()), new Uint8Array([2]));
    assert.equal(calls, 2);
    const offline = new DynByteCache({ store: new NasaDynStore({ root, offline: true }), fetcher });
    assert.deepEqual(await offline.read(url, signal()), new Uint8Array([2]));
    assert.equal(offline.evict(url), false, "strict offline must never retry upstream");
    await assert.rejects(offline.read(url, signal()), /local DYN unavailable/);
    assert.equal(calls, 2);
    await writeFile(join(root, "earth__sun__orb", "def.dyn.sedyn"), "invalid envelope");
    await assert.rejects(new NasaDynStore({ root }).read(url, signal()), /identity mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
