/** NASA Eyes source-layout decoder. No interpolation or standard scientific frame claim. */
export type DynQuaternion = readonly [number, number, number, number]; // w,x,y,z
export type DynVector = readonly [number, number, number];
export type DynInterval = Readonly<{ start: number; end: number }>;
export type DynOrbRecord = Readonly<{
  time: number;
  semiMajorAxis: number;
  eccentricity: number;
  meanAngularMotion: number;
  meanAnomalyAtEpoch: number;
  orientation: DynQuaternion;
}>;
export type DynOriRecord = Readonly<{
  time: number;
  orientation: DynQuaternion;
  angularVelocity: DynVector;
}>;
type Common = Readonly<{
  version: 1 | 2;
  paddingWidth: number;
  coverage: DynInterval;
  gravitationalParameter1?: number;
  gravitationalParameter2?: number;
}>;
export type DecodedDyn = Common &
  (
    | Readonly<{
        kind: "index";
        type: "orb" | "ori" | "pos" | "lin";
        segments: readonly DynInterval[];
      }>
    | Readonly<{
        kind: "inline";
        type: "orb";
        records: readonly DynOrbRecord[];
      }>
    | Readonly<{
        kind: "inline";
        type: "pos" | "lin";
        records: readonly Readonly<{
          time: number;
          position: DynVector;
          velocity: DynVector;
        }>[];
      }>
    | Readonly<{
        kind: "inline";
        type: "ori";
        records: readonly DynOriRecord[];
      }>
  );
export type DynDecodeBudget = Readonly<{
  maxBytes?: number;
  maxRecords?: number;
}>;
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`DYN ${reason}`);
}
export function decodeDyn(
  bytes: Uint8Array,
  budget: DynDecodeBudget = {},
): DecodedDyn {
  const maxBytes = budget.maxBytes ?? 16 * 1024 * 1024;
  const maxRecords = budget.maxRecords ?? 100_000;
  check(
    Number.isSafeInteger(maxBytes) &&
      maxBytes > 0 &&
      Number.isSafeInteger(maxRecords) &&
      maxRecords > 0,
    "invalid budget",
  );
  check(bytes.byteLength <= maxBytes, "byte budget exceeded");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 0;
  const take = (size: number) => {
    check(cursor + size <= bytes.byteLength, "truncated data");
    const at = cursor;
    cursor += size;
    return at;
  };
  const u8 = () => view.getUint8(take(1));
  const f64 = () => {
    const value = view.getFloat64(take(8), true);
    check(Number.isFinite(value), "nonfinite field");
    return value;
  };
  const version = view.getInt16(take(2), true);
  check(version === 1 || version === 2, "unsupported version");
  let typeText = "";
  let terminated = false;
  for (let i = 0; i < 5; i++) {
    const code = u8();
    if (code === 0) {
      terminated = true;
      break;
    }
    typeText += String.fromCharCode(code);
  }
  check(
    terminated &&
      (typeText === "orb" ||
        typeText === "ori" ||
        typeText === "pos" ||
        typeText === "lin"),
    "unsupported type",
  );
  const type = typeText;
  let paddingWidth = version === 2 ? u8() : 0;
  const gravitationalParameter1 = type === "orb" ? f64() : undefined;
  const gravitationalParameter2 = type === "orb" ? f64() : undefined;
  const flag = u8();
  check(flag === 0 || flag === 1, "invalid flag");
  const count = view.getInt32(take(4), true);
  check(count >= 0, "invalid count");
  check(count <= maxRecords, "record budget exceeded");
  const stride =
    flag === 1
      ? type === "orb"
        ? 72
        : type === "pos"
          ? 56
          : type === "lin"
            ? 32
            : 64
      : version === 1
        ? 16
        : 8;
  check(
    bytes.byteLength - cursor === count * stride,
    "payload length mismatch",
  );
  const interval = (start: number, end: number): DynInterval =>
    Object.freeze({ start, end });
  const header = {
    version,
    gravitationalParameter1,
    gravitationalParameter2,
  } as const;
  if (flag === 0) {
    check(count >= (version === 2 ? 2 : 1), "empty index");
    const segments: DynInterval[] = [];
    let previousEnd = -Infinity;
    if (version === 1) {
      paddingWidth = Math.ceil(Math.log10(count));
      for (let i = 0; i < count; i++) {
        const start = f64(),
          end = f64();
        check(end > start && start >= previousEnd, "invalid index boundaries");
        segments.push(interval(start, end));
        previousEnd = end;
      }
    } else {
      let start = f64();
      for (let i = 1; i < count; i++) {
        const end = f64();
        check(end > start, "invalid index boundaries");
        segments.push(interval(start, end));
        start = end;
      }
    }
    return Object.freeze({
      ...header,
      paddingWidth,
      type,
      kind: "index",
      coverage: interval(segments[0].start, segments.at(-1)!.end),
      segments: Object.freeze(segments),
    });
  }
  check(count >= 2, "inline records require two samples");
  const quaternion = (): DynQuaternion =>
    Object.freeze([f64(), f64(), f64(), f64()] as const);
  const vector = (): DynVector => Object.freeze([f64(), f64(), f64()] as const);
  let previousTime = -Infinity;
  const time = () => {
    const value = f64();
    check(value > previousTime, "sample times must increase");
    previousTime = value;
    return value;
  };
  if (type === "pos" || type === "lin") {
    const records = [];
    for (let i = 0; i < count; i++)
      records.push(
        Object.freeze({
          time: time(),
          position: vector(),
          velocity:
            type === "pos" ? vector() : Object.freeze([0, 0, 0] as const),
        }),
      );
    return Object.freeze({
      ...header,
      paddingWidth,
      kind: "inline",
      type,
      coverage: interval(records[0].time, records.at(-1)!.time),
      records: Object.freeze(records),
    });
  }
  if (type === "orb") {
    const records: DynOrbRecord[] = [];
    for (let i = 0; i < count; i++)
      records.push(
        Object.freeze({
          time: time(),
          semiMajorAxis: f64(),
          eccentricity: f64(),
          meanAngularMotion: f64(),
          meanAnomalyAtEpoch: f64(),
          orientation: quaternion(),
        }),
      );
    return Object.freeze({
      ...header,
      paddingWidth,
      kind: "inline",
      type,
      coverage: interval(records[0].time, records.at(-1)!.time),
      records: Object.freeze(records),
    });
  }
  const records: DynOriRecord[] = [];
  for (let i = 0; i < count; i++)
    records.push(
      Object.freeze({
        time: time(),
        orientation: quaternion(),
        angularVelocity: vector(),
      }),
    );
  return Object.freeze({
    ...header,
    paddingWidth,
    kind: "inline",
    type,
    coverage: interval(records[0].time, records.at(-1)!.time),
    records: Object.freeze(records),
  });
}
