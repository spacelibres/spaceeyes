import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GeometryWorkerPool,geometryWorkerCount,geometryShard} from './trajectory-geometry-pool.ts';
import {TrajectoryGeometryClient,type GeometryWorkerPort} from './trajectory-geometry-client.ts';
import type {GeometryMessage,GeometryReply,SourceDelta} from '../../platform/trajectory-geometry-runtime.ts';
import type {DecodedDyn} from '../../platform/dyn-decoder.ts';
class Port implements GeometryWorkerPort {
 onmessage:GeometryWorkerPort['onmessage']=null;onerror:GeometryWorkerPort['onerror']=null;
 messages:GeometryMessage[]=[];terminated=0;
 postMessage(message:GeometryMessage){this.messages.push(message);}
 terminate(){this.terminated++;}
 reply(reply:GeometryReply){this.onmessage?.({data:reply} as MessageEvent<GeometryReply>);}
}
const payload=(count:number,type:'orb'|'ori'='orb')=>({kind:'inline',type,records:{length:count}} as unknown as DecodedDyn);
const delta=(id:string,records:number):SourceDelta=>({id,data:payload(records),spinAnchors:[],positionChanged:true,orientationChanged:true,positionVersion:1,orientationVersion:2});
test('geometry concurrency respects logical hardware capacity and never exceeds four workers',()=>{
 for(const [hardware,expected] of [[undefined,1],[2,1],[4,1],[8,2],[16,4],[64,4],[NaN,1],[Infinity,1]] as const)assert.equal(geometryWorkerCount(hardware),expected);
 const ports:Port[]=[];const pool=new GeometryWorkerPool(()=>{const port=new Port();ports.push(port);return port;},16);
 assert.equal(pool.width,4);pool.terminate();pool.terminate();assert.ok(ports.every(port=>port.terminated===1));
});
test('source deltas and epoch ticks broadcast once while jobs and cancellation retain one stable shard',()=>{
 const ports:Port[]=[];const pool=new GeometryWorkerPool(()=>{const port=new Port();ports.push(port);return port;},16);
 try {
  pool.postMessage({type:'sources',sources:[delta('sc_iss',100)],removed:[]});pool.postMessage({type:'tick',epoch:123});
  assert.ok(ports.every(port=>port.messages.length===2));
  for(const id of ['sc_iss','sc_noaa_21','sc_ace']) {
   const token=123;
   pool.postMessage({type:'job',job:{id,token,count:128,detailed:false,guardSeconds:7200}});
   pool.postMessage({type:'cancel',id,token});
   const index=geometryShard(id,4);
   assert.equal(ports[index].messages.filter(message=>message.type==='job'&&message.job.id===id).length,1);
   assert.equal(ports[index].messages.filter(message=>message.type==='cancel'&&message.id===id).length,1);
   assert.equal(ports.filter(port=>port.messages.some(message=>message.type==='job'&&message.job.id===id)).length,1);
  }
  assert.equal(pool.diagnostics().sourceRecords,100);assert.equal(pool.diagnostics().aggregateRecordCopies,400);
  assert.equal(pool.diagnostics().sourceNumericBytesEstimate,7200);assert.equal(pool.diagnostics().aggregateNumericBytesEstimate,28800);
  pool.postMessage({type:'sources',sources:[{...delta('sc_iss',0),data:undefined,ori:payload(2,'ori'),positionChanged:false,positionVersion:1,orientationVersion:3}],removed:[]});
  assert.equal(pool.diagnostics().sourceRecords,102,'attitude delta retains the existing position record accounting');
  pool.postMessage({type:'sources',sources:[],removed:['sc_iss']});assert.equal(pool.diagnostics().aggregateRecordCopies,0);
 }finally{pool.terminate();}
});
test('the replicated pool enforces one million logical records and failures terminate every shard',()=>{
 const ports:Port[]=[];const pool=new GeometryWorkerPool(()=>{const port=new Port();ports.push(port);return port;},16);
 const client=new TrajectoryGeometryClient(pool);
 pool.postMessage({type:'sources',sources:[delta('sc_iss',1000000)],removed:[]});
 assert.equal(pool.diagnostics().aggregateRecordCopies,4000000);
 assert.equal(pool.diagnostics().maxAggregateRecords,4000000);
 assert.throws(()=>pool.postMessage({type:'sources',sources:[delta('sc_noaa_21',1)],removed:[]}),/record budget/);
 ports[2].onerror?.({message:'failed shard'} as ErrorEvent);
 assert.equal(client.available,false);assert.ok(ports.every(port=>port.terminated===1));client.dispose();
});
