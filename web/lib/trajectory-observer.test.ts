import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trajectoryObserverChanged,coherentTrajectoryObserver} from './trajectory-observer.ts';
test('near-camera detail refresh follows zoom and moving source but ignores subthreshold jitter',()=>{
 const old={camera:[1e8,0,10],target:[1e8,0,0]};
 assert.equal(trajectoryObserverChanged(undefined,old),true);
 assert.equal(trajectoryObserverChanged(old,{...old,camera:[1e8,0,11]}),false);
 assert.equal(trajectoryObserverChanged(old,{...old,camera:[1e8,0,1]}),true);
 assert.equal(trajectoryObserverChanged(old,{camera:[1e8,100,10],target:[1e8,100,0]}),true);
});


test('accelerated observers keep the measured 72m offset at the current framing epoch',()=>{
 for(const rate of [20,3600,-3600]) {
  const snapshot={epochTdbSeconds:100,framingReferenceId:'iss',framingReferencePositionKm:[10000,0,0],positionKm:[10000,.072,0]};
  const epoch=100+rate*.1;
  const observer=coherentTrajectoryObserver(snapshot,'iss',epoch,(_id,t)=>[t*100,0,0])!;
  assert.deepEqual(observer.target,[epoch*100,0,0]);
  assert.ok(Math.abs(observer.camera[1]-.072)<1e-12);
  assert.equal(observer.camera[0],observer.target[0]);
 }
});
test('system camera translates with its framing host rather than the selected child',()=>{
 const observer=coherentTrajectoryObserver({epochTdbSeconds:0,framingReferenceId:'earth',framingReferencePositionKm:[10,0,0],positionKm:[20,5,0]},'iss',1,id=>id==='earth'?[100,0,0]:[110,2,0])!;
 assert.deepEqual(observer,{camera:[110,5,0],target:[110,2,0]});
});
test('follow camera offset rotates in the coherent reference basis without changing camera controls',()=>{
 const observer=coherentTrajectoryObserver({epochTdbSeconds:0,framingReferenceId:'iss',framingReferencePositionKm:[0,0,0],positionKm:[-1,0,0],followReferenceId:'earth',followReferencePositionKm:[10,0,0]},'iss',1,id=>id==='earth'?[100,10,0]:[100,0,0])!;
 assert.deepEqual(observer,{camera:[100,-1,0],target:[100,0,0]});
 assert.equal(coherentTrajectoryObserver({positionKm:[0,0,0]},'iss',1,()=>[0,0,0]),undefined);
});
