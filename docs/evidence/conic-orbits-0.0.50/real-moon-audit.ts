import {SolarSystemData} from '../../../platform/solar-system.ts';
import {writeFile} from 'node:fs/promises';
const source=new SolarSystemData({signal:new AbortController().signal,onDispose(){},data:{publish(){},remove(){}}} as any,{fetch:(input,init)=>fetch(new URL(String(input),'http://127.0.0.1:3006'),init)});
try {
  const epoch=846690000;
  await source.load(['moon'],epoch,[]);
  const path=source.trajectorySamples('moon',epoch,24,false,'instantaneous');
  if(!path.conic || path.originId!=='earth') throw Error('Missing Earth-relative analytic Moon orbit');
  const c=path.conic;
  const vertices=Array.from({length:360},(_,i)=>{
    const angle=i*Math.PI/180, cos=Math.cos(angle),sin=Math.sin(angle);
    const radius=c.semiLatusRectumKm/(1+c.eccentricityRadial*cos+c.eccentricityTransverse*sin);
    return c.radialUnit.map((v,j)=>radius*(v*cos+c.transverseUnit[j]*sin));
  });
  const residuals=vertices.map(p=>{
    const dot=(u:readonly number[])=>p.reduce((s,v,j)=>s+v*u[j],0);
    return Math.abs(Math.hypot(...p)+c.eccentricityRadial*dot(c.radialUnit)+c.eccentricityTransverse*dot(c.transverseUnit)-c.semiLatusRectumKm)/c.semiLatusRectumKm;
  });
  const result={epoch,originId:path.originId,sourcePoints:path.points.length,analyticSegments:vertices.length,maxRelativeConicResidual:Math.max(...residuals),conic:c};
  console.log(JSON.stringify(result,null,2));
  await writeFile('docs/evidence/conic-orbits-0.0.50/real-moon-audit.json',JSON.stringify(result,null,2));
} finally {source.dispose();}
