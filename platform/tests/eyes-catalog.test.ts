import test from "node:test";
import assert from "node:assert/strict";
import {
  eyesCatalog,
  getEyesDefinition,
  parentAt,
  declaredTracks,
} from "../eyes-catalog.ts";
test("complete source catalog and temporal parents", () => {
  assert.equal(eyesCatalog.filter((x) => x.kind === "moon").length, 451);
  assert.equal(eyesCatalog.filter((x) => x.kind === "spacecraft").length, 173);
  assert.equal(
    new Set(eyesCatalog.flatMap((x) => (x.model ? [x.model.url] : []))).size,
    133,
  );
  assert.equal(getEyesDefinition("sc_isas"), undefined);
  assert.equal(parentAt("sc_juno", 519652869), "jupiter");
  assert.deepEqual(declaredTracks("sc_iss", "orb"), ["sc_iss"]);
});
test("catalog preserves descriptive names and original search keywords", () => {
  assert.equal(
    eyesCatalog.find((x) => x.id === "sc_iss")?.name,
    "International Space Station",
  );
  assert.equal(eyesCatalog.find((x) => x.id === "europa")?.name, "Europa");
  assert.ok(
    eyesCatalog
      .find((x) => x.id === "sc_iss")
      ?.keywords.includes("international space"),
  );
});

test("reviewed NOAA definitions expand discovery without invented entity data", () => {
  for (const id of ["sc_noaa_20", "sc_noaa_21"]) {
    const target = eyesCatalog.find((t) => t.id === id)!;
    const definition = getEyesDefinition(id)!;
    assert.ok(target);
    assert.equal(target.name, definition.label);
    assert.equal(target.parentId, "earth");
    assert.deepEqual(target.model, definition.model);
    assert.equal(target.orbPath, id);
    assert.equal(target.unsupported, false);
    assert.match(target.discoverySource, /App-expanded/);
    assert.equal(eyesCatalog.filter((t) => t.id === id).length, 1);
  }
});
