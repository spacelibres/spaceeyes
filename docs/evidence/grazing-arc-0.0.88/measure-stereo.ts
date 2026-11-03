import {SolarSystemData} from '../../../platform/solar-system.ts';
const source=new SolarSystemData({signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}} as any,{fetch:(input,init)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),init)});
const epoch=846620500,id='sc_stereo_ahead';
await source.load([id],epoch,[]);
console.log(JSON.stringify({historyPrepared:await source.prepareTrailHistory(id,epoch)}));
for(const offset of [0, -3600, -86400]) {
 const center=source.position(id,epoch+offset),observer=[center[0],center[1],center[2]+1];
 const started=performance.now();
 const work=source.trailSampleSteps(id,epoch,512,true,observer);
 let step=work.next(),steps=1;while(!step.done){step=work.next();steps++;}
 const path=step.value,t=path.epochsTdbSeconds,p=path.points;
 let worst=0;
 for(let i=1;i<t.length;i++) {
  const a=p[i-1],b=p[i],m=source.position(id,(t[i-1]+t[i])/2),delta=b.map((x,j)=>x-a[j]);
  const length2=delta.reduce((s,x)=>s+x*x,0),u=length2>0?Math.max(0,Math.min(1,delta.reduce((s,x,j)=>s+x*(observer[j]-a[j]),0)/length2)):0;
  const distance=Math.max(1e-6,Math.hypot(...a.map((x,j)=>x+u*delta[j]-observer[j])));
  worst=Math.max(worst,Math.hypot(...m.map((x,j)=>x-(a[j]+b[j])/2))/distance);
 }
 console.log(JSON.stringify({epoch,offset,observer,points:p.length,steps,elapsedMs:performance.now()-started,worstChordDistanceError:worst,start:t[0],end:t.at(-1),breaks:path.breakIndices}));
 if(worst>.0005) throw Error('Grazing chord tolerance exceeded');
}
source.dispose();
