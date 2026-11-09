import {test} from "node:test";
import assert from "node:assert/strict";
import {eyesOrbAutoLength} from "../eyes-trail-auto.ts";
import type {DecodedDyn} from "../dyn-decoder.ts";

function segment(e0: number, e1 = e0, mu1: number | undefined = 8, mu2: number | undefined = 0): DecodedDyn {
  return {kind:"inline",type:"orb",version:2,paddingWidth:0,coverage:{start:0,end:10},
    gravitationalParameter1:mu1,gravitationalParameter2:mu2,
    records:[0,10].map((time,i)=>({time,semiMajorAxis:2,eccentricity:i?e1:e0,meanAngularMotion:999,
      meanAnomalyAtEpoch:0,orientation:[1,0,0,0] as const}))};
}

test("NASA orb auto length preserves circular period and combined gravitational parameters",()=>{
  assert.ok(Math.abs(eyesOrbAutoLength(segment(0,0,5,3),5,[2,0,0],[0,2,0])!-2*Math.PI)<1e-12);
});

test("orb eccentricity interpolates at midpoint and includes exact endpoints in either traversal direction",()=>{
  const d=segment(0.2,0.6);
  for(const t of [10,5,0,5,10]) {
    const e=0.2+0.4*t/10;
    const expected=2*Math.PI/((1-e*e)**1.5);
    assert.ok(Math.abs(eyesOrbAutoLength(d,t,[2,0,0],[0,2,0])!-expected)<1e-12);
  }
});

test("NASA hyperbolic positive-energy cube clamp is retained explicitly",()=>{
  // h=4, mu=8, e=2 => E=6, min(1,E^3)=1.
  assert.equal(eyesOrbAutoLength(segment(2),5,[2,0,0],[0,2,0]),16*Math.PI/Math.sqrt(8));
  // Positive E below 1 must not be clamped up to 1.
  const e=Math.sqrt(1.25);
  assert.ok(Math.abs(eyesOrbAutoLength(segment(e),5,[2,0,0],[0,2,0])!-16*Math.PI)<1e-11);
});

test("degenerate, out-of-coverage and non-orb inputs defer to bounded fallback",()=>{
  for(const e of [1,NaN]) assert.equal(eyesOrbAutoLength(segment(e),5,[2,0,0],[0,2,0]),undefined);
  assert.equal(eyesOrbAutoLength(segment(0),5,[2,0,0],[1,0,0]),undefined);
  assert.equal(eyesOrbAutoLength(segment(0),11,[2,0,0],[0,2,0]),undefined);
  assert.equal(eyesOrbAutoLength(segment(0,0,0,0),5,[2,0,0],[0,2,0]),undefined);
  const index:DecodedDyn={kind:"index",type:"orb",version:2,paddingWidth:0,coverage:{start:0,end:10},segments:[{start:0,end:10}]};
  assert.equal(eyesOrbAutoLength(index,5,[2,0,0],[0,2,0]),undefined);
  const d=segment(0);
  if (d.kind === "inline" && d.type === "orb") {
    assert.equal(eyesOrbAutoLength({...d,records:[d.records[0]]},5,[2,0,0],[0,2,0]),undefined);
    assert.equal(eyesOrbAutoLength({...d,records:[d.records[0],d.records[0]]},5,[2,0,0],[0,2,0]),undefined);
  }
});

test("missing mu headers retain NASA defaults and near-parabolic math is not silently a circular period",()=>{
  const d={...segment(0),gravitationalParameter1:undefined,gravitationalParameter2:undefined};
  assert.ok(Math.abs(eyesOrbAutoLength(d,5,[1,0,0],[0,1,0])!-2*Math.PI)<1e-12);
  assert.ok(eyesOrbAutoLength(segment(1-1e-8),5,[2,0,0],[0,2,0])!>946080000);
});
