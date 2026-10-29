import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeDyn } from '../dyn-decoder.ts';
function fixture(version = 2, type = 'ori', inline = true, values = [0, 1, 0, 0, 0, 0, 0, 1, 10, 1, 0, 0, 0, 0, 0, 1]) {
  const bytes = new Uint8Array(2 + type.length + 1 + (version === 2 ? 1 : 0) + (type === 'orb' ? 16 : 0) + 5 + values.length * 8);
  const view = new DataView(bytes.buffer); let p = 0;
  view.setInt16(p, version, true); p += 2;
  for (const c of type) bytes[p++] = c.charCodeAt(0); bytes[p++] = 0;
  if (version === 2) bytes[p++] = 3;
  if (type === 'orb') { view.setFloat64(p, 1, true); view.setFloat64(p + 8, 2, true); p += 16; }
  bytes[p++] = inline ? 1 : 0;
  view.setInt32(p, inline ? values.length / (type === 'orb' ? 9 : 8) : values.length / (version === 1 ? 2 : 1), true); p += 4;
  for (const value of values) { view.setFloat64(p, value, true); p += 8; }
  return bytes;
}
test('ori fields preserve wxyz and immutable owned values', () => {
  const input = fixture(); const result = decodeDyn(input); input.fill(0);
  assert.equal(result.type, 'ori'); assert.deepEqual(result.coverage, { start: 0, end: 10 });
  if (result.kind !== 'inline' || result.type !== 'ori') throw Error('type');
  assert.deepEqual(result.records[0].orientation, [1, 0, 0, 0]);
  assert.throws(() => { (result.records[0].orientation as unknown as number[])[0] = 9; });
  assert.ok(Object.isFrozen(result.records[0]));
});
test('v1 inline and offset Uint8Array views decode', () => {
  const data = fixture(1); const padded = new Uint8Array(data.length + 9); padded.set(data, 4);
  assert.equal(decodeDyn(padded.subarray(4, 4 + data.length)).version, 1);
});
test('v2 boundaries close segments without sentinel child', () => {
  const result = decodeDyn(fixture(2, 'ori', false, [0, 5, 10]));
  assert.equal(result.paddingWidth, 3); assert.equal(result.kind, 'index');
  if (result.kind === 'index') assert.deepEqual(result.segments, [{ start: 0, end: 5 }, { start: 5, end: 10 }]);
});
test('v1 explicit intervals preserve gaps and inferred padding', () => {
  const result = decodeDyn(fixture(1, 'ori', false, [0, 3, 5, 10]));
  assert.equal(result.paddingWidth, 1); if (result.kind === 'index') assert.equal(result.segments[1].start, 5);
});
test('all truncated prefixes and trailing bytes rejected', () => {
  const bytes = fixture(); for (let n = 0; n < bytes.length; n++) assert.throws(() => decodeDyn(bytes.subarray(0, n)));
  const extra = new Uint8Array(bytes.length + 1); extra.set(bytes); assert.throws(() => decodeDyn(extra));
});
test('unknown versions types flags and invalid counts rejected', () => {
  assert.throws(() => decodeDyn(fixture(3)), /version/); assert.throws(() => decodeDyn(fixture(2, 'pos')), /unsupported/);
  const bytes = fixture(); bytes[7] = 2; assert.throws(() => decodeDyn(bytes), /flag/);
  const bad = fixture(); new DataView(bad.buffer).setInt32(8, -1, true); assert.throws(() => decodeDyn(bad), /count/);
});
test('nonfinite records, duplicate times and bad interval boundaries rejected', () => {
  assert.throws(() => decodeDyn(fixture(2, 'ori', false, [0, NaN])));
  assert.throws(() => decodeDyn(fixture(2, 'ori', false, [5, 0])));
  assert.throws(() => decodeDyn(fixture(1, 'ori', false, [0, 8, 5, 10])));
  assert.throws(() => decodeDyn(fixture(2, 'ori', true, [0, NaN, 0, 0, 0, 0, 0, 0])));
  assert.throws(() => decodeDyn(fixture(2, 'ori', true, [0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])));
});
test('budgets reject before record allocation', () => {
  assert.throws(() => decodeDyn(fixture(), { maxBytes: 10 }), /budget/);
  assert.throws(() => decodeDyn(fixture(), { maxRecords: 1 }), /budget/);
  assert.throws(() => decodeDyn(fixture(), { maxRecords: Infinity }), /budget/);
});
