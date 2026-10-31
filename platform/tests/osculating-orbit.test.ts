import { test } from "node:test";
import assert from "node:assert/strict";
import { osculatingOrbit } from "../osculating-orbit.ts";

test("inclined retrograde ellipse closes, includes the current point and retains eccentric geometry", () => {
  const mu = 100,
    a = 20,
    e = 0.6,
    r = a * (1 - e),
    v = Math.sqrt((mu * (1 + e)) / r);
  const orbit = osculatingOrbit([r, 0, 0], [0, 0, -v], mu, 1e9, 2048, true)!;
  assert.ok(orbit && orbit.points.length <= 2048);
  assert.deepEqual(orbit.points[0], orbit.points.at(-1));
  const i = orbit.epochsTdbSeconds.indexOf(1e9);
  assert.deepEqual(orbit.points[i], [r, 0, 0]);
  assert.ok(orbit.points[i + 1][2] < 0);
  assert.ok(orbit.points.every((p) => p[1] === 0));
  assert.ok(
    Math.abs(
      Math.max(...orbit.points.map((p) => Math.hypot(...p))) - a * (1 + e),
    ) < 1e-8,
  );
  assert.ok(
    orbit.epochsTdbSeconds.every((t, j, ts) => j === 0 || t > ts[j - 1]),
  );
  assert.ok(
    Math.abs(
      (orbit.epochsTdbSeconds.at(-1)! - orbit.epochsTdbSeconds[0]) /
        orbit.period -
        1,
    ) < 1e-8,
  );
});

test("unbound, radial, nonfinite and invalid-gravity states cannot become closed display ellipses", () => {
  assert.equal(
    osculatingOrbit([10, 0, 0], [0, 2, 0], 1, 0, 256, false),
    undefined,
  );
  assert.equal(
    osculatingOrbit([10, 0, 0], [1, 0, 0], 1, 0, 256, false),
    undefined,
  );
  assert.equal(
    osculatingOrbit([NaN, 0, 0], [0, 1, 0], 1, 0, 256, false),
    undefined,
  );
  assert.equal(
    osculatingOrbit([10, 0, 0], [0, 1, 0], 0, 0, 256, false),
    undefined,
  );
});

test("24 source points retain an analytic ellipse at every intermediate display angle", () => {
  const orbit = osculatingOrbit(
    [8, 0, 0],
    [0, 0, -Math.sqrt(20)],
    100,
    5,
    24,
    false,
  )!;
  assert.ok(orbit.points.length <= 24);
  const conic = orbit.conic;
  assert.ok(Math.abs(conic.semiLatusRectumKm - 12.8) < 1e-10);
  assert.deepEqual(conic.radialUnit, [1, 0, 0]);
  assert.deepEqual(conic.transverseUnit, [0, 0, -1]);
  for (let i = 0; i <= 1440; i++) {
    const angle = (2 * Math.PI * i) / 1440,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const r =
      conic.semiLatusRectumKm /
      (1 + conic.eccentricityRadial * c + conic.eccentricityTransverse * s);
    const x = r * c,
      z = -r * s;
    assert.ok(Math.abs((x + 12) ** 2 / 400 + (z * z) / 256 - 1) < 1e-10);
  }
  assert.deepEqual(orbit.points[orbit.epochsTdbSeconds.indexOf(5)], [8, 0, 0]);
});
