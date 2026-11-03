import {SolarSystemData,type ScientificSourceSnapshot} from './solar-system.ts';
import type {PluginContext} from './plugin-host.ts';
import {eyesTrailPhase} from './eyes-trail-policy.ts';
import {TrajectoryWorkQueue,latestTrajectory} from './trajectory-work.ts';
export type TrailGeometry = ReturnType<SolarSystemData['trailSamples']>;
export type SourceDelta=ScientificSourceSnapshot & {positionChanged:boolean;orientationChanged:boolean;positionVersion:number;orientationVersion:number};
export type GeometryJob={id:string;token:number;count:number;detailed:boolean;guardSeconds:number;observer?:readonly number[]};
export type GeometryMessage={type:'sources';sources:SourceDelta[];removed:string[]}|{type:'job';job:GeometryJob}|{type:'cancel';id:string;token:number}|{type:'tick';epoch:number;selected?:string;observer?:readonly number[]};
export type GeometryReply={id:string;token:number;error:string}|{id:string;token:number;points:Float64Array;epochs:Float64Array;style:Omit<TrailGeometry,'points'|'epochsTdbSeconds'|'sourceCurrent'>;proof:{current:boolean;position:[string,number][];orientation:[string,number][]}};
/** One worker owns pure scientific geometry; it has no network or platform capabilities. */
export class TrajectoryGeometryRuntime {
 readonly data:SolarSystemData;
 private queue:TrajectoryWorkQueue<TrailGeometry>;
 private epoch=0;
 private observers=new Map<string,readonly number[]>();
 private versions=new Map<string,[number,number]>();
 private jobs=new Map<string,GeometryJob>();
 private scheduled=false;
 private send:(reply:GeometryReply,transfer:ArrayBuffer[])=>void;
 private schedule:(run:()=>void)=>void;
 private now:()=>number;
 constructor(send:(reply:GeometryReply,transfer:ArrayBuffer[])=>void,schedule:(run:()=>void)=>void,now:()=>number=()=>performance.now()) {
  this.send=send;this.schedule=schedule;this.now=now;
  this.queue=new TrajectoryWorkQueue<TrailGeometry>(this.now,256);
  this.data=new SolarSystemData({signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}} as unknown as PluginContext,{maxCachedRecords:1000000,fetch:async()=>{throw Error('Geometry worker cannot fetch');}});
 }
 receive(message:GeometryMessage) {
  if(message.type==='sources') {
   this.data.importScientificSources(message.sources,message.removed);
   for(const source of message.sources)this.versions.set(source.id,[source.positionVersion,source.orientationVersion]);
   for(const id of message.removed)this.versions.delete(id);
  } else if(message.type==='tick') {
   this.epoch=message.epoch;this.observers.clear();if(message.selected&&message.observer)this.observers.set(message.selected,message.observer);
  } else if(message.type==='cancel') {
   if(this.jobs.get(message.id)?.token===message.token){this.queue.cancel(message.id);this.jobs.delete(message.id);}
  } else {
   const job=message.job;this.jobs.set(job.id,job);
   this.queue.enqueue({objectId:job.id,revision:job.token,priority:job.detailed,
    create:latestTrajectory(()=>this.epoch,at=>this.data.trailSampleSteps(job.id,at,job.count,job.detailed,this.observers.get(job.id)??job.observer,job.guardSeconds),
      (value,live)=>value.sourceCurrent&&value.policyKey===eyesTrailPhase(job.id,live).key&&live>=value.refreshRange[0]&&live<=value.refreshRange[1]),
    commit:value=>{
     const points=new Float64Array(value.points.length*3);for(let i=0;i<value.points.length;i++)points.set(value.points[i],i*3);
     const epochs=new Float64Array(value.epochsTdbSeconds);
     const {points:_points,epochsTdbSeconds:_epochs,sourceCurrent:_current,...style}=value;
     const dependencies=this.data.scientificTrailDependencies(job.id);
     this.send({id:job.id,token:job.token,points,epochs,style,proof:{current:value.sourceCurrent,position:dependencies.position.map(id=>[id,this.versions.get(id)?.[0]??0]),orientation:dependencies.orientation.map(id=>[id,this.versions.get(id)?.[1]??0])}},[points.buffer,epochs.buffer]);
    },onError:error=>this.send({id:job.id,token:job.token,error:String(error)},[]),
    release:()=>{if(this.jobs.get(job.id)===job)this.jobs.delete(job.id);}});
  }
  this.wake();
 }
 private wake(){if(!this.scheduled){this.scheduled=true;this.schedule(()=>this.pump());}}
 private pump(){this.scheduled=false;const state=this.queue.turn({budgetMs:15,maxSteps:65536});if(state.active+state.pending)this.wake();}
 dispose(){this.queue.clear();this.data.dispose();this.jobs.clear();}
}
