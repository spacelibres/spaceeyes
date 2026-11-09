import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positionPrefetchCandidates} from './position-prefetch.ts';
const item=(id:string,start:number,end:number)=>({id,status:'ready',positionSource:'dyn',coverage:[start,end]});
test('source prefetch orders every eligible object by nearest expiry in either playback direction',()=>{
 const sources=[item('late',0,400000),item('urgent',0,100000),item('middle',0,200000)];
 const forward=positionPrefetchCandidates(sources,0,86400,0,30,new Set(),new Map(),new Map());
 assert.deepEqual(forward.map(candidate=>candidate.id),['urgent','middle','late']);
 const reverse=positionPrefetchCandidates([item('later',-400000,0),item('now',-100000,0)],0,-86400,0,30,new Set(),new Map(),new Map());
 assert.deepEqual(reverse.map(candidate=>candidate.id),['now','later']);
});
test('day-per-second chunk cooldown is a quarter genuine chunk duration rather than five seconds',()=>{
 const chunks=new Map([['sc',231414]]);
 const [candidate]=positionPrefetchCandidates([item('sc',0,2000000)],0,86400,0,30,new Set(),new Map(),chunks);
 assert.ok(Math.abs(candidate.cooldownMs-669.6006944444445)<1e-8);
 assert.ok(candidate.cooldownMs<5000);
 assert.equal(positionPrefetchCandidates([item('sc',0,2000000)],0,86400,500,30,new Set(),new Map([['sc',candidate.cooldownMs]]),chunks).length,0);
 assert.equal(positionPrefetchCandidates([item('sc',0,2000000)],0,86400,700,30,new Set(),new Map([['sc',candidate.cooldownMs]]),chunks).length,1);
});
test('in-flight and cooldown owners cannot starve other equally urgent sources',()=>{
 const sources=Array.from({length:20},(_,index)=>item(String(index).padStart(2,'0'),0,100000));
 const inflight=new Set(['00','01','02','03']),retry=new Map([['04',1000],['05',1000]]);
 const candidates=positionPrefetchCandidates(sources,0,86400,0,30,inflight,retry,new Map());
 assert.deepEqual(candidates.slice(0,4).map(candidate=>candidate.id),['06','07','08','09']);
 assert.equal(positionPrefetchCandidates(sources,0,0,0,30,new Set(),new Map(),new Map()).length,0);
});
