import {SolarSystemData} from '../../../platform/solar-system.ts';
import {writeFile} from 'node:fs/promises';
const ctx:any={signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}};
const source=new SolarSystemData(ctx,{fetch:(input,init)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),init)});
const epoch=846690000;
const ids=['sc_iss','sc_tdrs_10','sc_themis_a','sc_hubble_space_telescope','sc_landsat_9'];
await source.load(ids,epoch,[]);
const rows=[];
for(const id of ids){
 try{
 const start=performance.now();
 const t=source.trailSamples(id,epoch,24);
 let worst=0;
 for(let i=1;i<t.points.length;i++){
  if(t.breakIndices.includes(i))continue;
  const a=t.points[i-1],b=t.points[i];
  for(const u of [.25,.5,.75]){
   const time=t.epochsTdbSeconds[i-1]+u*(t.epochsTdbSeconds[i]-t.epochsTdbSeconds[i-1]);
   const p=source.position(id,time),o=t.originId?source.position(t.originId,time):[0,0,0];
   const q=p.map((v,k)=>v-o[k]);
   worst=Math.max(worst,Math.hypot(...q.map((v,k)=>v-a[k]-u*(b[k]-a[k])))/Math.hypot(...q));
  }
 }
 rows.push({id,points:t.points.length,historySeconds:t.durationSeconds,breaks:t.breakIndices.length,worstProbeRelativeChordError:worst,samplingMs:performance.now()-start});
 }catch(error){rows.push({id,error:String(error),status:source.status(id)});}
}
source.dispose();
console.log(JSON.stringify(rows,null,2));
await writeFile('validation/results/trail-real-audit.json',JSON.stringify({epoch,rows},null,2));
