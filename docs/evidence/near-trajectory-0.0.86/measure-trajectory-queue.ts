import {SolarSystemData} from '../../../platform/solar-system.ts';
import {TrajectoryWorkQueue} from '../../../web/lib/trajectory-work.ts';
const source=new SolarSystemData({signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}} as any,{fetch:(input,init)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),init)});
const base=846620500,id='sc_stereo_ahead';await source.load([id],base,[]);
for(const rate of [1,3600]) {
 const queue=new TrajectoryWorkQueue<any>();const slices:number[]=[];let maxPoints=0,totalSteps=0,commits=0;
 for(let i=0;i<10;i++) {
  const epoch=base+i*.1*rate,p=source.position(id,epoch);
  queue.enqueue({objectId:id,revision:i,create:()=>source.trailSampleSteps(id,epoch,512,true,[p[0],p[1],p[2]+1000]),commit:path=>{maxPoints=Math.max(maxPoints,path.points.length);commits++;}});
  let status;do{const start=performance.now();status=queue.turn({budgetMs:1.5,maxSteps:2048});slices.push(performance.now()-start);totalSteps+=status.steps;}while(status.pending+status.active);
 }
 slices.sort((a,b)=>a-b);
 console.log(JSON.stringify({rate,commits,maxPoints,totalSteps,slices:slices.length,budgetMs:1.5,maxSliceMs:slices.at(-1),p95SliceMs:slices[Math.floor(slices.length*.95)]}));
}
source.dispose();
