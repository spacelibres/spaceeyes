import test from "node:test";
import assert from "node:assert/strict";
import { encodeSehdr } from "./galaxy-hdr.ts";
test("SEHDR preserves black and HDR and exact header", () => {
  const b = encodeSehdr(2, 1, 1, 1, new Float32Array([0, 0, 0, 1, 4, 2, 1, 1]));
  assert.equal(b.subarray(0, 8).toString("ascii"), "SEHDR01\0");
  assert.equal(b.readUInt16LE(8), 2);
  assert.equal(b.readUInt16LE(16), 0);
  assert.equal(b.readUInt16LE(24), 0x4400);
  assert.throws(() => encodeSehdr(2, 1, 1, 1, new Float32Array(1)));
});
