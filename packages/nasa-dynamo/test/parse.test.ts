// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import assert from "node:assert/strict";
import test from "node:test";

import {
  DynParseError,
  POINT_STRIDE,
  parseDyn,
  parseDynSegment,
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

test("parses an inline version 2 orb file with w-first quaternions", () => {
  const bytes = orbPoint(
    orbPoint(
      header({
        version: 2,
        type: "orb",
        digits: 3,
        gm1: 398600,
        gm2: 1.327e11,
        inline: true,
      }).i32(2),
      0,
      1,
      0,
      1,
      0,
      { w: 1, x: 0, y: 0, z: 0 },
    ),
    2 * Math.PI,
    1,
    0,
    1,
    0,
    { w: 1, x: 0, y: 0, z: 0 },
  ).toBytes();

  const file = parseDyn(bytes);
  assert.equal(file.header.version, 2);
  assert.equal(file.header.pointType, "orb");
  assert.equal(file.header.numberOfDigits, 3);
  assert.equal(file.header.gravitationalParameter1, 398600);
  assert.equal(file.header.gravitationalParameter2, 1.327e11);
  assert.equal(file.points.length, 2);
  assert.deepEqual(file.interval, { min: 0, max: 2 * Math.PI });
  assert.equal(file.segments.length, 0);

  const point = file.points[0];
  assert.ok(point !== undefined);
  assert.equal(point.kind, "orb");
  if (point.kind === "orb") {
    assert.equal(point.semiMajorAxis, 1);
    assert.deepEqual(point.orientation, { x: 0, y: 0, z: 0, w: 1 });
  }
});

test("parses version 2 index files and infers segment ends", () => {
  const bytes = header({ version: 2, type: "pos", inline: false })
    .i32(3)
    .f64(-50)
    .f64(0)
    .f64(100)
    .toBytes();
  const file = parseDyn(bytes);
  assert.deepEqual(file.points, []);
  assert.equal(file.interval, null);
  assert.deepEqual(
    file.segments.map((segment) => [segment.startTime, segment.endTime]),
    [
      [-50, 0],
      [0, 100],
      [100, Number.POSITIVE_INFINITY],
    ],
  );
});

test("parses version 1 index files with explicit ends", () => {
  const bytes = header({ version: 1, type: "lin", inline: false })
    .i32(2)
    .f64(-50)
    .f64(0)
    .f64(0)
    .f64(100)
    .toBytes();
  const file = parseDyn(bytes);
  assert.deepEqual(
    file.segments.map((segment) => [segment.startTime, segment.endTime]),
    [
      [-50, 0],
      [0, 100],
    ],
  );
});

test("parses continuation segments without a file header", () => {
  const bytes = new DynWriter().u8(1).i32(2).toBytes().slice(0, 5);
  const withPoints = new DynWriter().u8(1).i32(2);
  linPoint(linPoint(withPoints, 0, [0, 0, 0]), 2, [4, 2, 0]);
  const points = parseDynSegment(withPoints.toBytes(), "lin");
  assert.equal(points.length, 2);
  assert.deepEqual(points[1]?.kind, "lin");
  assert.throws(() => parseDynSegment(bytes, "lin"), /segment size mismatch/);
});

test("parses every point type with the documented stride", () => {
  const cases = [
    ["orb", 72],
    ["pos", 56],
    ["lin", 32],
    ["ori", 64],
    ["quat", 40],
  ] as const;
  for (const [type, stride] of cases) {
    assert.equal(POINT_STRIDE[type], stride);
  }
  const quat = { w: 1, x: 0, y: 0, z: 0 };
  const files = [
    header({ version: 2, type: "pos", inline: true }).i32(1),
    header({ version: 2, type: "lin", inline: true }).i32(1),
    header({ version: 2, type: "ori", inline: true }).i32(1),
    header({ version: 2, type: "quat", inline: true }).i32(1),
  ];
  posPoint(files[0]!, 0, [1, 2, 3], [4, 5, 6]);
  linPoint(files[1]!, 0, [1, 2, 3]);
  oriPoint(files[2]!, 0, quat, [0, 0, 1]);
  quatPoint(files[3]!, 0, quat);
  for (const writer of files) {
    const file = parseDyn(writer.toBytes());
    assert.equal(file.points.length, 1);
  }
});

test("rejects malformed headers, counts and trailing bytes", () => {
  assert.throws(
    () => parseDyn(new DynWriter().i16(3).name("pos").u8(0).toBytes()),
    DynParseError,
  );
  assert.throws(
    () => parseDyn(new DynWriter().i16(2).name("xyz").u8(0).toBytes()),
    DynParseError,
  );
  assert.throws(
    () => parseDyn(new DynWriter().i16(2).ascii("pos").toBytes()),
    RangeError,
  );
  assert.throws(
    () =>
      parseDyn(new DynWriter().i16(2).name("pos").u8(0).u8(2).i32(0).toBytes()),
    DynParseError,
  );
  assert.throws(
    () =>
      parseDyn(
        header({ version: 2, type: "lin", inline: true }).i32(-1).toBytes(),
      ),
    DynParseError,
  );
  assert.throws(
    () =>
      parseDyn(
        header({ version: 2, type: "lin", inline: true })
          .i32(2)
          .f64(0)
          .f64(0)
          .f64(0)
          .f64(0)
          .toBytes(),
      ),
    DynParseError,
  );
  assert.throws(
    () =>
      parseDyn(
        linPoint(
          linPoint(
            header({ version: 2, type: "lin", inline: true }).i32(1),
            0,
            [0, 0, 0],
          ),
          0,
          [1, 0, 0],
        ).toBytes(),
      ),
    DynParseError,
  );
  assert.throws(
    () =>
      parseDyn(
        header({ version: 2, type: "lin", inline: false })
          .i32(1)
          .f64(0)
          .f64(10)
          .toBytes(),
      ),
    DynParseError,
  );
});
