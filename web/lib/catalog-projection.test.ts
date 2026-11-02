import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogProjection } from "./catalog-projection.ts";
test("catalog arrays remain stable within coverage phase and respond to controls", () => {
  const p = new CatalogProjection();
  const rows = [
    {
      id: "sc_themis_b",
      name: "ARTEMIS P1",
      kind: "spacecraft",
      keywords: ["probe"],
    },
    { id: "earth", name: "地球", kind: "planet" },
  ];
  const a = p.project(rows, 264427260, "", "all", "earth");
  for (let i = 0; i < 1000; i++) {
    const b = p.project(rows, 264427260 + i / 1000, "", "all", "earth");
    assert.equal(b.matches, a.matches);
    assert.equal(b.follow, a.follow);
  }
  assert.equal(a.labels.get("sc_themis_b"), "THEMIS B");
  const b = p.project(rows, 264427266, "", "all", "earth");
  assert.equal(b.labels.get("sc_themis_b"), "ARTEMIS P1");
  assert.notEqual(b.matches, a.matches);
  const c = p.project(rows, 264427266, "probe", "spacecraft", "sc_themis_b");
  assert.deepEqual(
    c.matches.map((x) => x.id),
    ["sc_themis_b"],
  );
  assert.deepEqual(
    c.follow.map((x) => x.id),
    ["earth"],
  );
  assert.equal(p.project(rows, 264427266, "", "major", "").matches.length, 1);
});
test("selection preserves search projection and cache retains only latest inputs", () => {
  const p = new CatalogProjection();
  const rows = [
    { id: "earth", name: "Earth", kind: "planet", keywords: ["home"] },
    { id: "moon", name: "Moon", kind: "moon" },
  ];
  const a = p.project(rows, 1, "", "all", "");
  const b = p.project(rows, 2, "", "all", "moon");
  assert.equal(a.matches, b.matches);
  assert.notEqual(a.follow, b.follow);
  p.project(rows, 3, "home", "all", "moon");
  const c = p.project(rows, 4, "", "all", "moon");
  assert.notEqual(a.matches, c.matches);
  assert.equal(b.follow, c.follow);
  assert.deepEqual(c.matches, rows);
  assert.equal(
    p.project(rows, 5, "moon", "moon", "earth").matches[0].id,
    "moon",
  );
});
