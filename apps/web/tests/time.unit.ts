// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import assert from "node:assert/strict";
import test from "node:test";
import { formatSimulationTime, parseSimulationSeconds } from "../lib/time.js";

test("negative fractional seconds use floor seconds and positive nanos without precision loss", () => {
  assert.deepEqual(parseSimulationSeconds("-0.5"), {
    seconds: -1n,
    nanos: 500000000,
  });
  assert.deepEqual(parseSimulationSeconds("-1.000000001"), {
    seconds: -2n,
    nanos: 999999999,
  });
  assert.equal(formatSimulationTime(-1n, 500000000), "-0.500000000");
  assert.equal(formatSimulationTime(-2n, 999999999), "-1.000000001");
  assert.equal(formatSimulationTime(0n, 1), "0.000000001");
  assert.equal(formatSimulationTime(0n, 0), "0.000000000");
});
test("signed int64 boundaries and values beyond JS integer precision remain exact", () => {
  for (const text of [
    "9223372036854775807.999999999",
    "-9223372036854775808.000000000",
    "9007199254740993.123456789",
  ]) {
    const instant = parseSimulationSeconds(text);
    assert.equal(formatSimulationTime(instant.seconds, instant.nanos), text);
  }
  assert.deepEqual(parseSimulationSeconds(" -0.000000000 "), {
    seconds: 0n,
    nanos: 0,
  });
});
test("malformed or out-of-range inputs fail before transport", () => {
  for (const text of [
    "",
    " ",
    "1e3",
    "NaN",
    "Infinity",
    "1.1234567890",
    ".5",
    "1.",
    "--1",
    "1,5",
    "1 2",
    "+1",
    "9223372036854775808",
    "-9223372036854775808.000000001",
    "0".repeat(65),
  ]) {
    assert.throws(() => parseSimulationSeconds(text), RangeError, text);
  }
  assert.throws(() => formatSimulationTime(0n, -1), RangeError);
  assert.throws(() => formatSimulationTime(0n, 1e9), RangeError);
});
