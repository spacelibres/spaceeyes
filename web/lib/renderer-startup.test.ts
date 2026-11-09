import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForRendererStartup,waitForFirstSceneFrames} from './renderer-startup.ts';

test('first rendered scene frames finish before source loading starts',async()=>{
 let callback:FrameRequestCallback|undefined,started=false;
 let status={frames:0,pending:1,failed:0,stableFrames:0};
 const result=waitForFirstSceneFrames(()=>status,new AbortController().signal,fn=>{callback=fn;return 1},()=>{}).then(()=>{started=true});
 const step=async()=>{const cb=callback;callback=undefined;cb?.(0);await Promise.resolve()};
 status={frames:3,pending:1,failed:0,stableFrames:0};await step();assert.equal(started,false);
 status={frames:4,pending:0,failed:0,stableFrames:3};await step();await result;assert.equal(started,true);
});

test('startup waits for real rendered frames, settled assets and empty compilation queue',async()=>{
 let callback:FrameRequestCallback|undefined,ready=false,assets=false;
 let status={frames:0,pending:0,failed:0,stableFrames:0};
 const wait=waitForRendererStartup(()=>status,()=>assets,new AbortController().signal,fn=>{callback=fn;return 1;},()=>{}).then(()=>{ready=true;});
 const step=async()=>{const fn=callback;callback=undefined;fn?.(0);await Promise.resolve();};
 await step();assert.equal(ready,false,'starting a renderer is not evidence of a completed frame');
 status={frames:10,pending:2,failed:0,stableFrames:0};assets=true;await step();assert.equal(ready,false);
 status={frames:11,pending:0,failed:0,stableFrames:1};await step();assert.equal(ready,false);
 status={frames:13,pending:0,failed:0,stableFrames:3};assets=false;await step();assert.equal(ready,false,'CPU asset completion is also required');
 assets=true;await step();assert.equal(ready,false,'assets need subsequent completed render frames');
 status={frames:16,pending:0,failed:0,stableFrames:6};await step();await wait;assert.equal(ready,true);
});

test('cancelled startup releases its pending frame and shader failures never report ready',async()=>{
 const abort=new AbortController();let canceled=0;
 const pending=waitForRendererStartup(()=>({frames:0,pending:1,failed:0,stableFrames:0}),()=>true,abort.signal,()=>9,token=>{assert.equal(token,9);canceled++;});
 abort.abort();await assert.rejects(pending,/abort/i);assert.equal(canceled,1);
 await assert.rejects(waitForRendererStartup(()=>({frames:2,pending:0,failed:1,stableFrames:0}),()=>true,new AbortController().signal,()=>1,()=>{}),/shader/i);
});

test('cancelling the initial scene wait releases its scheduled frame',async()=>{
 const controller=new AbortController();let cancelled=0;
 const pending=waitForFirstSceneFrames(()=>({frames:0,pending:0,failed:0,stableFrames:0}),controller.signal,()=>17,id=>{assert.equal(id,17);cancelled++;});
 controller.abort();await assert.rejects(pending,/abort/i);assert.equal(cancelled,1);
});
