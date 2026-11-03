import {TrajectoryWorkQueue} from '../../web/lib/trajectory-work.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SolarSystemData,solarCatalog} from '../solar-system.ts';
import type {PluginContext} from '../plugin-host.ts';
import {TrajectoryGeometryRuntime,type GeometryMessage,type GeometryReply} from '../trajectory-geometry-runtime.ts';
import {TrajectoryGeometryClient,geometryOrNative,type GeometryWorkerPort} from '../../web/lib/trajectory-geometry-client.ts';
const epoch=846972583;
function bytes(ori=false,radius=7000){const b=new Uint8Array(ori?140:172),v=new DataView(b.buffer);v.setInt16(0,2,true);b.set(ori?[111,114,105,0,3,1]:[111,114,98,0,3],2);if(!ori){v.setFloat64(7,398600,true);v.setFloat64(15,0,true);b[23]=1;}v.setInt32(ori?8:24,2,true);for(let i=0;i<2;i++)(ori?[epoch-1e7+i*2e7,1,0,0,0,0,0,0]:[epoch-1e7+i*2e7,radius,0,.001,0,1,0,0,0]).forEach((x,j)=>v.setFloat64((ori?12:28)+i*(ori?64:72)+j*8,x,true));return b;}
function data(){return new SolarSystemData({signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}} as unknown as PluginContext,{fetch:async url=>new Response(bytes(String(url).includes('type=ori')))});}
class Port implements GeometryWorkerPort {
 onmessage:GeometryWorkerPort['onmessage']=null;onerror:GeometryWorkerPort['onerror']=null;
 clock=0;tasks:(()=>void)[]=[];messages:GeometryMessage[]=[];transfers=0;runtime:TrajectoryGeometryRuntime;
 constructor(now?:()=>number){this.runtime=new TrajectoryGeometryRuntime((packet,transfer)=>{this.transfers+=transfer.length;const cloned=structuredClone(packet,{transfer});this.onmessage?.({data:cloned} as MessageEvent<GeometryReply>);},run=>this.tasks.push(run),now??(()=>this.clock+=.001));}
 postMessage(message:GeometryMessage){this.messages.push(message);this.runtime.receive(structuredClone(message));}
 run(){this.tasks.shift()?.();}
 terminate(){this.tasks=[];this.runtime.dispose();}
}
test('worker geometry is exactly the canonical scientific sampler and source sync is incremental',async()=>{
 const main=data(),port=new Port(),client=new TrajectoryGeometryClient(port);
 try {
  await main.load(['earth','sc_iss','sc_noaa_21'],epoch,[]);
  client.sync(main);client.tick(epoch);
  const initial=port.messages.filter(m=>m.type==='sources').length;
  client.sync(main);assert.equal(port.messages.filter(m=>m.type==='sources').length,initial);
  for(const id of ['sc_iss','sc_noaa_21']) {
   const request=client.request({id,count:185,detailed:false,guardSeconds:7200});
   for(let n=0;n<256&&!request.done;n++)port.run();
   assert.equal(request.done,true);
   const actual=request.result(),work=main.trailSampleSteps(id,epoch,185,false,undefined,7200);
   let step=work.next();while(!step.done)step=work.next();
   const expected=step.value;
   assert.deepEqual(actual.points,expected.points);assert.deepEqual(actual.epochsTdbSeconds,expected.epochsTdbSeconds);
   assert.deepEqual(actual.breakIndices,expected.breakIndices);assert.deepEqual(actual.drawRangeTdbSeconds,expected.drawRangeTdbSeconds);
   assert.equal(actual.durationSeconds,expected.durationSeconds);assert.equal(actual.sourceCurrent,true);request.cancel();
  }
  assert.equal(port.transfers,4);
  const payloadCount=port.messages.filter(m=>m.type==='sources').length;
  const proofRequest=client.request({id:'sc_iss',count:128,detailed:false,guardSeconds:7200});
  for(let n=0;n<256&&!proofRequest.done;n++)port.run();
  const previousProof=proofRequest.result();
  for(let frame=0;frame<30;frame++){main.publishAt(epoch+frame*120);client.sync(main);}
  assert.equal(port.messages.filter(m=>m.type==='sources').length,payloadCount,'publication epochs and Sun coverage never change scientific tokens');
  assert.equal(previousProof.sourceCurrent,true);
  proofRequest.cancel();
  const oldSources=main.exportScientificSources();
  const changed=oldSources.find(source=>source.id==='sc_iss')!;
  main.importScientificSources([{...changed,ori:undefined,positionChanged:false,orientationChanged:true,oriKey:'changed'}]);
  client.sync(main);
  const patch=port.messages.at(-1)!;assert.equal(patch.type,'sources');
  if(patch.type==='sources'){assert.equal(patch.sources.length,1);assert.equal(patch.sources[0].data,undefined,'unchanged DYN arrays are never cloned for attitude-only changes');}
 }finally{client.dispose();main.dispose();}
});
test('source removal invalidates active dependencies and old proofs never resurrect after readdition',async()=>{
 const main=data(),port=new Port(),client=new TrajectoryGeometryClient(port);
 try {
  await main.load(['earth','sc_iss'],epoch,[]);client.sync(main);client.tick(epoch);
  const saved=main.exportScientificSources();
  const request=client.request({id:'sc_iss',count:512,detailed:true,guardSeconds:7200});
  for(let n=0;n<256&&!request.done;n++)port.run();
  const old=request.result();assert.equal(old.sourceCurrent,true);
  main.importScientificSources([],['earth']);client.sync(main);assert.equal(old.sourceCurrent,false);
  main.importScientificSources(saved);client.sync(main);assert.equal(old.sourceCurrent,false,'reincarnated sources have new monotonic tokens');
  const active=port.runtime.data.trailSampleSteps('sc_iss',epoch,512,true,undefined,7200);
  assert.equal(active.next().done,false);
  port.runtime.data.importScientificSources([],['earth']);
  try {let done=active.next();while(!done.done)done=active.next();assert.equal(done.value.sourceCurrent,false);}
  catch(error){assert.match(String(error),/Trail unavailable|coverage|Object unavailable/);}
 }finally{client.dispose();main.dispose();}
});
test('111 real catalog jobs repeatedly publish off the main frame budget at +/-3600x',async()=>{
 for(const rate of [3600,-3600]) {
  const main=data(),port=new Port(),client=new TrajectoryGeometryClient(port);
  try {
   await main.load(solarCatalog.filter(body=>body.kind==='spacecraft').map(body=>body.id),epoch,[]);
   const eligible=main.status().filter(s=>s.status==='ready'&&s.id.startsWith('sc_')&&main.hasTrajectory(s.id,epoch)).map(s=>s.id);
   const ids=['sc_iss',...eligible.filter(id=>id!=='sc_iss')].slice(0,111);assert.equal(ids.length,111);
   const jobs=new Map<string,{request?:ReturnType<TrajectoryGeometryClient['request']>;published:number;requested:number;lastFrame?:number;last?:ReturnType<ReturnType<TrajectoryGeometryClient['request']>['result']>}>();
   for(const id of ids)jobs.set(id,{published:0,requested:0});
   let live=epoch;
   for(let frame=0;frame<360;frame++) {
    live+=rate/30;client.sync(main);
    const point=main.position('sc_iss',live),observer=point.map((v,i)=>v+(i===2?.072:0));client.tick(live,'sc_iss',observer);
    // Long-window missions must actually be requested repeatedly before
    // asserting repeated publications; this adds load, never weakens coverage.
    for(const [id,job] of jobs)if(!job.request && (!job.last || frame-(job.lastFrame??0)>=60 || live<job.last.refreshRange[0]+2500 || live>job.last.refreshRange[1]-2500)) {
      job.requested++;
      job.request=client.request({id,count:id==='sc_iss'?512:128,detailed:id==='sc_iss',guardSeconds:7200,observer:id==='sc_iss'?observer:undefined});
    }
    // The worker has its own 15ms chunks, independent of the renderer's ~6ms remainder.
    port.run();port.run();
    for(const job of jobs.values())if(job.request?.done){const value=job.request.result();assert.equal(value.sourceCurrent,true);if(live>=value.refreshRange[0]&&live<=value.refreshRange[1]){job.published++;job.last=value;job.lastFrame=frame;}job.request.cancel();job.request=undefined;}
   }
   for(const [id,job] of jobs)assert.ok(job.requested>=3&&job.published>=3,`${rate} ${id}: ${job.published} current publications/${job.requested} requests; last frame=${job.lastFrame}`);
   assert.ok(port.runtime.data.cacheStats().records<=1000000);assert.ok(port.messages.filter(m=>m.type==='sources').length<5,'frames never reclone unchanged source arrays');
  }finally{client.dispose();main.dispose();}
 }
});


