import {SolarSystemData} from '../../../platform/solar-system.ts';
import {writeFile} from 'node:fs/promises';
const results=[];
for(const id of ['sc_iss','sc_chandra','sc_mars_reconnaissance_orbiter']) {
 const ctx={signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}};
 const source=new SolarSystemData(ctx,{fetch:(input,options)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),options)});
 await source.load([id],846724000,[]);
 if(source.status(id)?.status!=='ready'){results.push({id,status:source.status(id)});source.dispose();continue;}
 const samples=[];
 for(const count of [24,160,256]){
  const durations=[];let path;
  for(let j=0;j<5;j++){const start=performance.now();path=source.trailSamples(id,846724000,count,count===256);durations.push(performance.now()-start);}
  samples.push({count,points:path.points.length,durationSeconds:path.durationSeconds,breaks:path.breakIndices.length,minMs:Math.min(...durations),maxMs:Math.max(...durations)});
 }
 results.push({id,samples});source.dispose();
}
await writeFile('validation/results/trail-real-cost.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
