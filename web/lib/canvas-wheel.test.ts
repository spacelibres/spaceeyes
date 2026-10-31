import {test} from "node:test";
import assert from "node:assert/strict";
import {canvasWheelDelta, handleCanvasWheel} from "./canvas-wheel.ts";
test("wheel units retain camera direction and stay inside SDK bounds", () => {
  assert.equal(canvasWheelDelta(120,0,720),0.12);
  assert.ok(Math.abs(canvasWheelDelta(-3,1,720)! + 0.3) < 1e-12);
  assert.equal(canvasWheelDelta(1,2,720),0.72);
  assert.equal(canvasWheelDelta(1e6,0,720),1);
  assert.equal(canvasWheelDelta(-1e6,0,720),-1);
  for(const value of [0,NaN,Infinity]) assert.equal(canvasWheelDelta(value,0,720),undefined);
});
test("one canvas wheel event is consumed once before the native renderer listener", () => {
  const target=new EventTarget(); const sent:number[]=[]; let native=0;
  target.addEventListener("wheel", event => handleCanvasWheel(event as any,720,delta=>sent.push(delta)));
  target.addEventListener("wheel",()=>native++);
  const event=new Event("wheel",{cancelable:true});
  Object.defineProperties(event,{deltaY:{value:120},deltaMode:{value:0}});
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);
  assert.equal(native,0);
  assert.deepEqual(sent,[0.12]);
});
