// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DYNAMO_BYTES,
  NASA_DYNAMO_MANIFEST,
  NasaDynamoPlugin,
  evaluateEphemeris,
  parseDyn,
  type DynFile,
  type EphemerisWindow,
  type Quat,
  type Vec3,
} from "../src/index.js";
import {
  DynWriter,
  header,
  linPoint,
  orbPoint,
  oriPoint,
  posPoint,
  quatPoint,
} from "./helpers.js";

const SQRT_HALF = Math.SQRT1_2;

function close(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, received ${actual} (tolerance ${tolerance})`,
  );
}

function closeVec(
  actual: Vec3,
  expected: readonly [number, number, number],
  tolerance = 1e-12,
): void {
  close(actual.x, expected[0], tolerance);
  close(actual.y, expected[1], tolerance);
  close(actual.z, expected[2], tolerance);
}

function closeQuat(
  actual: Quat,
  expected: readonly [number, number, number, number],
  tolerance = 1e-12,
): void {
  const dot =
    actual.w * expected[0] +
    actual.x * expected[1] +
    actual.y * expected[2] +
    actual.z * expected[3];
  const sign = dot < 0 ? -1 : 1;
  close(actual.w, sign * expected[0], tolerance);
  close(actual.x, sign * expected[1], tolerance);
  close(actual.y, sign * expected[2], tolerance);
  close(actual.z, sign * expected[3], tolerance);
}

function windowOf(file: DynFile): EphemerisWindow {
  assert.ok(file.interval !== null);
  return { header: file.header, points: file.points, interval: file.interval };
}

function circularOrb(gm1 = 1, gm2 = 1): EphemerisWindow {
  const bytes = orbPoint(
    orbPoint(
      header({ version: 2, type: "orb", inline: true, gm1, gm2 }).i32(2),
      0,
      1,
      0,
      1,
      0,
    ),
    2 * Math.PI,
    1,
    0,
    1,
    0,
  ).toBytes();
  return windowOf(parseDyn(bytes));
}

test("evaluates a circular orbit at endpoints and mid-span", () => {
  const window = circularOrb();
  const atZero = evaluateEphemeris(window, 0);
  assert.equal(atZero.status, "ready");
  if (atZero.status === "ready" && atZero.kind === "position") {
    closeVec(atZero.position, [1, 0, 0]);
    closeVec(atZero.velocity, [0, 1, 0]);
  }

  const atQuarter = evaluateEphemeris(window, Math.PI / 2);
  assert.equal(atQuarter.status, "ready");
  if (atQuarter.status === "ready" && atQuarter.kind === "position") {
    closeVec(atQuarter.position, [0, 1, 0]);
    closeVec(atQuarter.velocity, [-1, 0, 0]);
  }

  const atOne = evaluateEphemeris(window, 1);
  assert.equal(atOne.status, "ready");
  if (atOne.status === "ready" && atOne.kind === "position") {
    closeVec(atOne.position, [Math.cos(1), Math.sin(1), 0], 1e-9);
    closeVec(atOne.velocity, [-Math.sin(1), Math.cos(1), 0], 1e-9);
  }
});

test("applies barycentric body factors to orbit results", () => {
  const window = circularOrb(1, 3);
  const relative = evaluateEphemeris(window, 0);
  const primary = evaluateEphemeris(window, 0, { body: 1 });
  const central = evaluateEphemeris(window, 0, { body: 2 });
  assert.equal(relative.status, "ready");
  assert.equal(primary.status, "ready");
  assert.equal(central.status, "ready");
  if (
    relative.status === "ready" &&
    relative.kind === "position" &&
    primary.status === "ready" &&
    primary.kind === "position" &&
    central.status === "ready" &&
    central.kind === "position"
  ) {
    closeVec(relative.position, [1, 0, 0]);
    closeVec(primary.position, [0.75, 0, 0]);
    closeVec(central.position, [-0.25, 0, 0]);
  }
});

test("uses cubic Hermite interpolation for pos samples", () => {
  const bytes = posPoint(
    posPoint(
      header({ version: 2, type: "pos", inline: true }).i32(2),
      0,
      [0, 0, 0],
      [1, 0, 0],
    ),
    10,
    [10, 0, 0],
    [1, 0, 0],
  ).toBytes();
  const window = windowOf(parseDyn(bytes));
  for (const [time, expected] of [
    [0, [0, 0, 0]],
    [5, [5, 0, 0]],
    [10, [10, 0, 0]],
  ] as const) {
    const state = evaluateEphemeris(window, time);
    assert.equal(state.status, "ready");
    if (state.status === "ready" && state.kind === "position") {
      closeVec(state.position, expected);
      closeVec(state.velocity, [1, 0, 0]);
    }
  }
});

test("uses clamped linear interpolation for lin samples", () => {
  const bytes = linPoint(
    linPoint(
      header({ version: 2, type: "lin", inline: true }).i32(2),
      0,
      [0, 0, 0],
    ),
    2,
    [4, 2, 0],
  ).toBytes();
  const window = windowOf(parseDyn(bytes));
  const state = evaluateEphemeris(window, 1);
  assert.equal(state.status, "ready");
  if (state.status === "ready" && state.kind === "position") {
    closeVec(state.position, [2, 1, 0]);
    closeVec(state.velocity, [2, 1, 0]);
  }
});

test("slerps quaternion samples and handles the -q equivalence", () => {
  const build = (sign: number): EphemerisWindow => {
    const bytes = quatPoint(
      quatPoint(header({ version: 2, type: "quat", inline: true }).i32(2), 0, {
        w: 1,
        x: 0,
        y: 0,
        z: 0,
      }),
      2,
      { w: sign * SQRT_HALF, x: 0, y: 0, z: sign * SQRT_HALF },
    ).toBytes();
    return windowOf(parseDyn(bytes));
  };
  for (const sign of [1, -1]) {
    const state = evaluateEphemeris(build(sign), 1);
    assert.equal(state.status, "ready");
    if (state.status === "ready" && state.kind === "orientation") {
      closeQuat(state.orientation, [
        Math.cos(Math.PI / 8),
        0,
        0,
        Math.sin(Math.PI / 8),
      ]);
      closeVec(state.angularVelocity, [0, 0, 0]);
    }
  }
});

test("projects ori samples with q * conj and negates interpolation velocity", () => {
  const bytes = oriPoint(
    oriPoint(
      header({ version: 2, type: "ori", inline: true }).i32(2),
      0,
      { w: 1, x: 0, y: 0, z: 0 },
      [0, 0, Math.PI / 2],
    ),
    2,
    { w: 1, x: 0, y: 0, z: 0 },
    [0, 0, Math.PI / 2],
  ).toBytes();
  const window = windowOf(parseDyn(bytes));
  for (const time of [0, 1, 2]) {
    const state = evaluateEphemeris(window, time);
    assert.equal(state.status, "ready");
    if (state.status === "ready" && state.kind === "orientation") {
      closeQuat(state.orientation, [1, 0, 0, 0]);
      closeVec(state.angularVelocity, [0, 0, -Math.PI / 2]);
    }
  }
});

test("slerps non-degenerate ori samples between projected endpoints", () => {
  const bytes = oriPoint(
    oriPoint(
      header({ version: 2, type: "ori", inline: true }).i32(2),
      0,
      { w: 1, x: 0, y: 0, z: 0 },
      [0, 0, 0],
    ),
    2,
    { w: SQRT_HALF, x: 0, y: 0, z: SQRT_HALF },
    [0, 0, 0],
  ).toBytes();
  const state = evaluateEphemeris(windowOf(parseDyn(bytes)), 1);
  assert.equal(state.status, "ready");
  if (state.status === "ready" && state.kind === "orientation") {
    closeQuat(state.orientation, [
      Math.cos(Math.PI / 8),
      0,
      0,
      Math.sin(Math.PI / 8),
    ]);
    closeVec(state.angularVelocity, [0, 0, 0]);
  }
});

test("rejects out-of-range, duplicate, mismatched and non-finite windows", () => {
  const window = circularOrb();
  assert.deepEqual(evaluateEphemeris(window, -1), {
    status: "unavailable",
    reason: "out-of-range",
  });
  assert.deepEqual(evaluateEphemeris(window, 2 * Math.PI + 1), {
    status: "unavailable",
    reason: "out-of-range",
  });
  assert.deepEqual(evaluateEphemeris(window, Number.NaN), {
    status: "unavailable",
    reason: "invalid-samples",
  });

  const duplicate = linPoint(
    linPoint(
      header({ version: 2, type: "lin", inline: true }).i32(2),
      0,
      [0, 0, 0],
    ),
    0,
    [1, 0, 0],
  ).toBytes();
  assert.equal(
    evaluateEphemeris(windowOf(parseDyn(duplicate)), 0).status,
    "unavailable",
  );

  const mixed = windowOf(parseDyn(duplicate));
  assert.deepEqual(
    evaluateEphemeris(
      { ...mixed, header: { ...mixed.header, pointType: "pos" } },
      0,
    ),
    { status: "unavailable", reason: "invalid-samples" },
  );

  const zeroQuat = quatPoint(
    quatPoint(header({ version: 2, type: "quat", inline: true }).i32(2), 0, {
      w: 0,
      x: 0,
      y: 0,
      z: 0,
    }),
    1,
    { w: 1, x: 0, y: 0, z: 0 },
  ).toBytes();
  assert.equal(
    evaluateEphemeris(windowOf(parseDyn(zeroQuat)), 0).status,
    "unavailable",
  );

  const single = linPoint(
    header({ version: 2, type: "lin", inline: true }).i32(1),
    0,
    [0, 0, 0],
  ).toBytes();
  assert.equal(
    evaluateEphemeris(windowOf(parseDyn(single)), 0).status,
    "unavailable",
  );

  const nanPosition = posPoint(
    posPoint(
      header({ version: 2, type: "pos", inline: true }).i32(2),
      0,
      [Number.NaN, 0, 0],
      [0, 0, 0],
    ),
    1,
    [0, 0, 0],
    [0, 0, 0],
  ).toBytes();
  assert.equal(
    evaluateEphemeris(windowOf(parseDyn(nanPosition)), 0).status,
    "unavailable",
  );

  assert.deepEqual(
    evaluateEphemeris(
      {
        header: window.header,
        points: window.points,
        interval: { min: 2, max: 0 },
      },
      1,
    ),
    { status: "unavailable", reason: "invalid-samples" },
  );
});

test("rejects parabola, non-positive axis and invalid gravity ratios", () => {
  const parabola = orbPoint(
    orbPoint(
      header({ version: 2, type: "orb", inline: true, gm1: 1, gm2: 1 }).i32(2),
      0,
      1,
      1,
      1,
      0,
    ),
    1,
    1,
    1,
    1,
    1,
  ).toBytes();
  assert.deepEqual(evaluateEphemeris(windowOf(parseDyn(parabola)), 0), {
    status: "unavailable",
    reason: "unsupported-orbit",
  });

  const zeroAxis = orbPoint(
    orbPoint(
      header({ version: 2, type: "orb", inline: true, gm1: 1, gm2: 1 }).i32(2),
      0,
      0,
      0,
      1,
      0,
    ),
    1,
    0,
    0,
    1,
    1,
  ).toBytes();
  assert.deepEqual(evaluateEphemeris(windowOf(parseDyn(zeroAxis)), 0), {
    status: "unavailable",
    reason: "unsupported-orbit",
  });

  const negativeGravity = circularOrb(-1, 1);
  assert.deepEqual(evaluateEphemeris(negativeGravity, 0, { body: 1 }), {
    status: "unavailable",
    reason: "invalid-samples",
  });
});

test("plugin surface validates inputs and evaluates parsed windows", () => {
  assert.equal(NASA_DYNAMO_MANIFEST.id, "spaceeyes.nasa.dynamo");
  assert.equal(NASA_DYNAMO_MANIFEST.version, "0.0.1");
  assert.equal(NASA_DYNAMO_MANIFEST.pointTypes.length, 5);
  assert.equal(NASA_DYNAMO_MANIFEST.permissions.network.viaHostProxy, true);
  assert.equal(NASA_DYNAMO_MANIFEST.limits.maxFileBytes, MAX_DYNAMO_BYTES);

  const plugin = new NasaDynamoPlugin();
  assert.throws(
    () => plugin.loadFile(new Uint8Array(), { path: "a", segment: null }),
    RangeError,
  );
  assert.throws(
    () => plugin.loadFile(Uint8Array.from([0, 0]), { path: "", segment: null }),
    RangeError,
  );

  const bytes = linPoint(
    linPoint(
      header({ version: 2, type: "lin", inline: true }).i32(2),
      0,
      [0, 0, 0],
    ),
    2,
    [4, 0, 0],
  ).toBytes();
  const file = plugin.loadFile(bytes, {
    path: "synthetic/def.dyn",
    segment: null,
  });
  const state = plugin.evaluate(file, 1);
  assert.equal(state.status, "ready");

  const segment = new DynWriter().u8(1).i32(1);
  linPoint(segment, 0, [1, 2, 3]);
  assert.equal(plugin.loadSegment(segment.toBytes(), "lin").length, 1);

  const index = header({ version: 2, type: "pos", inline: false })
    .i32(1)
    .f64(0)
    .toBytes();
  assert.deepEqual(plugin.evaluate(parseDyn(index), 0), {
    status: "unavailable",
    reason: "invalid-samples",
  });
});
