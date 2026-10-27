// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

/** Little-endian test writer; synthetic fixtures only, never NASA assets. */
export class DynWriter {
  private readonly bytes: number[] = [];

  i16(value: number): this {
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setInt16(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
    return this;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  i32(value: number): this {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
    return this;
  }

  f64(value: number): this {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    this.bytes.push(...new Uint8Array(buffer));
    return this;
  }

  ascii(value: string): this {
    for (const character of value) {
      if (character.charCodeAt(0) > 0x7f)
        throw new RangeError("non-ASCII fixture");
      this.bytes.push(character.charCodeAt(0));
    }
    return this;
  }

  nul(): this {
    return this.u8(0);
  }

  name(value: string): this {
    return this.ascii(value).nul();
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

export interface HeaderOptions {
  readonly version: 1 | 2;
  readonly type: "orb" | "pos" | "lin" | "ori" | "quat";
  readonly digits?: number;
  readonly gm1?: number;
  readonly gm2?: number;
  readonly inline: boolean;
}

export function header(options: HeaderOptions): DynWriter {
  const writer = new DynWriter().i16(options.version).name(options.type);
  if (options.version === 2) writer.u8(options.digits ?? 0);
  if (options.type === "orb")
    writer.f64(options.gm1 ?? 1).f64(options.gm2 ?? 1);
  writer.u8(options.inline ? 1 : 0);
  return writer;
}

export function orbPoint(
  writer: DynWriter,
  time: number,
  semiMajorAxis: number,
  eccentricity: number,
  meanAngularMotion: number,
  meanAnomalyAtEpoch: number,
  quaternion: { w: number; x: number; y: number; z: number } = {
    w: 1,
    x: 0,
    y: 0,
    z: 0,
  },
): DynWriter {
  return writer
    .f64(time)
    .f64(semiMajorAxis)
    .f64(eccentricity)
    .f64(meanAngularMotion)
    .f64(meanAnomalyAtEpoch)
    .f64(quaternion.w)
    .f64(quaternion.x)
    .f64(quaternion.y)
    .f64(quaternion.z);
}

export function posPoint(
  writer: DynWriter,
  time: number,
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
): DynWriter {
  return writer
    .f64(time)
    .f64(position[0])
    .f64(position[1])
    .f64(position[2])
    .f64(velocity[0])
    .f64(velocity[1])
    .f64(velocity[2]);
}

export function linPoint(
  writer: DynWriter,
  time: number,
  position: readonly [number, number, number],
): DynWriter {
  return writer.f64(time).f64(position[0]).f64(position[1]).f64(position[2]);
}

export function oriPoint(
  writer: DynWriter,
  time: number,
  quaternion: { w: number; x: number; y: number; z: number },
  angularVelocity: readonly [number, number, number],
): DynWriter {
  return writer
    .f64(time)
    .f64(quaternion.w)
    .f64(quaternion.x)
    .f64(quaternion.y)
    .f64(quaternion.z)
    .f64(angularVelocity[0])
    .f64(angularVelocity[1])
    .f64(angularVelocity[2]);
}

export function quatPoint(
  writer: DynWriter,
  time: number,
  quaternion: { w: number; x: number; y: number; z: number },
): DynWriter {
  return writer
    .f64(time)
    .f64(quaternion.w)
    .f64(quaternion.x)
    .f64(quaternion.y)
    .f64(quaternion.z);
}
