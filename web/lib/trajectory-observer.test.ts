import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trajectoryObserverChanged} from './trajectory-observer.ts';
test('near-camera detail refresh follows zoom and moving source but ignores subthreshold jitter',()=>{
 const old={camera:[1e8,0,10],target:[1e8,0,0]};
 assert.equal(trajectoryObserverChanged(undefined,old),true);
 assert.equal(trajectoryObserverChanged(old,{...old,camera:[1e8,0,11]}),false);
 assert.equal(trajectoryObserverChanged(old,{...old,camera:[1e8,0,1]}),true);
 assert.equal(trajectoryObserverChanged(old,{camera:[1e8,100,10],target:[1e8,100,0]}),true);
});
