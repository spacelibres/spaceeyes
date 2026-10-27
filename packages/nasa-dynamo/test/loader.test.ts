// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import assert from "node:assert/strict";
import test from "node:test";

import {
  DynamoLoadError,
  DynamoSegmentLoader,
  evaluateEphemeris,
  parseDyn,
  referenceBodyOf,
  segmentPath,
  selectSegment,
  type DynamoTransport,
} from "../src/index.js";
import {
  DynWriter,
  header,
  linPoint,
  orbPoint,
  posPoint,
  quatPoint,
} from "./helpers.js";

class FakeTransport implements DynamoTransport {
  readonly calls: string[] = [];
  readonly files = new Map<string, Uint8Array>();
  readonly failures = new Set<string>();

  async fetchBytes(path: string): Promise<Uint8Array> {
    this.calls.push(path);
    if (this.failures.has(path)) throw new Error(`boom: ${path}`);
    const bytes = this.files.get(path);
    if (bytes === undefined) throw new Error(`missing: ${path}`);
    return bytes;
  }
}

function inlineOrb(path: string): Uint8Array {
  void path;
  return orbPoint(
    orbPoint(
      header({ version: 2, type: "orb", inline: true }).i32(2),
      0,
      1,
      0,
      1,
      0,
    ),
    1,
    1,
    0,
    1,
    0,
  ).toBytes();
}

function indexFile(): Uint8Array {
  return header({ version: 2, type: "pos", digits: 3, inline: false })
    .i32(3)
    .f64(-50)
    .f64(0)
    .f64(100)
    .toBytes();
}

function posSegment(times: readonly [number, number]): Uint8Array {
  return posPoint(
    posPoint(
      new DynWriter().u8(1).i32(2),
      times[0],
      [times[0], 0, 0],
      [1, 0, 0],
    ),
    times[1],
    [times[1], 0, 0],
    [1, 0, 0],
  ).toBytes();
}

test("derives reference bodies and segment paths from controller paths", () => {
  assert.equal(referenceBodyOf("moon/earth/orb/def.dyn"), "earth");
  assert.equal(referenceBodyOf("sc_juno/jupiter"), "jupiter");
  assert.equal(referenceBodyOf("earth/ori"), null);
  assert.equal(referenceBodyOf("sc_juice/quat"), null);
  assert.equal(referenceBodyOf("sc_pioneer_10/sun/1/orb"), "sun");
  assert.equal(referenceBodyOf(""), null);
  assert.equal(
    segmentPath("ganymede/jupiter/orb/def.dyn", 3, 122),
    "ganymede/jupiter/orb/122.dyn",
  );
  assert.equal(
    segmentPath("ganymede/jupiter/orb/def.dyn", 0, 7),
    "ganymede/jupiter/orb/7.dyn",
  );
  assert.throws(() => segmentPath("def.dyn", 3, 1), RangeError);
  assert.throws(() => segmentPath("a/def.dyn", -1, 1), RangeError);
});

test("selects the last segment whose start covers the query", () => {
  const file = parseDyn(indexFile());
  assert.equal(selectSegment(file.segments, -100)?.index, 0);
  assert.equal(selectSegment(file.segments, 0)?.index, 1);
  assert.equal(selectSegment(file.segments, 99)?.index, 1);
  assert.equal(selectSegment(file.segments, 100)?.index, 2);
  assert.equal(selectSegment(file.segments, 1e9)?.index, 2);
  assert.equal(selectSegment([], 0), null);
});

test("loads inline files without fetching a segment", async () => {
  const transport = new FakeTransport();
  transport.files.set(
    "earth/sun/orb/def.dyn",
    inlineOrb("earth/sun/orb/def.dyn"),
  );
  const loader = new DynamoSegmentLoader(transport);
  const loaded = await loader.load("earth/sun/orb/def.dyn", 0);
  assert.deepEqual(transport.calls, ["earth/sun/orb/def.dyn"]);
  assert.equal(loaded.points.length, 2);
  assert.equal(loaded.source.segment, null);
  assert.equal(loaded.relTo, "sun");
  assert.deepEqual(loaded.interval, { min: 0, max: 1 });
});

test("fetches only the covering continuation segment and caches results", async () => {
  const transport = new FakeTransport();
  transport.files.set("ganymede/jupiter/orb/def.dyn", indexFile());
  transport.files.set("ganymede/jupiter/orb/001.dyn", posSegment([10, 20]));
  transport.files.set("ganymede/jupiter/orb/002.dyn", posSegment([100, 200]));
  const loader = new DynamoSegmentLoader(transport, { bucketSeconds: 10 });

  const first = await loader.load("ganymede/jupiter/orb/def.dyn", 5);
  assert.deepEqual(transport.calls, [
    "ganymede/jupiter/orb/def.dyn",
    "ganymede/jupiter/orb/001.dyn",
  ]);
  assert.equal(first.source.segment, "1");
  assert.equal(first.relTo, "jupiter");

  const cached = await loader.load("ganymede/jupiter/orb/def.dyn", 6);
  assert.equal(cached, first);
  assert.equal(transport.calls.length, 2);

  const later = await loader.load("ganymede/jupiter/orb/def.dyn", 150);
  assert.deepEqual(transport.calls.slice(2), ["ganymede/jupiter/orb/002.dyn"]);
  assert.equal(later.source.segment, "2");
  assert.deepEqual(later.interval, { min: 100, max: 200 });

  const state = evaluateEphemeris(
    {
      header: later.file.header,
      points: later.points,
      interval: later.interval,
    },
    150,
  );
  assert.equal(state.status, "ready");
});

