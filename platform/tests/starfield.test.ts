import test from "node:test";
import assert from "node:assert/strict";
import manifest from "../../validation/eyes-stars.json" with { type: "json" };
import { decodeStarfield } from "../starfield.ts";
test("versioned starfield manifest accounts for all seven exact source layouts", () => {
  assert.equal(manifest.files.length, 7);
  assert.equal(
    manifest.files.reduce((sum, file) => sum + (file.bytes - 4) / 23, 0),
    43878,
  );
  assert.equal(new Set(manifest.files.map((file) => file.file)).size, 7);
  assert.ok(
    manifest.files.every(
      (file) =>
        /^[a-f0-9]{64}$/.test(file.sha256) && (file.bytes - 4) % 23 === 0,
    ),
  );
});
test("reject malformed lengths and source", () => {
  assert.throws(() => decodeStarfield(new Uint8Array(4), "x"));
  assert.throws(() => decodeStarfield(new Uint8Array(4), ""));
});
test("single record preserves magnitudes and applies NASA source rotation", () => {
  const bytes = new Uint8Array(27),
    v = new DataView(bytes.buffer);
  v.setInt32(0, 1, true);
  v.setFloat32(4, 2, true);
  v.setFloat32(8, -3, true);
  bytes.set([255, 128, 0], 12);
  v.setFloat32(15, 1, true);
  v.setFloat32(19, 2, true);
  v.setFloat32(23, 3, true);
  const s = decodeStarfield(bytes, "fixture");
  assert.deepEqual(s.magnitudes, [2]);
  assert.deepEqual(s.absoluteMagnitudes, [-3]);
  assert.deepEqual(s.colorsRgb, [1, 128 / 255, 0]);
  assert.equal(s.positionsKm[0], 3);
  assert.ok(s.positionsKm[1] < -1);
  assert.ok(s.positionsKm[2] > 1);
  for (const offset of [4, 8, 15, 19, 23]) {
    const bad = bytes.slice();
    new DataView(bad.buffer).setFloat32(offset, NaN, true);
    assert.throws(() => decodeStarfield(bad, "fixture"));
  }
  const black = bytes.slice();
  black.fill(0, 12, 15);
  assert.throws(() => decodeStarfield(black, "fixture"));
  const zero = bytes.slice();
  zero.fill(0, 15);
  assert.throws(() => decodeStarfield(zero, "fixture"));
  for (const count of [-1, 0, 50001]) {
    const bad = bytes.slice();
    new DataView(bad.buffer).setInt32(0, count, true);
    assert.throws(() => decodeStarfield(bad, "fixture"));
  }
  assert.throws(() => decodeStarfield(bytes.slice(0, 26), "fixture"));
});
test("source RGB is normalized by its maximum channel", () => {
  const bytes = new Uint8Array(27),
    v = new DataView(bytes.buffer);
  v.setInt32(0, 1, true);
  bytes.set([100, 50, 25], 12);
  v.setFloat32(15, 1, true);
  assert.deepEqual(decodeStarfield(bytes, "fixture").colorsRgb, [1, 0.5, 0.25]);
});
