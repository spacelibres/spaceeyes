import { test } from "node:test";
import assert from "node:assert/strict";
import { osculatingOrbit } from "../osculating-orbit.ts";

test("inclined retrograde ellipse closes, includes the current point and retains eccentric geometry", () => {
  const mu=100, a=20, e=0.6, r=a*(1-e), v=Math.sqrt(mu*(1+e)/r);
  const orbit=osculatingOrbit([r,0,0],[0,0,-v],mu,1e9,2048,true)!;
  assert.ok(orbit && orbit.points.length<=2048);
  assert.deepEqual(orbit.points[0],orbit.points.at(-1));
  const i=orbit.epochsTdbSeconds.indexOf(1e9);
  assert.deepEqual(orbit.points[i],[r,0,0]);
  assert.ok(orbit.points[i+1][2]<0);
  assert.ok(orbit.points.every(p=>p[1]===0));
  assert.ok(Math.abs(Math.max(...orbit.points.map(p=>Math.hypot(...p)))-a*(1+e))<1e-8);
  assert.ok(orbit.epochsTdbSeconds.every((t,j,ts)=>j===0 || t>ts[j-1]));
  assert.ok(Math.abs((orbit.epochsTdbSeconds.at(-1)!-orbit.epochsTdbSeconds[0])/orbit.period-1)<1e-8);
});

test("unbound, radial, nonfinite and invalid-gravity states cannot become closed display ellipses", () => {
  assert.equal(osculatingOrbit([10,0,0],[0,2,0],1,0,256,false),undefined);
  assert.equal(osculatingOrbit([10,0,0],[1,0,0],1,0,256,false),undefined);
  assert.equal(osculatingOrbit([NaN,0,0],[0,1,0],1,0,256,false),undefined);
  assert.equal(osculatingOrbit([10,0,0],[0,1,0],0,0,256,false),undefined);
});