test("bounds the cache and reloads evicted indexes", async () => {
  const transport = new FakeTransport();
  transport.files.set("a/sun/orb/def.dyn", inlineOrb("a"));
  transport.files.set("b/sun/orb/def.dyn", inlineOrb("b"));
  const loader = new DynamoSegmentLoader(transport, { maxCacheEntries: 1 });
  await loader.load("a/sun/orb/def.dyn", 0);
  await loader.load("b/sun/orb/def.dyn", 0);
  await loader.load("a/sun/orb/def.dyn", 0);
  assert.equal(transport.calls.length, 3);
});

test("reports no-data, fetch, parse, abort and segment-limit failures", async () => {
  const emptyIndex = header({ version: 2, type: "pos", inline: false })
    .i32(0)
    .toBytes();
  const emptyTransport = new FakeTransport();
  emptyTransport.files.set("a/sun/pos/def.dyn", emptyIndex);
  const emptyLoader = new DynamoSegmentLoader(emptyTransport);
  await assert.rejects(
    emptyLoader.load("a/sun/pos/def.dyn", 0),
    (error: unknown) => {
      assert.ok(error instanceof DynamoLoadError);
      assert.equal(error.code, "no-data");
      return true;
    },
  );

  const failing = new FakeTransport();
  failing.failures.add("a/sun/pos/def.dyn");
  const failingLoader = new DynamoSegmentLoader(failing);
  await assert.rejects(
    failingLoader.load("a/sun/pos/def.dyn", 0),
    (error: unknown) => {
      assert.ok(error instanceof DynamoLoadError);
      assert.equal(error.code, "fetch-failed");
      return true;
    },
  );

  const invalid = new FakeTransport();
  invalid.files.set("a/sun/pos/def.dyn", Uint8Array.from([0, 0, 1]));
  const invalidLoader = new DynamoSegmentLoader(invalid);
  await assert.rejects(
    invalidLoader.load("a/sun/pos/def.dyn", 0),
    (error: unknown) => {
      assert.ok(error instanceof DynamoLoadError);
      assert.equal(error.code, "invalid-data");
      return true;
    },
  );

  const controller = new AbortController();
  controller.abort();
  const abortedLoader = new DynamoSegmentLoader(new FakeTransport());
  await assert.rejects(
    abortedLoader.load("a/sun/pos/def.dyn", 0, controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof DynamoLoadError);
      assert.equal(error.code, "aborted");
      return true;
    },
  );

  const many = new FakeTransport();
  many.files.set("a/sun/pos/def.dyn", indexFile());
  const limited = new DynamoSegmentLoader(many, { maxSegments: 1 });
  await assert.rejects(
    limited.load("a/sun/pos/def.dyn", 0),
    (error: unknown) => {
      assert.ok(error instanceof DynamoLoadError);
      assert.equal(error.code, "invalid-data");
      return true;
    },
  );
});

test("loads orientation-only controllers with no parent body", async () => {
  const transport = new FakeTransport();
  const bytes = quatPoint(
    quatPoint(header({ version: 2, type: "quat", inline: true }).i32(2), 0, {
      w: 1,
      x: 0,
      y: 0,
      z: 0,
    }),
    1,
    { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 },
  ).toBytes();
  transport.files.set("earth/ori/def.dyn", bytes);
  const loader = new DynamoSegmentLoader(transport);
  const loaded = await loader.load("earth/ori/def.dyn", 0);
  assert.equal(loaded.relTo, null);
  assert.equal(loaded.file.header.pointType, "quat");
});

test("keeps lin segment loading consistent with the index point type", async () => {
  const transport = new FakeTransport();
  transport.files.set(
    "a/sun/lin/def.dyn",
    header({ version: 2, type: "lin", digits: 2, inline: false })
      .i32(1)
      .f64(0)
      .toBytes(),
  );
  transport.files.set(
    "a/sun/lin/00.dyn",
    linPoint(
      linPoint(new DynWriter().u8(1).i32(2), 0, [0, 0, 0]),
      1,
      [1, 2, 3],
    ).toBytes(),
  );
  const loader = new DynamoSegmentLoader(transport);
  const loaded = await loader.load("a/sun/lin/def.dyn", 0);
  assert.equal(loaded.source.segment, "0");
  assert.deepEqual(loaded.interval, { min: 0, max: 1 });
});
