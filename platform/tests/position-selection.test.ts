import {test} from "node:test";
import assert from "node:assert/strict";
import {acceptsPositionEpoch,parsePositionSelection} from "../position-selection.ts";

test("resolved controller eligibility has open boundaries and immutable validated metadata",()=>{
 const selection=parsePositionSelection('{"track":"craft/phase/orb","lowerExclusive":5,"upperExclusive":8}')!;
 assert.ok(Object.isFrozen(selection));
 assert.equal(acceptsPositionEpoch(selection,5),false);
 assert.equal(acceptsPositionEpoch(selection,5.001),true);
 assert.equal(acceptsPositionEpoch(selection,8),false);
 assert.equal(parsePositionSelection(null),undefined);
 for(const raw of ['{}','{"track":""}','{"track":"a","lowerExclusive":null}',
   '{"track":"a","upperExclusive":"5"}','{"track":"a","lowerExclusive":8,"upperExclusive":5}'])
   assert.throws(()=>parsePositionSelection(raw));
 assert.equal(acceptsPositionEpoch(undefined,NaN),false);
 const gap=parsePositionSelection('{"track":"a","lowerInclusive":5,"upperExclusive":7}');
 assert.equal(acceptsPositionEpoch(gap,4.99),false);
 assert.equal(acceptsPositionEpoch(gap,5),true);
 assert.equal(acceptsPositionEpoch(gap,7),false);
});
