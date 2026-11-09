import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("invalid legacy DYN retries the approved upstream once in the same request", async () => {
  const root = await mkdtemp(join(tmpdir(), "spaceeyes-dyn-fallback-"));
  const oldFetch = globalThis.fetch;
  const oldMirror = process.env.SPACEEYES_NASA_DYN_MIRROR;
  const oldRoot = process.env.SPACEEYES_NASA_DYN_ROOT;
  const oldOffline = process.env.SPACEEYES_NASA_DYN_OFFLINE;
  try {
    const mirror = join(root, "mirror");
    await mkdir(join(mirror, "earth__sun__orb"), { recursive: true });
    await writeFile(join(mirror, "earth__sun__orb", "def.dyn"), new Uint8Array([1]));
    process.env.SPACEEYES_NASA_DYN_MIRROR = mirror;
    process.env.SPACEEYES_NASA_DYN_ROOT = join(root, "persistent");
    delete process.env.SPACEEYES_NASA_DYN_OFFLINE;
    const source = new Uint8Array(172), view = new DataView(source.buffer);
    view.setInt16(0, 2, true); source.set([111, 114, 98, 0, 3], 2);
    view.setFloat64(7, 4902, true); view.setFloat64(15, 398600, true);
    source[23] = 1; view.setInt32(24, 2, true);
    for (const [i, time] of [0, 10].entries())
      [time, 10000, .05, .001, 0, 1, 0, 0, 0].forEach((x, j) => view.setFloat64(28 + i * 72 + j * 8, x, true));
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(source); };
    const { fetchSolarDyn } = await import("./solar-dyn-server.ts");
    assert.deepEqual(await fetchSolarDyn("earth", 5, new AbortController().signal), source);
    assert.equal(calls, 1);
    await assert.rejects(fetchSolarDyn("earth", 20, new AbortController().signal), /Outside source coverage/);
    assert.equal(calls, 1, "known absence of coverage is not a transport retry");
    await mkdir(join(mirror, "mars__sun__orb"), { recursive: true });
    await writeFile(join(mirror, "mars__sun__orb", "def.dyn"), new Uint8Array([1]));
    globalThis.fetch = async () => { calls++; return new Response(new Uint8Array([1])); };
    await assert.rejects(fetchSolarDyn("mars", 5, new AbortController().signal), /Invalid DYN type header/);
    assert.equal(calls, 2, "a malformed upstream is attempted only once");
    const index = new Uint8Array(44), indexView = new DataView(index.buffer);
    indexView.setInt16(0, 2, true); index.set([111, 114, 98, 0, 3], 2);
    indexView.setFloat64(7, 4902, true); indexView.setFloat64(15, 398600, true);
    index[23] = 0; indexView.setInt32(24, 2, true);
    indexView.setFloat64(28, 0, true); indexView.setFloat64(36, 10, true);
    await mkdir(join(mirror, "jupiter__sun__orb"), { recursive: true });
    await writeFile(join(mirror, "jupiter__sun__orb", "def.dyn"), index);
    const requested: string[] = [];
    globalThis.fetch = async input => { requested.push(String(input)); return new Response(null, { status: 503 }); };
    await assert.rejects(fetchSolarDyn("jupiter", 5, new AbortController().signal), /HTTP 503/);
    assert.equal(requested.length, 1, "a failed child request must not refetch a valid local root");
    assert.ok(requested[0].endsWith("/000.dyn"));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldMirror === undefined) delete process.env.SPACEEYES_NASA_DYN_MIRROR; else process.env.SPACEEYES_NASA_DYN_MIRROR = oldMirror;
    if (oldRoot === undefined) delete process.env.SPACEEYES_NASA_DYN_ROOT; else process.env.SPACEEYES_NASA_DYN_ROOT = oldRoot;
    if (oldOffline === undefined) delete process.env.SPACEEYES_NASA_DYN_OFFLINE; else process.env.SPACEEYES_NASA_DYN_OFFLINE = oldOffline;
    await rm(root, { recursive: true, force: true });
  }
});