test('a failed worker retries native science inside the same blocked initial owner',async()=>{
 const main=data(),port=new Port(),client=new TrajectoryGeometryClient(port);
 try {
  await main.load(['earth','sc_iss'],epoch,[]);client.sync(main);client.tick(epoch);
  const request=client.request({id:'sc_iss',count:128,detailed:false,guardSeconds:7200});
  const queue=new TrajectoryWorkQueue<ReturnType<SolarSystemData['trailSamples']>>(()=>0);
  let committed=0,errors=0,released=0,fallbacks=0;
  queue.enqueue({objectId:'sc_iss',revision:1,blocked:()=>!request.done,
   create:()=>geometryOrNative(request,()=>{fallbacks++;return main.trailSampleSteps('sc_iss',epoch,128,false,undefined,7200);}),
   commit:value=>{assert.equal(value.sourceCurrent,true);committed++;},onError:()=>{errors++;},release:()=>{released++;}});
  assert.equal(queue.turn({budgetMs:1,maxSteps:65536}).steps,0,'waiting packets consume no main-thread sampling budget');
  port.onerror?.({message:'worker stopped'} as ErrorEvent);
  queue.turn({budgetMs:1,maxSteps:65536});
  assert.equal(fallbacks,1);assert.equal(committed,1);assert.equal(errors,0);assert.equal(released,1);
 }finally{client.dispose();main.dispose();}
});


