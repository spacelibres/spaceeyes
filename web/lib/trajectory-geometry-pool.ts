import type {DecodedDyn} from '../../platform/dyn-decoder.ts';
import type {GeometryMessage,GeometryReply} from '../../platform/trajectory-geometry-runtime.ts';
import type {GeometryWorkerPort} from './trajectory-geometry-client.ts';
export function geometryWorkerCount(hardwareConcurrency:number|undefined) {
 return Math.min(4,Math.max(1,Math.floor((Number.isFinite(hardwareConcurrency)?hardwareConcurrency!:4)/4)));
}
export function geometryShard(id:string,width:number) {
 let hash=2166136261;
 for(let i=0;i<id.length;i++){hash^=id.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return (hash>>>0)%width;
}
const size=(source:DecodedDyn|undefined)=>source?{records:source.kind==='inline'?source.records.length:source.segments.length,bytes:source.kind==='inline'?source.records.length*(source.type==='orb'?72:source.type==='ori'?64:56):source.segments.length*16}:{records:0,bytes:0};
/** Fixed routing retains each object's scientific cache; source deltas stay batched. */
export class GeometryWorkerPool implements GeometryWorkerPort {
 onmessage:GeometryWorkerPort['onmessage']=null;
 onerror:GeometryWorkerPort['onerror']=null;
 private workers:GeometryWorkerPort[]=[];
 private sources=new Map<string,{position:ReturnType<typeof size>;orientation:ReturnType<typeof size>}>();
 private owners=new Map<string,number>();
 private stopped=false;
 constructor(create:()=>GeometryWorkerPort,hardwareConcurrency?:number) {
  for(let i=0;i<geometryWorkerCount(hardwareConcurrency);i++) {
   try{this.workers.push(create());}catch(error){if(!this.workers.length)throw error;break;}
  }
  for(const worker of this.workers) {
   worker.onmessage=event=>{if(this.stopped)return;if(this.owners.get(event.data.id)===event.data.token)this.owners.delete(event.data.id);this.onmessage?.(event);};
   worker.onerror=event=>{if(!this.stopped)this.onerror?.(event);};
  }
 }
 get width(){return this.workers.length;}
 postMessage(message:GeometryMessage) {
  if(this.stopped)throw Error('Geometry worker pool terminated');
  if(message.type==='sources') {
   for(const id of message.removed)this.sources.delete(id);
   for(const source of message.sources) {
    const previous=this.sources.get(source.id);
    this.sources.set(source.id,{position:source.positionChanged?size(source.data):previous?.position??size(undefined),orientation:source.orientationChanged?size(source.ori):previous?.orientation??size(undefined)});
   }
   if(this.diagnostics().sourceRecords>1000000)throw Error('Geometry pool source record budget');
  }
  if(message.type==='job'||message.type==='cancel') {
   const id=message.type==='job'?message.job.id:message.id;
   if(message.type==='job') {this.owners.set(id,message.job.token);if(this.owners.size>256)throw Error('Geometry pool owner budget');}
   else if(this.owners.get(id)===message.token)this.owners.delete(id);
   this.workers[geometryShard(id,this.width)].postMessage(message);
  } else for(const worker of this.workers)worker.postMessage(message);
 }
 diagnostics() {
  let sourceRecords=0,sourceNumericBytesEstimate=0;
  for(const value of this.sources.values()){sourceRecords+=value.position.records+value.orientation.records;sourceNumericBytesEstimate+=value.position.bytes+value.orientation.bytes;}
  return {workers:this.width,sourceRecords,sourceNumericBytesEstimate,aggregateRecordCopies:sourceRecords*this.width,aggregateNumericBytesEstimate:sourceNumericBytesEstimate*this.width,maxAggregateRecords:1000000*this.width,pendingOwners:this.owners.size};
 }
 terminate(){if(this.stopped)return;this.stopped=true;for(const worker of this.workers){worker.onmessage=null;worker.onerror=null;try{worker.terminate();}catch{}}this.sources.clear();this.owners.clear();}
}
