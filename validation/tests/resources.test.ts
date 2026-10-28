import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePointCloud, validateKtx2, validateGltf, validateDyn } from '../resources.ts';

test('point cloud validates exact layout, including non-finite coordinates', () => {
  const data = Buffer.alloc(27);
  data.writeInt32LE(1);
  assert.equal(validatePointCloud(data).records, 1);
  assert.throws(() => validatePointCloud(data.subarray(0, 26)), /length/);
  data.writeFloatLE(NaN, 15);
  assert.throws(() => validatePointCloud(data), /finite/);
  data.writeInt32LE(-1);
  assert.throws(() => validatePointCloud(data), /count/);
});

function ktx(): Buffer {
  const data = Buffer.alloc(120);
  Buffer.from('ab4b5458203230bb0d0a1a0a', 'hex').copy(data);
  data.writeUInt32LE(1, 16);
  data.writeUInt32LE(20, 20);
  data.writeUInt32LE(20, 24);
  data.writeUInt32LE(1, 36);
  data.writeUInt32LE(1, 40);
  data.writeUInt32LE(1, 44);
  data.writeBigUInt64LE(104n, 80);
  data.writeBigUInt64LE(16n, 88);
  return data;
}

test('KTX2 checks 64-bit payload intervals rather than trusting extension', () => {
  const data = ktx();
  assert.equal(validateKtx2(data).scheme, 'BasisLZ');
  data.writeBigUInt64LE(121n, 80);
  assert.throws(() => validateKtx2(data), /bounds/);
  data.writeBigUInt64LE(0n, 80);
  assert.throws(() => validateKtx2(data), /index/);
  assert.throws(() => validateKtx2(Buffer.alloc(80)), /signature/);
});

function model() {
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 12, uri: 'mesh.bin' }],
    bufferViews: [{ buffer: 0, byteLength: 12 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 1,
      min: [0, 0, 0], max: [0, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  };
}

test('glTF validates referenced geometry and rejects absent or corrupt buffers', () => {
  const data = Buffer.alloc(12);
  assert.equal(validateGltf(model(), new Map([['mesh.bin', data]])).positions, 1);
  assert.throws(() => validateGltf(model(), new Map()), /missing buffer/);
  data.writeFloatLE(Infinity);
  assert.throws(() => validateGltf(model(), new Map([['mesh.bin', data]])), /finite/);
  const invalid = model();
  invalid.accessors[0].count = 2;
  assert.throws(() => validateGltf(invalid, new Map([['mesh.bin', Buffer.alloc(12)]])), /bounds/);
});

test('glTF does not let external references escape the sample directory', () => {
  const invalid = model();
  invalid.buffers[0].uri = '../mesh.bin';
  assert.throws(() => validateGltf(invalid, new Map()), /relative URI/);
  invalid.buffers[0].uri = '%2e%2e/mesh.bin';
  assert.throws(() => validateGltf(invalid, new Map()), /relative URI/);
});

test('DYN v2 terminal boundary closes segments without adding a phantom resource', () => {
  const header = Buffer.from([2, 0, 112, 111, 115, 0, 3, 0]); // pos, 3-digit names, index
  const data = Buffer.concat([header, Buffer.alloc(4 + 3 * 8)]);
  data.writeInt32LE(3, 8);
  data.writeDoubleLE(0, 12);
  data.writeDoubleLE(10, 20);
  data.writeDoubleLE(20, 28);
  assert.equal(validateDyn(data).segments, 2);
  assert.throws(() => validateDyn(data.subarray(0, 35)), /length/);
  data.writeDoubleLE(-1, 20);
  assert.throws(() => validateDyn(data), /ordered/);
});

test('DYN sample records reject truncation, unknown type and nonfinite values', () => {
  const data = Buffer.concat([Buffer.from([2, 0, 108, 105, 110, 0, 0, 1]), Buffer.alloc(36)]);
  data.writeInt32LE(1, 8);
  assert.equal(validateDyn(data).records, 1);
  data.writeDoubleLE(NaN, 12);
  assert.throws(() => validateDyn(data), /finite/);
  data[2] = 120;
  assert.throws(() => validateDyn(data), /type/);
});

test('every truncated prefix of fixed-layout fixtures is rejected', () => {
  const points = Buffer.alloc(27);
  points.writeInt32LE(1);
  const dyn = Buffer.concat([Buffer.from([2, 0, 108, 105, 110, 0, 0, 1]), Buffer.alloc(36)]);
  dyn.writeInt32LE(1, 8);
  for (const [bytes, validate] of [[points, validatePointCloud], [ktx(), validateKtx2],
    [dyn, validateDyn]] as const) {
    for (let length = 0; length < bytes.length; length++) {
      assert.throws(() => validate(bytes.subarray(0, length)), `accepted prefix ${length}/${bytes.length}`);
    }
  }
});

test('malformed glTF shapes fail instead of producing a successful empty result', () => {
  for (const value of [null, [], {}, { asset: { version: '1.0' } }]) {
    assert.throws(() => validateGltf(value, new Map()));
  }
  const empty = model();
  empty.meshes = [];
  assert.throws(() => validateGltf(empty, new Map([['mesh.bin', Buffer.alloc(12)]])), /no POSITION/);
});
