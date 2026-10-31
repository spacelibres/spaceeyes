import {SolarSystemData} from '../../../platform/solar-system.ts';
import {writeFile} from 'node:fs/promises';
const results=[];
for(const id of ['sc_iss','sc_chandra','sc_mars_reconnaissance_orbiter','sc_juno','sc_voyager_1']) {
 const ctx={signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}};
 const source=new SolarSystemData(ctx,{fetch:(input,options)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),options)});
 await source.load([id],846724000,[]);
 if(source.status(id)?.status!=='ready'){results.push({id,status:source.status(id)});source.dispose();continue;}
 const samples=[];
 for(const count of [184,512]){
  const durations=[];let path;
  for(let j=0;j<5;j++){const start=performance.now();path=source.trailSamples(id,846724000,count,count===512);durations.push(performance.now()-start);}
  samples.push({count,points:path.points.length,durationSeconds:path.durationSeconds,firstEpoch:path.epochsTdbSeconds[0],lastEpoch:path.epochsTdbSeconds.at(-1),historySeconds:846724000-path.epochsTdbSeconds[0],breaks:path.breakIndices.length,minMs:Math.min(...durations),maxMs:Math.max(...durations)});
 }
 results.push({id,samples});source.dispose();
}
await writeFile('docs/evidence/nasa-trail-source-0.0.62/real-source-cost.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
