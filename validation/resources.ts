// SPACEEYES resource experiments; original code licensed under MIT.
// These checks are deliberately narrower than full glTF/KTX conformance.
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function integer(value: unknown, label: string, minimum = 0): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum,
    `invalid ${label}`);
  return value;
}

function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected object');
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  requireValue(Array.isArray(value), 'expected array');
  return value;
}

export function sampleUri(value: unknown): string {
  requireValue(typeof value === 'string' && value.length > 0, 'invalid relative URI');
  // This local verification tool accepts literal relative paths only.
  requireValue(!/[%\\:?#\0]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part !== '.' && part !== '..' && part.length > 0),
  'invalid relative URI');
  return value;
}

export function validatePointCloud(data: Buffer) {
  requireValue(data.length >= 4, 'point cloud header length');
  const records = integer(data.readInt32LE(0), 'point count');
  requireValue(data.length === 4 + records * 23, 'point cloud length mismatch');
  for (let i = 0; i < records; i++) {
    const start = 4 + i * 23;
    for (const offset of [0, 4, 11, 15, 19]) {
      requireValue(Number.isFinite(data.readFloatLE(start + offset)), 'point fields must be finite');
    }
  }
  return { records, bytes: data.length, stride: 23, scope: 'layout and finite fields; scientific units unverified' };
}

export function validateDyn(data: Buffer): {
  version: number; type: string; records?: number; segments?: number; scope: string;
} {
  let cursor = 0;
  const take = (bytes: number): number => {
    requireValue(cursor + bytes <= data.length, 'DYN header length');
    const start = cursor;
    cursor += bytes;
    return start;
  };
  const version = data.readInt16LE(take(2));
  requireValue(version === 1 || version === 2, 'unsupported DYN version');
  const end = data.indexOf(0, cursor);
  requireValue(end >= cursor && end - cursor <= 4, 'invalid DYN type');
  const type = data.toString('ascii', cursor, end);
  const strides: Record<string, number> = { orb: 72, pos: 56, lin: 32, ori: 64, quat: 40 };
  requireValue(Object.hasOwn(strides, type), 'unsupported DYN type');
  cursor = end + 1;
  if (version === 2) take(1); // Zero-padding width, not record count.
  if (type === 'orb') {
    for (let i = 0; i < 2; i++) {
      requireValue(Number.isFinite(data.readDoubleLE(take(8))), 'DYN gravity must be finite');
    }
  }
  const flag = data.readUInt8(take(1));
  requireValue(flag === 0 || flag === 1, 'invalid DYN sample flag');
  const count = integer(data.readInt32LE(take(4)), 'DYN count');
  const stride = flag === 1 ? strides[type] : version === 1 ? 16 : 8;
  requireValue(data.length - cursor === count * stride, 'DYN payload length mismatch');
  if (flag === 1) {
    for (let i = cursor; i < data.length; i += 8) {
      requireValue(Number.isFinite(data.readDoubleLE(i)), 'DYN fields must be finite');
    }
    return { version, type, records: count, scope: 'inline record layout and finite values; no interpolation' };
  }
  let previous = -Infinity;
  for (let i = 0; i < count; i++) {
    const start = data.readDoubleLE(cursor + i * stride);
    requireValue(Number.isFinite(start) && start >= previous, 'DYN boundaries must be finite and ordered');
    if (version === 1) {
      const finish = data.readDoubleLE(cursor + i * stride + 8);
      requireValue(Number.isFinite(finish) && finish >= start, 'DYN interval bounds');
    }
    previous = start;
  }
  return { version, type, segments: version === 2 ? Math.max(0, count - 1) : count,
    scope: 'definition index layout; no child fetch or coverage evaluation' };
}

export function validateKtx2(data: Buffer) {
  requireValue(data.subarray(0, 12).equals(Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex')),
    'KTX2 signature mismatch');
  requireValue(data.length >= 80, 'KTX2 header length');
  const width = integer(data.readUInt32LE(20), 'width', 1);
  const height = integer(data.readUInt32LE(24), 'height', 1);
  const levels = integer(data.readUInt32LE(40), 'level count', 1);
  const indexEnd = 80 + levels * 24;
  requireValue(indexEnd <= data.length, 'KTX2 level index bounds');
  const intervals: Array<[bigint, bigint]> = [];
  for (let i = 0; i < levels; i++) {
    const offset = data.readBigUInt64LE(80 + 24 * i);
    const size = data.readBigUInt64LE(88 + 24 * i);
    requireValue(offset >= BigInt(indexEnd), 'KTX2 payload overlaps level index');
    requireValue(size > 0n && offset + size <= BigInt(data.length), 'KTX2 payload bounds');
    requireValue(intervals.every(([a, b]) => offset + size <= a || offset >= b), 'KTX2 levels overlap');
    intervals.push([offset, offset + size]);
  }
  const schemeId = data.readUInt32LE(44);
  const scheme = ['None', 'BasisLZ', 'Zstandard', 'ZLIB'][schemeId] ?? `unrecognized:${schemeId}`;
  return { width, height, levels, scheme, scope: 'header and payload intervals; no texture transcode' };
}

export function gltfUris(input: unknown): string[] {
  const model = object(input);
  return [...new Set(['buffers', 'images'].flatMap(key =>
    (model[key] === undefined ? [] : list(model[key])).flatMap(entry => {
      const uri = object(entry).uri;
      return uri === undefined ? [] : [sampleUri(uri)];
    })))];
}

export function validateGltf(input: unknown, payloads: ReadonlyMap<string, Buffer>) {
  const model = object(input);
  requireValue(object(model.asset).version === '2.0', 'only glTF 2.0 is supported');
  gltfUris(model); // Check all external references even when only geometry is inspected.
  const buffers = list(model.buffers).map(entry => {
    const metadata = object(entry);
    const uri = sampleUri(metadata.uri);
    const data = payloads.get(uri);
    requireValue(data !== undefined, `missing buffer ${uri}`);
    requireValue(data.length === integer(metadata.byteLength, 'buffer length'), 'buffer length mismatch');
    return data;
  });
  const views = list(model.bufferViews).map(entry => {
    const metadata = object(entry);
    const data = buffers[integer(metadata.buffer, 'buffer index')];
    requireValue(data !== undefined, 'buffer index bounds');
    const offset = integer(metadata.byteOffset ?? 0, 'view offset');
    const size = integer(metadata.byteLength, 'view length', 1);
    requireValue(offset + size <= data.length, 'buffer view bounds');
    return { metadata, data, offset, size };
  });
  const accessors = list(model.accessors);
  const positionIds = new Set<number>();
  for (const mesh of list(model.meshes)) {
    for (const primitive of list(object(mesh).primitives)) {
      const id = object(object(primitive).attributes).POSITION;
      requireValue(id !== undefined, 'primitive has no POSITION');
      positionIds.add(integer(id, 'POSITION index'));
    }
  }
  let positions = 0;
  for (const id of positionIds) {
    requireValue(accessors[id] !== undefined, 'accessor index bounds');
    const accessor = object(accessors[id]);
    requireValue(accessor.componentType === 5126 && accessor.type === 'VEC3' && accessor.sparse === undefined,
      'only non-sparse float32 POSITION is supported');
    const view = views[integer(accessor.bufferView, 'view index')];
    requireValue(view !== undefined, 'view index bounds');
    const count = integer(accessor.count, 'position count', 1);
    const stride = integer(view.metadata.byteStride ?? 12, 'position stride', 12);
    const offset = integer(accessor.byteOffset ?? 0, 'position offset');
    requireValue(stride % 4 === 0 && offset % 4 === 0 && view.offset % 4 === 0, 'position alignment');
    requireValue(offset + (count - 1) * stride + 12 <= view.size, 'accessor bounds');
    const lower = [Infinity, Infinity, Infinity], upper = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = view.data.readFloatLE(view.offset + offset + i * stride + axis * 4);
        requireValue(Number.isFinite(value), 'POSITION must be finite');
        lower[axis] = Math.min(lower[axis], value);
        upper[axis] = Math.max(upper[axis], value);
      }
    }
    for (const [name, actual] of [['min', lower], ['max', upper]] as const) {
      const declared = list(accessor[name]);
      requireValue(declared.length === 3 && declared.every((value, axis) =>
        typeof value === 'number' && Number.isFinite(value) && Math.abs(value - actual[axis]) <= 1e-4),
      `POSITION ${name} mismatch`);
    }
    positions += count;
  }
  requireValue(positionIds.size > 0, 'no POSITION accessors');
  return { positions, positionAccessors: positionIds.size, bufferViews: views.length,
    dependencies: gltfUris(model), scope: 'buffer bounds and POSITION; topology, materials and rendering unverified' };
}
