import {test} from "node:test";
import assert from "node:assert/strict";
import {eyesLineColor} from "../eyes-line-style.ts";
const nasa: Record<string,number[]> = {
 mercury:[151/255,104/255,172/255,1],venus:[176/255,121/255,25/255,1],
 earth:[0,.6,.8,1],mars:[154/255,78/255,25/255,1],jupiter:[218/255,139/255,114/255,1],
 saturn:[213/255,193/255,135/255,1],uranus:[104/255,.8,218/255,1],neptune:[112/255,140/255,227/255,1]
};
for(const [id,rgb] of Object.entries(nasa)) test(`NASA TrailManager golden RGB: ${id}`,()=>{
 assert.deepEqual(eyesLineColor(id),rgb);
});
test("NASA unnamed moon and spacecraft lines are white",()=>{
 for(const id of ["moon","io","sc_iss"]) assert.deepEqual(eyesLineColor(id),[1,1,1,1]);
});
