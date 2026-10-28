// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
// One-off oracle emitter for the Rust DYN evaluator tests. It is not part of the
// runtime or the regular test suite; regenerate only when the TS reference is
// intentionally changed:
//   npm run build --workspace @spaceeyes/nasa-dynamo
//   node packages/nasa-dynamo/scripts/emit-golden.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateEphemeris, parseDyn } from "../dist/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(
  here,
  "../../../crates/dynamo/tests/golden/synthetic.tsv",
);

class Writer {
  bytes = [];
  i16(value) {
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setInt16(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
    return this;
  }
  u8(value) {
    this.bytes.push(value & 0xff);
    return this;
  }
  i32(value) {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
    return this;
  }
  f64(value) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
    return this;
  }
  ascii(value) {
    for (const character of value) this.bytes.push(character.charCodeAt(0));
    return this;
  }
  name(value) {
    return this.ascii(value).u8(0);
  }
  toBytes() {
    return Uint8Array.from(this.bytes);
  }
}

function header(version, type, inline, digits = 0, gm = null) {
  const writer = new Writer().i16(version).name(type);
  if (version === 2) writer.u8(digits);
  if (gm) writer.f64(gm[0]).f64(gm[1]);
  return writer.u8(inline ? 1 : 0);
}

function orbPoint(writer, time, axis, eccentricity, motion, anomaly) {
  return writer
    .f64(time)
    .f64(axis)
    .f64(eccentricity)
    .f64(motion)
    .f64(anomaly)
    .f64(1)
    .f64(0)
    .f64(0)
    .f64(0);
}

function posPoint(writer, time, position, velocity) {
  writer.f64(time);
  for (const value of position) writer.f64(value);
  for (const value of velocity) writer.f64(value);
  return writer;
}

function linPoint(writer, time, position) {
  writer.f64(time);
  for (const value of position) writer.f64(value);
  return writer;
}

function quatPoint(writer, time, quat) {
  return writer.f64(time).f64(quat.w).f64(quat.x).f64(quat.y).f64(quat.z);
}

function oriPoint(writer, time, quat, angular) {
  quatPoint(writer, time, quat);
  for (const value of angular) writer.f64(value);
  return writer;
}

function windowOf(bytes) {
  const file = parseDyn(bytes);
  if (!file.interval) throw new Error("inline fixture without interval");
  return {
    header: file.header,
    points: file.points,
    interval: file.interval,
  };
}

const rows = [];
function add(name, bytes, time, body = 0) {
  const state = evaluateEphemeris(
    windowOf(bytes),
    time,
    body === 0 ? {} : { body },
  );
  const fields = [name, Buffer.from(bytes).toString("hex"), String(time), String(body)];
  if (state.status === "unavailable") {
    fields.push("unavailable", state.reason, "", "");
  } else if (state.kind === "position") {
    fields.push(
      "ready",
      "",
      "position",
      [
        state.position.x,
        state.position.y,
        state.position.z,
        state.velocity.x,
        state.velocity.y,
        state.velocity.z,
      ]
        .map(String)
        .join(","),
    );
  } else {
    fields.push(
      "ready",
      "",
      "orientation",
      [
        state.orientation.w,
        state.orientation.x,
        state.orientation.y,
        state.orientation.z,
        state.angularVelocity.x,
        state.angularVelocity.y,
        state.angularVelocity.z,
      ]
        .map(String)
        .join(","),
    );
  }
  rows.push(fields.join("|"));
}

const circularOrb = (gm1, gm2) => {
  const writer = header(2, "orb", true, 0, [gm1, gm2]).i32(2);
  orbPoint(writer, 0, 1, 0, 1, 0);
  orbPoint(writer, 2 * Math.PI, 1, 0, 1, 0);
  return writer.toBytes();
};

for (const time of [0, Math.PI / 2, 1]) {
  add(`circular-orb-${time}`, circularOrb(1, 1), time);
}
for (const [body, name] of [
  [1, "primary"],
  [2, "secondary"],
]) {
  add(`barycentric-${name}`, circularOrb(1, 3), 0, body);
}

const hermite = header(2, "pos", true).i32(2);
posPoint(hermite, 0, [0, 0, 0], [1, 0, 0]);
posPoint(hermite, 10, [10, 0, 0], [1, 0, 0]);
for (const time of [0, 5, 10]) add(`pos-${time}`, hermite.toBytes(), time);

const linear = header(2, "lin", true).i32(2);
linPoint(linear, 0, [0, 0, 0]);
linPoint(linear, 2, [4, 2, 0]);
add("lin-1", linear.toBytes(), 1);

for (const sign of [1, -1]) {
  const quat = header(2, "quat", true).i32(2);
  quatPoint(quat, 0, { w: 1, x: 0, y: 0, z: 0 });
  quatPoint(quat, 2, {
    w: sign * Math.SQRT1_2,
    x: 0,
    y: 0,
    z: sign * Math.SQRT1_2,
  });
  add(`quat-${sign}`, quat.toBytes(), 1);
}

const ori = header(2, "ori", true).i32(2);
oriPoint(ori, 0, { w: 1, x: 0, y: 0, z: 0 }, [0, 0, Math.PI / 2]);
oriPoint(ori, 2, { w: 1, x: 0, y: 0, z: 0 }, [0, 0, Math.PI / 2]);
for (const time of [0, 1, 2]) add(`ori-projected-${time}`, ori.toBytes(), time);

const oriSlerp = header(2, "ori", true).i32(2);
oriPoint(oriSlerp, 0, { w: 1, x: 0, y: 0, z: 0 }, [0, 0, 0]);
oriPoint(
  oriSlerp,
  2,
  { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 },
  [0, 0, 0],
);
add("ori-slerp-1", oriSlerp.toBytes(), 1);

const hyperbolic = header(2, "orb", true, 0, [1, 1]).i32(2);
orbPoint(hyperbolic, 0, 1, 2, 1, 0);
orbPoint(hyperbolic, 2, 1, 2, 1, 0);
add("hyperbolic-0", hyperbolic.toBytes(), 0);

add("out-of-range-low", circularOrb(1, 1), -1);
add("out-of-range-high", circularOrb(1, 1), 2 * Math.PI + 1);

const duplicate = header(2, "lin", true).i32(2);
linPoint(duplicate, 0, [0, 0, 0]);
linPoint(duplicate, 0, [1, 0, 0]);
add("duplicate", duplicate.toBytes(), 0);

const parabola = header(2, "orb", true, 0, [1, 1]).i32(2);
orbPoint(parabola, 0, 1, 1, 1, 0);
orbPoint(parabola, 1, 1, 1, 1, 1);
add("parabola", parabola.toBytes(), 0);

const zeroAxis = header(2, "orb", true, 0, [1, 1]).i32(2);
orbPoint(zeroAxis, 0, 0, 0, 1, 0);
orbPoint(zeroAxis, 1, 0, 0, 1, 1);
add("zero-axis", zeroAxis.toBytes(), 0);

add("negative-gravity", circularOrb(-1, 1), 0, 1);

const nanPosition = header(2, "pos", true).i32(2);
posPoint(nanPosition, 0, [Number.NaN, 0, 0], [0, 0, 0]);
posPoint(nanPosition, 1, [0, 0, 0], [0, 0, 0]);
add("nan-position", nanPosition.toBytes(), 0);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  [
    "# Synthetic DYN oracle from packages/nasa-dynamo; regenerate with scripts/emit-golden.mjs.",
    "# name|bytes-hex|time|body|status|reason|kind|values",
    ...rows,
    "",
  ].join("\n"),
);
console.log(`Wrote ${rows.length} cases to ${output}`);
