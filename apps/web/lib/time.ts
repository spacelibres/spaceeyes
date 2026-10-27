// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Exact display/input adaptation only; the Rust clock remains authoritative.
const billion = 1000000000n;
const minSeconds = -(1n << 63n);
const maxSeconds = (1n << 63n) - 1n;

export function parseSimulationSeconds(text: string): {
  seconds: bigint;
  nanos: number;
} {
  if (text.length > 64 || !/^-?\d+(?:\.\d{1,9})?$/.test(text.trim())) {
    throw new RangeError("请输入十进制秒，小数最多9位，不支持科学计数法。");
  }
  const input = text.trim();
  const negative = input.startsWith("-");
  const [whole, fraction = ""] = (negative ? input.slice(1) : input).split(".");
  const magnitude = BigInt(whole) * billion + BigInt(fraction.padEnd(9, "0"));
  const total = negative ? -magnitude : magnitude;
  let seconds = total / billion;
  let nanos = total % billion;
  if (nanos < 0n) {
    seconds--;
    nanos += billion;
  }
  if (seconds < minSeconds || seconds > maxSeconds)
    throw new RangeError("目标时间超出核心支持的64位秒范围。");
  return { seconds, nanos: Number(nanos) };
}

export function formatSimulationTime(seconds: bigint, nanos: number): string {
  if (!Number.isInteger(nanos) || nanos < 0 || nanos >= 1000000000)
    throw new RangeError("无效纳秒。");
  const total = seconds * billion + BigInt(nanos);
  const magnitude = total < 0n ? -total : total;
  return `${total < 0n ? "-" : ""}${magnitude / billion}.${(magnitude % billion).toString().padStart(9, "0")}`;
}
