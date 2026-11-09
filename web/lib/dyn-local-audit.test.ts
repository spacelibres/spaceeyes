import { test } from "node:test";
import assert from "node:assert/strict";
import { auditDynTrack } from "./dyn-local-audit.ts";

function rootIndex(): Uint8Array {
  const b = new Uint8Array(2 + 4 + 1 + 1 + 4 + 3 * 8), v = new DataView(b.buffer);
  v.setInt16(0, 2, true); b.set([111, 114, 105, 0], 2); b[6] = 1; b[7] = 0;
  v.setInt32(8, 3, true); [0, 10, 20].forEach((x, i) => v.setFloat64(12 + i * 8, x, true)); return b;
}
function child(): Uint8Array {
  const b = new Uint8Array(1 + 4 + 2 * 64), v = new DataView(b.buffer);
  b[0] = 1; v.setInt32(1, 2, true); v.setFloat64(5, 0, true); v.setFloat64(69, 10, true); return b;
}

test("audit follows the actual index and reports missing segments without inventing data", async () => {
  const source = new Map([["def.dyn", rootIndex()], ["0.dyn", child()]]);
  const result = await auditDynTrack("earth/ori", async name => source.get(name), new AbortController().signal);
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.missing, ["1.dyn"]);
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.coverage, { start: 0, end: 20 });
  assert.ok(result.files.every(x => /^[a-f0-9]{64}$/.test(x.sha256)));
});

test("invalid data is reported for review and cancellation stops the audit", async () => {
  const result = await auditDynTrack("earth/ori", async () => new Uint8Array([1]), new AbortController().signal);
  assert.equal(result.status, "review");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(auditDynTrack("earth/ori", async () => undefined, controller.signal), { name: "AbortError" });
});

test("only successfully decoded files are published by the repair callback", async () => {
  const source = new Map([["def.dyn", rootIndex()], ["0.dyn", child()], ["1.dyn", new Uint8Array([1])]]);
  const published: string[] = [];
  const result = await auditDynTrack("earth/ori", async name => source.get(name), new AbortController().signal, async name => { published.push(name); });
  assert.equal(result.status, "review");
  assert.deepEqual(published.sort(), ["0.dyn", "def.dyn"]);
  assert.ok(result.errors.some(x => x.name === "1.dyn"));
});
