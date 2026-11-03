import type {SolarSystemData,ScientificSourceSnapshot} from '../../platform/solar-system.ts';
import type {GeometryJob,GeometryMessage,GeometryReply,TrailGeometry,SourceDelta} from '../../platform/trajectory-geometry-runtime.ts';
export interface GeometryWorkerPort {postMessage(message:GeometryMessage):void;onmessage:((event:MessageEvent<GeometryReply>)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;terminate():void;diagnostics?():Readonly<Record<string,number>>;}
type Version={source:ScientificSourceSnapshot;positionKey:string;orientationKey:string;position:number;orientation:number};
export class GeometryRequest {
 reply?:GeometryReply;private value?:TrailGeometry;
 readonly id:string;readonly token:number;private owner:TrajectoryGeometryClient;private eligible:()=>boolean;
 constructor(id:string,token:number,owner:TrajectoryGeometryClient,eligible:()=>boolean){this.id=id;this.token=token;this.owner=owner;this.eligible=eligible;}
 get done(){return !!this.reply;}
 result():TrailGeometry {
  if(!this.reply)throw Error('Geometry not ready');
  if('error' in this.reply)throw Error(this.reply.error);
  if(!this.value) {
   const packet=this.reply,points:[number,number,number][]=[];
   if(packet.points.length/3>4096 || packet.epochs.length!==packet.points.length/3)throw Error('Worker geometry capacity');
   for(let i=0;i<packet.points.length;i+=3)points.push([packet.points[i],packet.points[i+1],packet.points[i+2]]);
   const owner=this.owner,eligible=this.eligible;
   this.value={...packet.style,points,epochsTdbSeconds:Array.from(packet.epochs),get sourceCurrent(){return eligible()&&owner.isCurrent(packet.proof);}};
  }
  return this.value;
 }
 cancel(){this.owner.cancel(this);}
}
/** Sends immutable per-source changes once, never fetches or publishes from the worker. */
export class TrajectoryGeometryClient {
 private versions=new Map<string,Version>();private pending=new Map<string,GeometryRequest>();private token=0;private versionClock=0;private failed?:string;
 private worker:GeometryWorkerPort;
 constructor(worker:GeometryWorkerPort) {
  this.worker=worker;
  worker.onmessage=event=>{const request=this.pending.get(event.data.id);if(request?.token===event.data.token)request.reply=event.data;};
  worker.onerror=event=>this.fail(event.message||'Geometry worker failed');
 }
 private fail(message:string) {
  if(this.failed)return;
  this.failed=message;
  for(const request of this.pending.values())request.reply={id:request.id,token:request.token,error:message};
  this.worker.onmessage=null;this.worker.onerror=null;
  try{this.worker.terminate();}catch{/* A failed transport has no authority over platform time. */}
 }
 private post(message:GeometryMessage) {
  if(this.failed)return;
  try{this.worker.postMessage(message);}catch(error){this.fail(String(error));}
 }
 get available(){return !this.failed;}
 diagnostics(){return this.worker.diagnostics?.();}
 sync(data:SolarSystemData) {
  if(this.failed)return;
  const sources:SourceDelta[]=[],live=new Set<string>();
  for(const source of data.exportScientificSources()) {
   live.add(source.id);const previous=this.versions.get(source.id);
   const positionKey=JSON.stringify([source.parent,source.track,source.selection,source.status?.status,source.status?.positionSource]);
   const orientationKey=JSON.stringify([source.oriKey,source.oriSelection,source.oriAbsence,source.outsideOri,source.spinAnchors]);
   const positionChanged=!previous||previous.source.data!==source.data||previous.positionKey!==positionKey;
   const orientationChanged=!previous||previous.source.ori!==source.ori||previous.orientationKey!==orientationKey;
   if(!positionChanged&&!orientationChanged)continue;
   const position=positionChanged?++this.versionClock:previous!.position,orientation=orientationChanged?++this.versionClock:previous!.orientation;
   this.versions.set(source.id,{source,positionKey,orientationKey,position,orientation});
   sources.push({...source,data:positionChanged?source.data:undefined,ori:orientationChanged?source.ori:undefined,positionChanged,orientationChanged,positionVersion:position,orientationVersion:orientation});
  }
  const removed=[...this.versions.keys()].filter(id=>!live.has(id));for(const id of removed)this.versions.delete(id);
  if(sources.length||removed.length)this.post({type:'sources',sources,removed});
 }
 tick(epoch:number,selected?:string,observer?:readonly number[]){this.post({type:'tick',epoch,selected,observer});}
 request(job:Omit<GeometryJob,'token'>,eligible:()=>boolean=()=>true) {
  if(this.pending.size>=256&&!this.pending.has(job.id))throw Error('Geometry worker owner budget');
  this.pending.get(job.id)?.cancel();
  const request=new GeometryRequest(job.id,++this.token,this,eligible);this.pending.set(job.id,request);
  if(this.failed)request.reply={id:job.id,token:request.token,error:this.failed};
  else this.post({type:'job',job:{...job,token:request.token}});
  return request;
 }
 isCurrent(proof:{current:boolean;position:[string,number][];orientation:[string,number][]}){return proof.current&&proof.position.every(([id,version])=>(this.versions.get(id)?.position??0)===version)&&proof.orientation.every(([id,version])=>(this.versions.get(id)?.orientation??0)===version);}
 cancel(request:GeometryRequest){if(this.pending.get(request.id)===request){this.pending.delete(request.id);this.post({type:'cancel',id:request.id,token:request.token});}}
 dispose(){this.fail("Geometry worker disposed");this.pending.clear();this.versions.clear();}
}


/** Worker failures retry the authorized scientific path inside the same owner. */
export function* geometryOrNative(request:GeometryRequest,fallback:()=>Generator<void,TrailGeometry>):Generator<void,TrailGeometry> {
 try {
  while(!request.done)yield;
  try{return request.result();}catch{return yield* fallback();}
 } finally {request.cancel();}
}
