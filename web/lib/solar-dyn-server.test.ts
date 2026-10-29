import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSolarDyn } from "./solar-dyn-server.ts";
import { decodeDyn } from "../../platform/dyn-decoder.ts";

// v2 definition contains an index, while its child starts at flag/count, not version.
function fixtures() {
  const definition = new Uint8Array(44);
  const view = new DataView(definition.buffer);
  view.setInt16(0, 2, true);
  definition.set([111, 114, 98, 0, 3], 2);
  view.setFloat64(7, 4902, true);
  view.setFloat64(15, 398600, true);
  view.setInt32(24, 2, true);
  view.setFloat64(28, 0, true);
  view.setFloat64(36, 10, true);
  const child = new Uint8Array(5 + 2 * 72);
  const values = new DataView(child.buffer);
  child[0] = 1;
  values.setInt32(1, 2, true);
  for (const [index, time] of [0, 10].entries()) {
    [time, 384000, 0.05, 0.0000026, 0, 1, 0, 0, 0].forEach((x, field) =>
      values.setFloat64(5 + index * 72 + field * 8, x, true),
    );
  }
  return { definition, child };
}
const signal = () => new AbortController().signal;

test("Moon index resolves a headerless child and preserves the definition metadata", async () => {
  const { definition, child } = fixtures();
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    return new Response(path.endsWith("/def.dyn") ? definition : child);
  };
  const decoded = decodeDyn(await fetchSolarDyn("moon", 5, signal(), fetcher));
  assert.deepEqual(paths, [
    "/assets/dynamic/dynamo/moon/earth/orb/def.dyn",
    "/assets/dynamic/dynamo/moon/earth/orb/000.dyn",
  ]);
  assert.equal(decoded.kind, "inline");
  assert.equal(decoded.type, "orb");
  assert.equal(decoded.gravitationalParameter1, 4902);
  assert.deepEqual(decoded.coverage, { start: 0, end: 10 });
});

test("coverage rejection stops before requesting a child", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(fixtures().definition);
  };
  await assert.rejects(
    fetchSolarDyn("moon", 11, signal(), fetcher),
    /Outside source coverage/,
  );
  assert.equal(calls, 1);
});

test("request cancellation is passed to the upstream fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher: typeof fetch = async (_input, init) => {
    assert.ok(init?.signal?.aborted);
    init.signal.throwIfAborted();
    throw Error("unreachable");
  };
  await assert.rejects(fetchSolarDyn("moon", 5, controller.signal, fetcher), {
    name: "AbortError",
  });
});

test("unknown objects, origin-only Sun and nonfinite epochs never fetch", async () => {
  const fetcher: typeof fetch = async () => {
    throw Error("unexpected network");
  };
  for (const [id, epoch] of [
    ["unknown", 5],
    ["sun", 5],
    ["moon", NaN],
  ] as const)
    await assert.rejects(
      fetchSolarDyn(id, epoch, signal(), fetcher),
      /Invalid solar resource/,
    );
});