test('synchronous sync/job transport failures terminate the worker and preserve native fallback owners',async()=>{
 for(const failure of ['sources','job'] as const) {
  class ThrowingPort extends Port {
   terminated=0;
   override postMessage(message:GeometryMessage){if(message.type===failure)throw Error('DataCloneError');super.postMessage(message);}
   override terminate(){this.terminated++;super.terminate();}
  }
  const main=data(),port=new ThrowingPort(),client=new TrajectoryGeometryClient(port);
  try {
   await main.load(['earth','sc_iss','sc_noaa_21'],epoch,[]);
   assert.doesNotThrow(()=>client.sync(main));assert.doesNotThrow(()=>client.tick(epoch));
   let committed=0,errors=0;
   const queue=new TrajectoryWorkQueue<ReturnType<SolarSystemData['trailSamples']>>(()=>0);
   for(const id of ['sc_iss','sc_noaa_21']) {
    const request=client.request({id,count:128,detailed:false,guardSeconds:7200});
    queue.enqueue({objectId:id,revision:1,blocked:()=>!request.done,
      create:()=>geometryOrNative(request,()=>main.trailSampleSteps(id,epoch,128,false,undefined,7200)),commit:()=>{committed++;},onError:()=>{errors++;}});
   }
   queue.turn({budgetMs:1,maxSteps:65536});
   assert.equal(committed,2);assert.equal(errors,0);assert.equal(client.available,false);assert.equal(port.terminated,1);
   client.dispose();assert.equal(port.terminated,1,'failed workers are not left running or terminated repeatedly');
  }finally{client.dispose();main.dispose();}
 }
});


test('pending 20x-to-3600x and forward-to-reverse owners replace guards while retaining worker samples',async()=>{
 for(const nextRate of [3600,-3600]) {
  let clock=0;
  const main=data(),port=new Port(()=>clock+=.02),client=new TrajectoryGeometryClient(port);
  try {
   await main.load(['earth','sc_iss'],epoch,[]);client.sync(main);client.tick(epoch);
   const old=client.request({id:'sc_iss',count:512,detailed:true,guardSeconds:nextRate>0?40:7200});
   port.run();assert.equal(old.done,false,'start with genuinely active scientific work');
   const retained=port.runtime.data.cacheStats().trailSamplingEntries;assert.equal(retained,1);
   old.cancel();assert.equal(port.runtime.data.cacheStats().trailSamplingEntries,retained,'owner cancellation preserves scientific samples');
   const live=epoch+Math.sign(nextRate)*120;client.tick(live);
   const replacement=client.request({id:'sc_iss',count:512,detailed:true,guardSeconds:7200});
   assert.notEqual(replacement.token,old.token);
   for(let n=0;n<512&&!replacement.done;n++)port.run();
   const value=replacement.result();assert.equal(value.sourceCurrent,true);
   assert.ok(value.refreshRange[0]<=live&&value.refreshRange[1]>=live);
   assert.ok(value.refreshRange[1]-value.drawEpochTdbSeconds>1000,'high-rate request never keeps the old 40-second guard');
   assert.ok(value.drawEpochTdbSeconds-value.refreshRange[0]>1000,'reverse playback has genuine past coverage');
  }finally{client.dispose();main.dispose();}
 }
});
