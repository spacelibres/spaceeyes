// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//
// Behavior derived from the fixed reference commit documented in NOTICE.md.
// Implementation is maintained here and must not be described as a byte-for-byte
// copy of the reference repository.

/** Little-endian reader for NASA Eyes `.dyn` bytes. */
export class DynReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    if (data instanceof Uint8Array) {
      this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    } else {
      this.view = new DataView(data);
    }
  }

  get position(): number {
    return this.offset;
  }

  get byteLength(): number {
    return this.view.byteLength;
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  private take(bytes: number): number {
    const at = this.offset;
    if (at + bytes > this.view.byteLength) {
      throw new RangeError(
        `dynamo reader: need ${bytes} byte(s) at offset ${at}, ` +
          `only ${this.remaining} available`,
      );
    }
    this.offset += bytes;
    return at;
  }

  readUint8(): number {
    return this.view.getUint8(this.take(1));
  }

  readInt16(): number {
    return this.view.getInt16(this.take(2), true);
  }

  readInt32(): number {
    return this.view.getInt32(this.take(4), true);
  }

  readFloat64(): number {
    return this.view.getFloat64(this.take(8), true);
  }

  /**
   * NUL-terminated point-type name. Bounded so a corrupt file cannot scan an
   * unbounded buffer, and restricted to ASCII so the result is unambiguous.
   */
  readName(maxBytes = 16): string {
    const bytes: number[] = [];
    for (;;) {
      if (bytes.length >= maxBytes) {
        throw new RangeError(
          `dynamo reader: point name exceeds ${maxBytes} bytes`,
        );
      }
      const byte = this.readUint8();
      if (byte === 0) break;
      if (byte > 0x7f) {
        throw new RangeError(
          `dynamo reader: point name is not ASCII at offset ${this.offset - 1}`,
        );
      }
      bytes.push(byte);
    }
    return String.fromCharCode(...bytes);
  }
}
