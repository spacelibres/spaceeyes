import {SolarSystemData} from '../../../platform/solar-system.ts';
const source=new SolarSystemData({signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}} as any,{fetch:(input,init)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),init)});
const epoch=846620500,id='sc_stereo_ahead';
await source.load([id],epoch,[]);
const center=source.position(id,epoch),observer=[center[0],center[1],center[2]+1000];
for(const useObserver of [false,true]) {
 const started=performance.now();
 const work=source.trailSampleSteps(id,epoch,512,true,useObserver?observer:undefined);
 let result=work.next(),steps=1;while(!result.done){result=work.next();steps++;}
 const path=result.value,t=path.epochsTdbSeconds,p=path.points;
 let worst=0;
 for(let i=1;i<t.length;i++) {
  const m=source.position(id,(t[i-1]+t[i])/2);
  const error=Math.hypot(...m.map((x,j)=>x-(p[i-1][j]+p[i][j])/2));
  const distance=Math.max(1e-6,Math.min(...[p[i-1],p[i],m].map(q=>Math.hypot(...q.map((x,j)=>x-observer[j])))));
  worst=Math.max(worst,error/distance);
 }
 console.log(JSON.stringify({useObserver,epoch,observer,points:p.length,steps,samplingAndAuditMs:performance.now()-started,worstAngularChordError:worst,start:t[0],end:t.at(-1),breaks:path.breakIndices}));
}
source.dispose();
