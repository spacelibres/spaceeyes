import {test} from 'node:test';
import assert from 'node:assert/strict';
import {identicalDynOverlap,unchangedDynIntervals} from '../dyn-continuity.ts';
import {AdaptiveTrailState} from '../adaptive-trail.ts';
import {evaluateOrb} from '../dyn-evaluator.ts';
import type {DecodedDyn} from '../dyn-decoder.ts';
function source(times:number[],start=times[0],end=times.at(-1)!):DecodedDyn{return {kind:'inline',type:'lin',version:2,paddingWidth:3,coverage:{start,end},records:times.map(time=>({time,position:[time,time*time,0] as const,velocity:[1,2*time,0] as const}))};}
test('only identical consecutive records certify interpolation, including trimmed bracketing edges',()=>{
 const a=source([0,10,20],2,18),b=source([0,10,20,30],5,28);
 assert.deepEqual(unchangedDynIntervals(a,b),[[5,18]]);
 for(const t of [5,7,10,17,18])assert.deepEqual(evaluateOrb(a,t),evaluateOrb(b,t));
 assert.equal(identicalDynOverlap(a,source([0,5,10,20,30],5,28)),false,'new overlap knot rejected');
 assert.equal(identicalDynOverlap(a,source([0,20,30],5,28)),false,'missing overlap knot rejected');
 assert.deepEqual(unchangedDynIntervals(a,source([-10,10,20,30],5,28)),[[10,18]],'changed outside-coverage bracket cannot certify edge');
 assert.deepEqual(unchangedDynIntervals(a,source([30,40])),[]);
 assert.deepEqual(unchangedDynIntervals(a,{...b,version:1}),[]);
 assert.deepEqual(unchangedDynIntervals(a,{...b,gravitationalParameter1:1}),[]);
});
test('retained state removes gaps, invalid samples and intervals crossing uncertified regions',()=>{
 const state=new AdaptiveTrailState();for(const time of [0,5,10,15,20])state.samples.set(time,[time,0,0]);state.samples.set(12,undefined);state.times=[0,5,10,12,15,20];
 state.segments.set('5:10',{a:5,b:10,score:0,terminal:false});state.segments.set('10:15',{a:10,b:15,score:0,terminal:false});
 state.retainIntervals([[5,10],[15,18]]);assert.deepEqual(state.times,[5,10,15]);assert.equal(state.samples.has(12),false);assert.deepEqual([...state.segments.keys()],['5:10']);
});
