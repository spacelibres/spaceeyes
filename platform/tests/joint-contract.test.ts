import test from "node:test";
import assert from "node:assert/strict";
import {snapshotJoints} from "../joint-contract.ts";
test("canonical joint aliases cannot bind the same node twice",()=>{
 const aim={joint:"truss joint",hingeAxis:[1,0,0],normalAxis:[0,1,0],targetDirectionIcrf:[0,0,1]};
 assert.throws(()=>snapshotJoints([aim,{...aim,joint:"truss_joint"}]));
});
