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
  assert.equal(eyesCatalog.filter((x) => x.kind === "spacecraft").length, 171);
  assert.equal(
    new Set(eyesCatalog.flatMap((x) => (x.model ? [x.model.url] : []))).size,
    131,
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
